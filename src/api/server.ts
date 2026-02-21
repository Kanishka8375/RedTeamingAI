import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import cors from 'cors';
import express, { type Request, type Response } from 'express';
import { WebSocketServer } from 'ws';
import { agentsRouter } from './agents.js';
import { apiAuth } from './auth.js';
import { eventsRouter } from './events.js';
import { policiesRouter } from './policies.js';
import { statsRouter } from './stats.js';
import { handleWebSocketUpgrade, initWebsocket } from './websocket.js';

export function createApiServer(): { app: express.Express; server: Server } {
  const app = express();

  app.use(cors({ origin: process.env.DASHBOARD_ORIGIN ?? 'http://localhost:5173' }));
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req: Request, res: Response): void => {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
  });

  app.use('/api', apiAuth, eventsRouter, statsRouter, policiesRouter, agentsRouter);

  app.use((_req: Request, res: Response): void => {
    res.status(404).json({ error: 'Route not found', code: 'NOT_FOUND' });
  });

  const server = createServer(app);
  const websocketServer = new WebSocketServer({ noServer: true });
  initWebsocket(websocketServer);

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (req.url?.startsWith('/ws')) {
      handleWebSocketUpgrade(websocketServer, req, socket, head);
      return;
    }

    socket.destroy();
  });

  return { app, server };
}

export function startApiServer(port = 4000): Server {
  const { server } = createApiServer();
  server.listen(port, () => {
    console.log(`API server listening on ${port}`);
  });
  return server;
}
