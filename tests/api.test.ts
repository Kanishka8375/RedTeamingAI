import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiServer } from '../src/api/server.js';
import { runMigrations } from '../src/db/migrations.js';
import { db } from '../src/db/connection.js';
import { createCustomer } from '../src/db/customers.js';
import { insertEvent } from '../src/db/events.js';
import type { LoggedEvent } from '../src/types/index.js';

const API_KEY = 'test-api-key';
let customerId = '';

function buildEvent(overrides: Partial<Omit<LoggedEvent, 'id'>> = {}): Omit<LoggedEvent, 'id'> {
  return {
    timestamp: new Date().toISOString(),
    customerId,
    agentId: 'agent-1',
    model: 'gpt-4o',
    promptTokens: 100,
    completionTokens: 40,
    costUsd: 0.12,
    latencyMs: 100,
    toolCallsRequested: ['http_fetch'],
    toolCallsInResponse: [],
    requestHash: 'hash',
    responsePreview: 'preview',
    riskScore: 72,
    blocked: false,
    anomalyFlags: ['external_network'],
    rawRequest: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    rawResponse: JSON.stringify({ ok: true }),
    ...overrides
  };
}

beforeAll(() => {
  runMigrations();
  const existing = db.prepare('SELECT id FROM customers WHERE api_key = ?').get(API_KEY) as { id: string } | undefined;
  customerId = existing?.id ?? createCustomer('API Test Customer', API_KEY, 'pro').id;
});

beforeEach(() => {
  db.prepare('DELETE FROM events WHERE customer_id = ?').run(customerId);
  db.prepare('DELETE FROM policies WHERE customer_id = ?').run(customerId);
});

describe('API routes', () => {
  it('GET /api/events returns paginated results', async () => {
    insertEvent(buildEvent({ agentId: 'a1' }));
    insertEvent(buildEvent({ agentId: 'a2' }));

    const { app } = createApiServer();
    const res = await request(app)
      .get('/api/events?limit=1&offset=0')
      .set('X-RedTeamingAI-Key', API_KEY)
      .expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.limit).toBe(1);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
  });

  it('GET /api/stats returns aggregations', async () => {
    insertEvent(buildEvent({ costUsd: 0.5, blocked: true, riskScore: 90 }));
    insertEvent(buildEvent({ costUsd: 0.2, blocked: false, riskScore: 20 }));

    const { app } = createApiServer();
    const res = await request(app)
      .get('/api/stats?period=24h')
      .set('X-RedTeamingAI-Key', API_KEY)
      .expect(200);

    expect(res.body.totalCalls).toBeGreaterThanOrEqual(2);
    expect(res.body.totalCostUsd).toBeGreaterThan(0);
    expect(res.body.blockedCount).toBeGreaterThanOrEqual(1);
  });

  it('POST /api/policies validates condition before saving', async () => {
    const { app } = createApiServer();
    const bad = await request(app)
      .post('/api/policies')
      .set('X-RedTeamingAI-Key', API_KEY)
      .send({
        name: 'Bad',
        description: 'Bad condition',
        condition: 'while(true){}',
        action: 'BLOCK',
        severity: 'HIGH',
        enabled: true
      });

    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_CONDITION');
  });

  it('POST /api/test-policy evaluates against past event', async () => {
    insertEvent(buildEvent({ costUsd: 1.1 }));

    const { app } = createApiServer();
    const res = await request(app)
      .post('/api/test-policy')
      .set('X-RedTeamingAI-Key', API_KEY)
      .send({ condition: 'cost > 1' })
      .expect(200);

    expect(res.body.result).toBe(true);
  });
});
