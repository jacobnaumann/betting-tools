import { Link } from 'react-router-dom';
import { TOOL_DEFINITIONS } from '../data/tools';
import { useBetLab } from '../state/BetLabContext';

export function DashboardPage() {
  const { favorites, history } = useBetLab();
  const favoriteTools = TOOL_DEFINITIONS.filter((tool) => favorites.includes(tool.id));
  const recent = history.slice(0, 5);

  return (
    <section className="stack">
      <header>
        <h2>Dashboard</h2>
        <p className="page-subtitle">Quick access to your most-used tools and latest calculations.</p>
      </header>

      <div className="panel">
        <h3>Favorite Tools</h3>
        {favoriteTools.length === 0 ? (
          <p className="muted">No favorites yet. Star some tools from the Tools page.</p>
        ) : (
          <div className="chip-row">
            {favoriteTools.map((tool) => (
              <Link key={tool.id} className="chip" to={tool.path}>
                {tool.name}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h3>Recent Activity</h3>
        {recent.length === 0 ? (
          <p className="muted">No activity yet. Use a tool and save a result.</p>
        ) : (
          <ul className="history-list">
            {recent.map((item) => (
              <li key={item.id}>
                <strong>{item.toolName}</strong>
                <span>{item.summary}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
