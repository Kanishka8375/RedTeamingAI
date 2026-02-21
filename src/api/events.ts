import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getEvents } from '../db/events.js';

export const eventsRouter = Router();

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  minRisk: z.coerce.number().int().min(0).max(100).optional(),
  blocked: z.enum(['true', 'false']).optional(),
  agentId: z.string().min(1).optional()
});

const idParamSchema = z.object({
  id: z.string().uuid()
});

function sendError(res: Response, status: number, error: string, code: string): void {
  res.status(status).json({ error, code });
}

eventsRouter.get('/events', (req: Request, res: Response): void => {
  if (!req.customerId) {
    sendError(res, 401, 'Unauthorized', 'AUTH_REQUIRED');
    return;
  }

  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    sendError(res, 400, 'Invalid query', 'INVALID_QUERY');
    return;
  }

  const filters = parsed.data;
  const result = getEvents(req.customerId, {
    limit: filters.limit,
    offset: filters.offset,
    startDate: filters.startDate,
    endDate: filters.endDate,
    minRisk: filters.minRisk,
    blocked: filters.blocked === undefined ? undefined : filters.blocked === 'true',
    agentId: filters.agentId
  });

  res.status(200).json(result);
});

eventsRouter.get('/events/:id', (req: Request, res: Response): void => {
  if (!req.customerId) {
    sendError(res, 401, 'Unauthorized', 'AUTH_REQUIRED');
    return;
  }

  const params = idParamSchema.safeParse(req.params);
  if (!params.success) {
    sendError(res, 400, 'Invalid event id', 'INVALID_EVENT_ID');
    return;
  }

  const events = getEvents(req.customerId, { limit: 100, offset: 0 });
  const event = events.items.find((item) => item.id === params.data.id);

  if (!event) {
    sendError(res, 404, 'Event not found', 'NOT_FOUND');
    return;
  }

  res.status(200).json(event);
});
