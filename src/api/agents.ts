import { Router, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db } from '../db/connection.js';

export const agentsRouter = Router();

const blockParamsSchema = z.object({
  id: z.string().min(1)
});

function sendError(res: Response, status: number, error: string, code: string): void {
  res.status(status).json({ error, code });
}

agentsRouter.get('/agents', (req: Request, res: Response): void => {
  if (!req.customerId) {
    sendError(res, 401, 'Unauthorized', 'AUTH_REQUIRED');
    return;
  }

  const rows = db
    .prepare(
      `SELECT COALESCE(agent_id, 'unknown') as agentId,
              COUNT(*) as calls,
              SUM(CASE WHEN blocked = 1 THEN 1 ELSE 0 END) as blocked
       FROM events
       WHERE customer_id = ?
       GROUP BY agent_id
       ORDER BY calls DESC`
    )
    .all(req.customerId);

  res.status(200).json(rows);
});

agentsRouter.post('/agents/:id/block', (req: Request, res: Response): void => {
  if (!req.customerId) {
    sendError(res, 401, 'Unauthorized', 'AUTH_REQUIRED');
    return;
  }

  const params = blockParamsSchema.safeParse(req.params);
  if (!params.success) {
    sendError(res, 400, 'Invalid agent id', 'INVALID_AGENT_ID');
    return;
  }

  db.prepare('INSERT OR IGNORE INTO blocked_agents(id, customer_id, agent_id, reason, created_at) VALUES(?, ?, ?, ?, ?)').run(
    uuidv4(),
    req.customerId,
    params.data.id,
    'Manual block',
    new Date().toISOString()
  );

  res.status(201).json({ blocked: true, agentId: params.data.id });
});
