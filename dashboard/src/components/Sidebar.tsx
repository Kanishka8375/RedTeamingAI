const navItems = [
  'Live Events',
  'Cost & Usage',
  'Policies',
  'Agents',
  'Compliance',
  'Billing'
];

export default function Sidebar() {
  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 p-4">
      <h1 className="text-xl font-semibold text-cyan-300 mb-6">RedTeamingAI</h1>
      <nav className="space-y-2">
        {navItems.map((item) => (
          <button key={item} className="w-full text-left px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200">
            {item}
          </button>
        ))}
      </nav>
    </aside>
  );
}
