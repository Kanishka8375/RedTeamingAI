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

function riskLabelClass(risk: number): string {
  if (risk > 80) return 'risk-pill critical';
  if (risk > 60) return 'risk-pill high';
  if (risk >= 30) return 'risk-pill medium';
  return 'risk-pill low';
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
    setEvents(initialEvents);
  }, [initialEvents]);

  useEffect(() => {
    if (!lastEvent || paused) {
      return;
    }

    setEvents((prev) => (prev[0]?.id === lastEvent.id ? prev : [lastEvent, ...prev].slice(0, 100)));
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
    <section className="card">
      <div className="card-head">
        <h2>Event Feed</h2>
        <span className={`status-dot ${connected ? 'ok' : 'warn'}`}>{connected ? 'Realtime connected' : 'Reconnecting...'}</span>
      </div>

      <div className="metric-grid">
        <div><span>Calls/min</span><strong>{summary.minuteCalls}</strong></div>
        <div><span>Active agents</span><strong>{summary.activeAgents}</strong></div>
        <div><span>Blocked</span><strong>{summary.blocksToday}</strong></div>
        <div><span>Cost</span><strong>${summary.costToday.toFixed(4)}</strong></div>
      </div>

      <div className="sparkline-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={summary.sparkline}>
            <Line type="monotone" dataKey="risk" stroke="#03d9ff" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="toolbar">
        <input value={agentSearch} onChange={(e) => setAgentSearch(e.target.value)} placeholder="Filter by agent id" />
        <div className="button-row">
          {(['all', 'low', 'medium', 'high'] as RiskFilter[]).map((filter) => (
            <button key={filter} className={riskFilter === filter ? 'active' : ''} onClick={() => setRiskFilter(filter)}>
              {filter}
            </button>
          ))}
        </div>
        <label><input type="checkbox" checked={blockedOnly} onChange={(e) => setBlockedOnly(e.target.checked)} /> blocked only</label>
        <button onClick={() => setPaused((v) => !v)}>{paused ? 'Resume' : 'Pause'}</button>
      </div>

      <div className="events-list">
        {filteredEvents.map((event) => {
          const expanded = expandedId === event.id;
          return (
            <article key={event.id} className="event-item">
              <button className="event-row" onClick={() => setExpandedId(expanded ? null : event.id)}>
                <span>{relativeTime(event.timestamp)}</span>
                <span>{event.agentId ?? 'unknown'}</span>
                <span className="model-pill">{event.model}</span>
                <span>{event.toolCallsRequested.slice(0, 3).join(', ') || 'no tools'}</span>
                <span className={riskLabelClass(event.riskScore)}>{event.riskScore}</span>
                <span>${event.costUsd.toFixed(4)}</span>
                <span className={`block-pill ${event.blocked ? 'blocked' : 'allowed'}`}>{event.blocked ? 'blocked' : 'allowed'}</span>
              </button>

              {expanded ? (
                <div className="event-details">
                  <p><strong>Flags:</strong> {event.anomalyFlags.join(', ') || 'none'}</p>
                  <pre>{JSON.stringify(event, null, 2)}</pre>
                </div>
              ) : null}
            </article>
          );
        })}
        {filteredEvents.length === 0 ? <p className="empty">No events match these filters.</p> : null}
      </div>
    </section>
  );
}
