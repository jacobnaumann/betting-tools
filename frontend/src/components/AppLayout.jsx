import { NavLink } from 'react-router-dom';
import { TOOL_DEFINITIONS } from '../data/tools';
import { useBetLab } from '../state/BetLabContext';

export function AppLayout({ children }) {
  const { theme, toggleTheme } = useBetLab();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>BetLab</h1>
          <p>Personal sports betting tools</p>
          <button type="button" className="theme-toggle" onClick={toggleTheme}>
            Theme: {theme === 'dark' ? 'Dark' : 'Light'}
          </button>
        </div>
        <nav className="main-nav">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/tools">All Tools</NavLink>
          <NavLink to="/history">History</NavLink>
        </nav>
        <div className="tool-shortcuts">
          <p>Quick Open</p>
          {TOOL_DEFINITIONS.map((tool) => (
            <NavLink key={tool.id} to={tool.path}>
              {tool.name}
            </NavLink>
          ))}
        </div>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
