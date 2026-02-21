type Section = 'events' | 'cost' | 'policies' | 'agents';

interface SidebarProps {
  active: Section;
  onChange: (section: Section) => void;
}

const navItems: Array<{ id: Section; label: string; subtitle: string }> = [
  { id: 'events', label: 'Live Events', subtitle: 'Realtime feed and security flags' },
  { id: 'cost', label: 'Cost & Risk', subtitle: 'Usage analytics and trends' },
  { id: 'policies', label: 'Policies', subtitle: 'Create and test safeguards' },
  { id: 'agents', label: 'Agents', subtitle: 'Most active and blocked IDs' }
];

export default function Sidebar({ active, onChange }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <h1>RedTeamingAI</h1>
        <p>Security and trust layer for AI agents</p>
      </div>

      <nav>
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${active === item.id ? 'active' : ''}`}
            onClick={() => onChange(item.id)}
          >
            <strong>{item.label}</strong>
            <span>{item.subtitle}</span>
          </button>
        ))}
      </nav>

      <footer className="sidebar-footer">MIT Licensed • Open Source</footer>
    </aside>
  );
}
