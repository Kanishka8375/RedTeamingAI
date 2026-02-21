interface AgentRow {
  id: string;
  calls: number;
  blocked: number;
}

const demoAgents: AgentRow[] = [
  { id: 'agent-alpha', calls: 245, blocked: 4 },
  { id: 'agent-beta', calls: 102, blocked: 0 },
  { id: 'agent-gamma', calls: 87, blocked: 2 }
];

export default function AgentList() {
  return (
    <section className="bg-slate-900 border border-slate-800 rounded p-4">
      <h2 className="text-cyan-300 font-semibold mb-3">Top Agents</h2>
      <div className="space-y-2">
        {demoAgents.map((agent) => (
          <div key={agent.id} className="flex items-center justify-between bg-slate-800 rounded px-3 py-2 text-sm">
            <span>{agent.id}</span>
            <span className="text-slate-400">{agent.calls} calls • {agent.blocked} blocked</span>
          </div>
        ))}
      </div>
    </section>
  );
}
