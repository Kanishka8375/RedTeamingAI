import { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import type { LoggedEvent } from '../../../src/types';
import { useWebSocket } from '../hooks/useWebSocket';

interface EventFeedProps {
  apiKey: string;
  initialEvents: LoggedEvent[];
}

type RiskFilter = 'all' | 'low' | 'medium' | 'high';

function relativeTime(iso: string): string {
  const deltaSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  return `${Math.floor(deltaSec / 3600)}h ago`;
}

function riskClass(risk: number): string {
  if (risk > 80) return 'bg-red-500 text-white animate-pulse';
  if (risk > 60) return 'bg-red-500/20 text-red-300';
  if (risk >= 30) return 'bg-yellow-400/20 text-yellow-200';
  return 'bg-emerald-500/20 text-emerald-200';
}

export default function EventFeed({ apiKey, initialEvents }: EventFeedProps) {
  const { connected, lastEvent } = useWebSocket(apiKey);
  const [events, setEvents] = useState<LoggedEvent[]>(initialEvents);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [agentSearch, setAgentSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!lastEvent || paused) {
      return;
    }
    setEvents((prev) => (prev.length === 0 || prev[0]?.id !== lastEvent.id ? [lastEvent, ...prev].slice(0, 100) : prev));
  }, [lastEvent, paused]);

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (blockedOnly && !event.blocked) return false;
      if (agentSearch && !(event.agentId ?? '').toLowerCase().includes(agentSearch.toLowerCase())) return false;
      if (riskFilter === 'low' && event.riskScore >= 30) return false;
      if (riskFilter === 'medium' && (event.riskScore < 30 || event.riskScore > 60)) return false;
      if (riskFilter === 'high' && event.riskScore <= 60) return false;
      return true;
    });
  }, [events, blockedOnly, agentSearch, riskFilter]);

  const summary = useMemo(() => {
    const now = Date.now();
    const minuteCalls = events.filter((event) => now - new Date(event.timestamp).getTime() <= 60_000).length;
    const activeAgents = new Set(events.map((event) => event.agentId ?? 'unknown')).size;
    const blocksToday = events.filter((event) => event.blocked).length;
    const costToday = events.reduce((sum, event) => sum + event.costUsd, 0);
    const sparkline = events.slice(0, 12).reverse().map((event, idx) => ({ idx, risk: event.riskScore }));
    return { minuteCalls, activeAgents, blocksToday, costToday, sparkline };
  }, [events]);

  return (
    <section className="bg-slate-900 border border-slate-800 rounded p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-cyan-300 font-semibold">Event Feed</h2>
        <span className={`text-xs px-2 py-1 rounded ${connected ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
          {connected ? 'WS Connected' : 'WS Reconnecting'}
        </span>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 mb-3 text-xs">
        <div className="bg-slate-800 rounded p-2">Calls/min <b>{summary.minuteCalls}</b></div>
        <div className="bg-slate-800 rounded p-2">Active agents <b>{summary.activeAgents}</b></div>
        <div className="bg-slate-800 rounded p-2">Blocks today <b>{summary.blocksToday}</b></div>
        <div className="bg-slate-800 rounded p-2">Cost today <b>${summary.costToday.toFixed(4)}</b></div>
      </div>

      <div className="h-12 mb-3 bg-slate-800 rounded p-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={summary.sparkline}>
            <Line type="monotone" dataKey="risk" stroke="#00e5ff" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input value={agentSearch} onChange={(e) => setAgentSearch(e.target.value)} placeholder="Search agentId" className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm" />
        {(['all', 'low', 'medium', 'high'] as RiskFilter[]).map((filter) => (
          <button key={filter} onClick={() => setRiskFilter(filter)} className={`px-2 py-1 rounded text-xs ${riskFilter === filter ? 'bg-cyan-500 text-slate-950' : 'bg-slate-800 text-slate-200'}`}>
            {filter}
          </button>
        ))}
        <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={blockedOnly} onChange={(e) => setBlockedOnly(e.target.checked)} /> blocked only</label>
        <button onClick={() => setPaused((v) => !v)} className="px-2 py-1 rounded text-xs bg-slate-800">{paused ? 'Resume' : 'Pause'}</button>
      </div>

      <div className="space-y-2 max-h-[34rem] overflow-auto">
        {filteredEvents.map((event) => {
          const expanded = expandedId === event.id;
          return (
            <article key={event.id} className="bg-slate-800 rounded border border-slate-700">
              <button onClick={() => setExpandedId(expanded ? null : event.id)} className="w-full text-left px-3 py-2 text-sm">
                <div className="grid grid-cols-7 gap-2 items-center">
                  <span className="text-slate-400 text-xs">{relativeTime(event.timestamp)}</span>
                  <span>{event.agentId ?? 'unknown'}</span>
                  <span className="text-xs bg-slate-700 px-2 py-1 rounded inline-block">{event.model}</span>
                  <span className="col-span-2 text-xs">
                    {event.toolCallsRequested.slice(0, 3).map((tool) => (
                      <span key={tool} className="inline-block bg-slate-700 px-1.5 py-0.5 rounded mr-1">{tool}</span>
                    ))}
                    {event.toolCallsRequested.length > 3 ? <span className="text-slate-400">+{event.toolCallsRequested.length - 3}</span> : null}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded text-center ${riskClass(event.riskScore)}`}>{event.riskScore}</span>
                  <span className="text-right text-xs">${event.costUsd.toFixed(4)} {event.blocked ? <span className="ml-1 px-1 py-0.5 rounded bg-red-500/20 text-red-300">blocked</span> : null}</span>
                </div>
              </button>
              {expanded ? (
                <div className="px-3 pb-3 text-xs text-slate-200 border-t border-slate-700">
                  <p className="mt-2"><b>Security flags:</b> {event.anomalyFlags.join(', ') || 'none'}</p>
                  <p><b>Policy violations:</b> {event.anomalyFlags.join(', ') || 'none'}</p>
                  <pre className="mt-2 bg-slate-950 p-2 rounded overflow-auto">{JSON.stringify(event, null, 2)}</pre>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
