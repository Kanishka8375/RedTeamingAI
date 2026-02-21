import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { WebSocketServer } from 'ws';
import { getCustomerByApiKey } from '../db/customers.js';
import type { LoggedEvent } from '../types/index.js';

type WS = import('ws').WebSocket;

type AuthenticatedWebSocket = WS & { customerId?: string };

interface ManagedSocket {
  socket: AuthenticatedWebSocket;
  pongTimeout: NodeJS.Timeout | null;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;

const connections = new Map<string, Set<ManagedSocket>>();

function removeSocket(customerId: string, managedSocket: ManagedSocket): void {
  const set = connections.get(customerId);
  if (!set) {
    return;
  }

  if (managedSocket.pongTimeout !== null) {
    clearTimeout(managedSocket.pongTimeout);
  }

  set.delete(managedSocket);
  if (set.size === 0) {
    connections.delete(customerId);
  }
}

function customerIdFromRequest(req: IncomingMessage): string | null {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const key = url.searchParams.get('key');
  if (!key) {
    return null;
  }

  const customer = getCustomerByApiKey(key);
  return customer?.id ?? null;
}

export function handleWebSocketUpgrade(
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer
): void {
  const customerId = customerIdFromRequest(req);
  if (!customerId) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (upgradedSocket) => {
    const authSocket = upgradedSocket as AuthenticatedWebSocket;
    authSocket.customerId = customerId;
    wss.emit('connection', authSocket, req);
  });
}

export function initWebsocket(wss: WebSocketServer): void {
  wss.on('connection', (socket: WS): void => {
    const authSocket = socket as AuthenticatedWebSocket;
    const customerId = authSocket.customerId;

    if (!customerId) {
      authSocket.close(1008, 'Unauthorized');
      return;
    }

    const managedSocket: ManagedSocket = { socket: authSocket, pongTimeout: null };
    const set = connections.get(customerId) ?? new Set<ManagedSocket>();
    set.add(managedSocket);
    connections.set(customerId, set);

    authSocket.on('pong', (): void => {
      if (managedSocket.pongTimeout !== null) {
        clearTimeout(managedSocket.pongTimeout);
        managedSocket.pongTimeout = null;
      }
    });

    authSocket.on('close', (): void => {
      removeSocket(customerId, managedSocket);
    });
  });

  setInterval((): void => {
    for (const [customerId, set] of connections.entries()) {
      for (const managedSocket of set) {
        if (managedSocket.socket.readyState !== managedSocket.socket.OPEN) {
          removeSocket(customerId, managedSocket);
          continue;
        }

        managedSocket.socket.ping();
        if (managedSocket.pongTimeout !== null) {
          clearTimeout(managedSocket.pongTimeout);
        }
        managedSocket.pongTimeout = setTimeout((): void => {
          managedSocket.socket.terminate();
          removeSocket(customerId, managedSocket);
        }, PONG_TIMEOUT_MS);
      }
    }
  }, HEARTBEAT_INTERVAL_MS).unref();
}

export function broadcastEvent(customerId: string, event: LoggedEvent): void {
  const set = connections.get(customerId);
  if (!set) {
    return;
  }

  const payload = JSON.stringify({ type: 'event', payload: event });
  for (const managedSocket of set) {
    if (managedSocket.socket.readyState === managedSocket.socket.OPEN) {
      managedSocket.socket.send(payload);
    }
  }
}
