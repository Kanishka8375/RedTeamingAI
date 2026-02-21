import vm from 'node:vm';
import { Router, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db } from '../db/connection.js';

export const policiesRouter = Router();

const createPolicySchema = z.object({
  name: z.string().min(2),
  description: z.string().min(2),
  condition: z.string().min(1),
  action: z.enum(['ALLOW', 'BLOCK', 'ALERT']),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  enabled: z.boolean().default(true)
});

const testPolicySchema = z.object({
  condition: z.string().min(1)
});

function sendError(res: Response, status: number, error: string, code: string): void {
  res.status(status).json({ error, code });
}

policiesRouter.get('/policies', (req: Request, res: Response): void => {
  if (!req.customerId) {
    sendError(res, 401, 'Unauthorized', 'AUTH_REQUIRED');
    return;
  }

  const rows = db.prepare('SELECT * FROM policies WHERE customer_id = ? ORDER BY created_at DESC').all(req.customerId);
  res.status(200).json(rows);
});

policiesRouter.post('/policies', (req: Request, res: Response): void => {
  if (!req.customerId) {
    sendError(res, 401, 'Unauthorized', 'AUTH_REQUIRED');
    return;
  }

  const parsed = createPolicySchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'Validation failed', 'VALIDATION_ERROR');
    return;
  }

  try {
    vm.runInNewContext(parsed.data.condition, { event: {}, tools: [], model: '', cost: 0, agentId: null }, { timeout: 10 });
  } catch {
    sendError(res, 400, 'Invalid policy condition', 'INVALID_CONDITION');
    return;
  }

  const policyId = uuidv4();
  db.prepare(
    `INSERT INTO policies(id, customer_id, name, description, condition, action, severity, enabled, hit_count, created_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    policyId,
    req.customerId,
    parsed.data.name,
    parsed.data.description,
    parsed.data.condition,
    parsed.data.action,
    parsed.data.severity,
    parsed.data.enabled ? 1 : 0,
    new Date().toISOString()
  );

  res.status(201).json({ id: policyId });
});

policiesRouter.post('/test-policy', (req: Request, res: Response): void => {
  if (!req.customerId) {
    sendError(res, 401, 'Unauthorized', 'AUTH_REQUIRED');
    return;
  }

  const parsed = testPolicySchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'Validation failed', 'VALIDATION_ERROR');
    return;
  }

  const event = db.prepare('SELECT * FROM events WHERE customer_id = ? ORDER BY timestamp DESC LIMIT 1').get(req.customerId) as Record<string, unknown> | undefined;

  if (!event) {
    res.status(200).json({ result: false });
    return;
  }

  const context = {
    event,
    tools: [],
    model: String(event.model ?? ''),
    cost: Number(event.cost_usd ?? 0),
    agentId: event.agent_id ?? null
  };

  try {
    const result = vm.runInNewContext(parsed.data.condition, context, { timeout: 10 });
    res.status(200).json({ result: result === true });
  } catch {
    sendError(res, 400, 'Invalid policy condition', 'INVALID_CONDITION');
  }
});
