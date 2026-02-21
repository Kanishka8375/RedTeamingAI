import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import type { StatsResult } from '../../../src/types';

interface CostDashboardProps {
  stats: StatsResult | null;
}

const PIE_COLORS = ['#10b981', '#eab308', '#f59e0b', '#ef4444'];

type SortColumn = 'agentId' | 'calls' | 'blocked' | 'costUsd';

export default function CostDashboard({ stats }: CostDashboardProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('calls');

  const overTime = stats?.callsOverTime ?? [];
  const costByModel = stats?.costByModel ?? [];

  const riskData = useMemo(
    () => [
      { name: 'Low', value: stats?.riskDistribution.low ?? 0 },
      { name: 'Medium', value: stats?.riskDistribution.medium ?? 0 },
      { name: 'High', value: stats?.riskDistribution.high ?? 0 },
      { name: 'Critical', value: stats?.riskDistribution.critical ?? 0 }
    ],
    [stats]
  );

  const topAgents = useMemo(() => {
    const agents = [...(stats?.topAgents ?? [])];
    agents.sort((a, b) => {
      if (sortColumn === 'agentId') return a.agentId.localeCompare(b.agentId);
      return b[sortColumn] - a[sortColumn];
    });
    return agents;
  }, [stats, sortColumn]);

  const cards = [
    { label: 'Total Calls', value: stats?.totalCalls ?? 0, delta: '+8.2%' },
    { label: 'Total Cost', value: `$${(stats?.totalCostUsd ?? 0).toFixed(4)}`, delta: '+4.1%' },
    { label: 'Blocked', value: stats?.blockedCount ?? 0, delta: '-1.3%' },
    { label: 'Avg Risk', value: (stats?.avgRiskScore ?? 0).toFixed(1), delta: '-2.9%' }
  ];

  return (
    <section className="bg-slate-900 border border-slate-800 rounded p-4">
      <h2 className="text-cyan-300 font-semibold mb-3">Cost Dashboard</h2>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 mb-4 text-sm">
        {cards.map((card) => (
          <div key={card.label} className="bg-slate-800 rounded p-3">
            <div className="text-slate-400 text-xs">{card.label}</div>
            <div className="font-semibold text-base">{card.value}</div>
            <div className="text-emerald-300 text-xs">{card.delta}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="h-56 bg-slate-800 rounded p-2">
          <div className="text-xs text-slate-300 mb-1">Daily spend (30d)</div>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={overTime}>
              <defs>
                <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00e5ff" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#00e5ff" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <XAxis dataKey="bucket" hide />
              <YAxis />
              <Tooltip />
              <Area type="monotone" dataKey="costUsd" stroke="#00e5ff" fill="url(#spendGradient)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="h-56 bg-slate-800 rounded p-2">
          <div className="text-xs text-slate-300 mb-1">Cost by model</div>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={costByModel} layout="vertical">
              <XAxis type="number" />
              <YAxis dataKey="model" type="category" width={120} />
              <Tooltip />
              <Bar dataKey="costUsd" fill="#00e5ff" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="h-56 bg-slate-800 rounded p-2">
          <div className="text-xs text-slate-300 mb-1">Risk distribution</div>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={riskData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85}>
                {riskData.map((entry, idx) => (
                  <Cell key={entry.name} fill={PIE_COLORS[idx] ?? '#00e5ff'} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-slate-800 rounded p-2 overflow-auto">
          <div className="text-xs text-slate-300 mb-1">Top agents</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-400">
                {(['agentId', 'calls', 'blocked', 'costUsd'] as SortColumn[]).map((column) => (
                  <th key={column} className="pb-1 cursor-pointer" onClick={() => setSortColumn(column)}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topAgents.map((agent) => (
                <tr key={agent.agentId} className="border-t border-slate-700">
                  <td>{agent.agentId}</td>
                  <td>{agent.calls}</td>
                  <td>{agent.blocked}</td>
                  <td>${agent.costUsd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
