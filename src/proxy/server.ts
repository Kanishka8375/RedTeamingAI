import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { interceptor } from './interceptor.js';
import { forwardRequest } from './forwarder.js';

const REQUESTS_PER_MINUTE = 1000;

export function createProxyServer(): express.Express {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: REQUESTS_PER_MINUTE,
      keyGenerator: (req) => req.header('X-RedTeamingAI-Key') ?? req.ip,
      standardHeaders: true,
      legacyHeaders: false
    })
  );

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.post('/v1/chat/completions', (req, res, next) => {
    void interceptor(req, res, next);
  });

  app.post('/v1/messages', (req, res, next) => {
    void interceptor(req, res, next);
  });

  app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Proxy middleware error:', error);

    if (res.headersSent) {
      return;
    }

    const rawBody = JSON.stringify(req.body ?? {});
    void forwardRequest(req, rawBody)
      .then((upstream) => {
        if (!res.headersSent) {
          res.status(upstream.status).set(upstream.headers).send(upstream.rawResponse);
        }
      })
      .catch(() => {
        if (!res.headersSent) {
          res.status(500).json({ error: 'internal_error', code: 'INTERNAL' });
        }
      });
  });

  return app;
}
