import { useEffect, useState } from 'react';
import type { LoggedEvent } from '../../../src/types';

export function useEvents(apiKey: string) {
  const [events, setEvents] = useState<LoggedEvent[]>([]);
  useEffect(() => {
    fetch('http://localhost:4000/api/events?limit=20', { headers: { 'X-RedTeamingAI-Key': apiKey } })
      .then((r) => r.json())
      .then((d) => setEvents(d.items ?? []))
      .catch(() => setEvents([]));
  }, [apiKey]);
  return events;
}
