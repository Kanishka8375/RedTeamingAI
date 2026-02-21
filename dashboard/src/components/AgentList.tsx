import { useMemo } from 'react';
import type { LoggedEvent } from '../../../src/types';

interface AgentListProps {
  events: LoggedEvent[];
}

interface AgentRow {
  id: string;
  calls: number;
  blocked: number;
  cost: number;
}

export default function AgentList({ events }: AgentListProps) {
  const rows = useMemo<AgentRow[]>(() => {
    const byAgent = new Map<string, AgentRow>();
    for (const event of events) {
      const agent = event.agentId ?? 'unknown';
      const row = byAgent.get(agent) ?? { id: agent, calls: 0, blocked: 0, cost: 0 };
      row.calls += 1;
      row.blocked += event.blocked ? 1 : 0;
      row.cost += event.costUsd;
      byAgent.set(agent, row);
    }

    return [...byAgent.values()].sort((a, b) => b.calls - a.calls).slice(0, 10);
  }, [events]);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Top Agents</h2>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Agent</th>
            <th>Calls</th>
            <th>Blocked</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.id}</td>
              <td>{row.calls}</td>
              <td>{row.blocked}</td>
              <td>${row.cost.toFixed(4)}</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4}>No agent activity yet.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}
