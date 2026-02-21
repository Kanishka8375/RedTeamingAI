import Sidebar from './components/Sidebar';
import EventFeed from './components/EventFeed';
import CostDashboard from './components/CostDashboard';
import PolicyManager from './components/PolicyManager';
import AgentList from './components/AgentList';
import { useEvents } from './hooks/useEvents';
import { useStats } from './hooks/useStats';

export default function App() {
  const apiKey = 'demo';
  const events = useEvents(apiKey);
  const stats = useStats(apiKey);

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <Sidebar />
      <main className="flex-1 p-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
        <EventFeed apiKey={apiKey} initialEvents={events} />
        <CostDashboard stats={stats} />
        <PolicyManager apiKey={apiKey} recentEvents={events} />
        <AgentList />
      </main>
    </div>
  );
}
