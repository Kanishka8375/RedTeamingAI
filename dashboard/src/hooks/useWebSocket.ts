import { useEffect, useRef, useState } from 'react';
import type { LoggedEvent } from '../../../src/types';

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 10_000;

interface WebSocketMessage {
  type: string;
  payload: LoggedEvent;
}

export function useWebSocket(key: string): { connected: boolean; lastEvent: LoggedEvent | null } {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<LoggedEvent | null>(null);
  const reconnectAttemptRef = useRef(0);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let closedByCleanup = false;

    const connect = (): void => {
      socket = new WebSocket(`ws://localhost:4000/ws?key=${encodeURIComponent(key)}`);

      socket.onopen = (): void => {
        setConnected(true);
        reconnectAttemptRef.current = 0;
      };

      socket.onmessage = (event: MessageEvent<string>): void => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          if (message.type === 'event') {
            setLastEvent(message.payload);
          }
        } catch {
          // Ignore malformed messages to keep stream resilient.
        }
      };

      socket.onclose = (): void => {
        setConnected(false);
        if (closedByCleanup) {
          return;
        }

        const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** reconnectAttemptRef.current);
        reconnectAttemptRef.current += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };

      socket.onerror = (): void => {
        socket?.close();
      };
    };

    connect();

    return () => {
      closedByCleanup = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, [key]);

  return { connected, lastEvent };
}
