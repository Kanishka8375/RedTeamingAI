import { useMemo, useState } from 'react';
import Sidebar from './components/Sidebar';
import EventFeed from './components/EventFeed';
import CostDashboard from './components/CostDashboard';
import PolicyManager from './components/PolicyManager';
import AgentList from './components/AgentList';
import { useEvents } from './hooks/useEvents';
import { useStats } from './hooks/useStats';

type Section = 'events' | 'cost' | 'policies' | 'agents';

export default function App() {
  const [apiKey, setApiKey] = useState('demo');
  const [section, setSection] = useState<Section>('events');
  const events = useEvents(apiKey);
  const stats = useStats(apiKey);

  const title = useMemo(() => {
    const labels: Record<Section, string> = {
      events: 'Live Events',
      cost: 'Cost & Risk Dashboard',
      policies: 'Policy Manager',
      agents: 'Top Agents'
    };
    return labels[section];
  }, [section]);

  return (
    <div className="app-shell">
      <Sidebar active={section} onChange={setSection} />
      <main className="content-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Open-source security layer for AI agents</p>
            <h1>{title}</h1>
          </div>
          <label className="api-key-field">
            <span>API key</span>
            <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="X-RedTeamingAI-Key" />
          </label>
        </header>

        <section className="panel-grid">
          {section === 'events' ? <EventFeed apiKey={apiKey} initialEvents={events} /> : null}
          {section === 'cost' ? <CostDashboard stats={stats} /> : null}
          {section === 'policies' ? <PolicyManager apiKey={apiKey} recentEvents={events} /> : null}
          {section === 'agents' ? <AgentList events={events} /> : null}
        </section>
      </main>
    </div>
  );
}
