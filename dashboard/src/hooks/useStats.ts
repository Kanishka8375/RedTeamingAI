import { useEffect, useState } from 'react';
import type { StatsResult } from '../../../src/types';

export function useStats(apiKey: string) {
  const [stats, setStats] = useState<StatsResult | null>(null);
  useEffect(() => {
    fetch('http://localhost:4000/api/stats?period=7d', { headers: { 'X-RedTeamingAI-Key': apiKey } })
      .then((r) => r.json())
      .then((d) => setStats(d as StatsResult))
      .catch(() => setStats(null));
  }, [apiKey]);
  return stats;
}
