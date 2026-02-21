import type { NextFunction, Request, Response } from 'express';
import { getCustomerByApiKey } from '../db/customers.js';

declare global {
  namespace Express {
    interface Request {
      customerId?: string;
    }
  }
}

function sendAuthError(res: Response, code: 'AUTH_REQUIRED' | 'AUTH_INVALID'): void {
  res.status(401).json({ error: code === 'AUTH_REQUIRED' ? 'Unauthorized' : 'Invalid API key', code });
}

export function apiAuth(req: Request, res: Response, next: NextFunction): void {
  const headerKey = req.header('X-RedTeamingAI-Key');
  const queryKey = typeof req.query.key === 'string' ? req.query.key : null;
  const key = headerKey ?? queryKey;

  if (!key) {
    sendAuthError(res, 'AUTH_REQUIRED');
    return;
  }

  const customer = getCustomerByApiKey(key);
  if (!customer || customer.blocked) {
    sendAuthError(res, 'AUTH_INVALID');
    return;
  }

  req.customerId = customer.id;
  next();
}
