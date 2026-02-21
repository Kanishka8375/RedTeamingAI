import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import type { AgentStat, StatsResult } from '../../../src/types';

interface CostDashboardProps {
  stats: StatsResult | null;
}

type SortColumn = keyof Pick<AgentStat, 'agentId' | 'calls' | 'blocked' | 'costUsd'>;

const COLORS = ['#00d4ff', '#3b82f6', '#ef4444', '#f59e0b'];

export default function CostDashboard({ stats }: CostDashboardProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('costUsd');
  const [descending, setDescending] = useState(true);

  const topAgents = useMemo(() => {
    const items = [...(stats?.topAgents ?? [])];
    items.sort((a, b) => {
      const left = a[sortColumn];
      const right = b[sortColumn];
      if (typeof left === 'string' && typeof right === 'string') {
        return descending ? right.localeCompare(left) : left.localeCompare(right);
      }
      return descending ? Number(right) - Number(left) : Number(left) - Number(right);
    });
    return items;
  }, [descending, sortColumn, stats?.topAgents]);

  if (!stats) {
    return <section className="card"><p>Stats are loading…</p></section>;
  }

  const riskData = [
    { name: 'Low', value: stats.riskDistribution.low },
    { name: 'Medium', value: stats.riskDistribution.medium },
    { name: 'High', value: stats.riskDistribution.high },
    { name: 'Critical', value: stats.riskDistribution.critical }
  ];

  return (
    <section className="card">
      <div className="card-head">
        <h2>Cost & Risk Dashboard</h2>
      </div>

      <div className="metric-grid four">
        <div><span>Total calls</span><strong>{stats.totalCalls}</strong></div>
        <div><span>Total cost</span><strong>${stats.totalCostUsd.toFixed(4)}</strong></div>
        <div><span>Blocked calls</span><strong>{stats.blockedCount}</strong></div>
        <div><span>Avg risk score</span><strong>{stats.avgRiskScore.toFixed(1)}</strong></div>
      </div>

      <div className="chart-grid">
        <div className="chart-box">
          <h3>Calls over time</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={stats.callsOverTime}>
              <defs>
                <linearGradient id="costFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00d4ff" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="#00d4ff" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#243447" />
              <XAxis dataKey="bucket" hide />
              <YAxis stroke="#9ca3af" />
              <Tooltip />
              <Area dataKey="calls" stroke="#00d4ff" fill="url(#costFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-box">
          <h3>Cost by model</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={stats.costByModel} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#243447" />
              <XAxis type="number" stroke="#9ca3af" />
              <YAxis dataKey="model" type="category" width={130} stroke="#9ca3af" />
              <Tooltip />
              <Bar dataKey="costUsd" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-box">
          <h3>Risk distribution</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={riskData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={80}>
                {riskData.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <h3>Top agents</h3>
      <table className="table">
        <thead>
          <tr>
            {[
              { key: 'agentId', label: 'Agent' },
              { key: 'calls', label: 'Calls' },
              { key: 'blocked', label: 'Blocked' },
              { key: 'costUsd', label: 'Cost (USD)' }
            ].map((col) => (
              <th key={col.key}>
                <button
                  onClick={() => {
                    if (sortColumn === col.key) {
                      setDescending((prev) => !prev);
                    } else {
                      setSortColumn(col.key as SortColumn);
                      setDescending(true);
                    }
                  }}
                >
                  {col.label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {topAgents.map((agent) => (
            <tr key={agent.agentId}>
              <td>{agent.agentId}</td>
              <td>{agent.calls}</td>
              <td>{agent.blocked}</td>
              <td>${agent.costUsd.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
