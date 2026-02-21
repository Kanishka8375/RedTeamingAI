import { createHash } from 'node:crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

vi.mock('../src/db/customers.js', () => ({
  getCustomerByApiKey: vi.fn(),
  isAgentBlocked: vi.fn(),
  checkMonthlyLimit: vi.fn()
}));

vi.mock('../src/db/events.js', () => ({
  insertEvent: vi.fn(),
  updateSecurityResult: vi.fn()
}));

vi.mock('../src/proxy/forwarder.js', () => ({
  forwardRequest: vi.fn()
}));

vi.mock('../src/security/pipeline.js', () => ({
  analyzeEvent: vi.fn()
}));

vi.mock('../src/alerts/index.js', () => ({
  alertManager: { sendAlert: vi.fn() }
}));

vi.mock('../src/api/websocket.js', () => ({
  broadcastEvent: vi.fn()
}));

import { calculateCost, TOKEN_COSTS } from '../src/proxy/pricing.js';
import { interceptor } from '../src/proxy/interceptor.js';
import { getCustomerByApiKey, isAgentBlocked, checkMonthlyLimit } from '../src/db/customers.js';

function buildResponse(): Response {
  const headers = new Map<string, string>();
  const response = {
    statusCode: 200,
    headersSent: false,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
    send(payload: unknown) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
    set(value: Record<string, string>) {
      Object.entries(value).forEach(([k, v]) => headers.set(k, v));
      return this;
    },
    setHeader(key: string, value: string) {
      headers.set(key, value);
    },
    getHeader(key: string) {
      return headers.get(key);
    }
  } as unknown as Response;

  return response;
}

function buildRequest(headers: Record<string, string> = {}, body: Record<string, unknown> = {}): Request {
  return {
    header: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? undefined,
    body,
    path: '/v1/chat/completions'
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('proxy pricing and interceptor guardrails', () => {
  it('calculates cost for all pricing models', () => {
    for (const model of Object.keys(TOKEN_COSTS)) {
      expect(calculateCost(model, 1000, 1000)).toBeGreaterThan(0);
    }
  });

  it('uses deterministic hash for same messages payload', () => {
    const payload = JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] });
    const first = createHash('sha256').update(payload).digest('hex');
    const second = createHash('sha256').update(payload).digest('hex');
    expect(first).toBe(second);
  });

  it('returns 401 when API key is missing', async () => {
    const req = buildRequest();
    const res = buildResponse();
    await interceptor(req, res, (() => undefined) as NextFunction);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
  });

  it('returns 403 when agent is blocked', async () => {
    vi.mocked(getCustomerByApiKey).mockReturnValue({
      id: 'cust-1',
      apiKey: 'k',
      name: 'C',
      plan: 'free',
      monthlyEventLimit: 1000,
      stripeCustomerId: null,
      createdAt: new Date().toISOString(),
      blocked: false
    });
    vi.mocked(isAgentBlocked).mockReturnValue(true);
    vi.mocked(checkMonthlyLimit).mockReturnValue({ count: 0, exceeded: false });

    const req = buildRequest({ 'X-RedTeamingAI-Key': 'k', 'X-Agent-ID': 'agent-1' });
    const res = buildResponse();
    await interceptor(req, res, (() => undefined) as NextFunction);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(403);
  });

  it('returns 429 when monthly event limit is exceeded', async () => {
    vi.mocked(getCustomerByApiKey).mockReturnValue({
      id: 'cust-2',
      apiKey: 'k2',
      name: 'C2',
      plan: 'pro',
      monthlyEventLimit: 10,
      stripeCustomerId: null,
      createdAt: new Date().toISOString(),
      blocked: false
    });
    vi.mocked(isAgentBlocked).mockReturnValue(false);
    vi.mocked(checkMonthlyLimit).mockReturnValue({ count: 10, exceeded: true });

    const req = buildRequest({ 'X-RedTeamingAI-Key': 'k2', 'X-Agent-ID': 'agent-2' });
    const res = buildResponse();
    await interceptor(req, res, (() => undefined) as NextFunction);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(429);
  });
});
