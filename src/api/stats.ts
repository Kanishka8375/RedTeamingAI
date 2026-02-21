import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getStats } from '../db/events.js';

export const statsRouter = Router();

const statsQuerySchema = z.object({
  period: z.enum(['24h', '7d', '30d']).default('24h')
});

function sendError(res: Response, status: number, error: string, code: string): void {
  res.status(status).json({ error, code });
}

statsRouter.get('/stats', (req: Request, res: Response): void => {
  if (!req.customerId) {
    sendError(res, 401, 'Unauthorized', 'AUTH_REQUIRED');
    return;
  }

  const parsed = statsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    sendError(res, 400, 'Invalid period', 'INVALID_PERIOD');
    return;
  }

  const result = getStats(req.customerId, parsed.data.period);
  res.status(200).json(result);
});
