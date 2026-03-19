import { ToolCard } from '../components/ToolCard';
import { TOOL_DEFINITIONS } from '../data/tools';
import { useBetLab } from '../state/BetLabContext';

export function ToolsPage() {
  const { favorites, toggleFavorite } = useBetLab();

  return (
    <section className="stack">
      <header>
        <h2>All Tools</h2>
        <p className="page-subtitle">Independent utilities you can grow over time.</p>
      </header>

      <div className="tool-grid">
        {TOOL_DEFINITIONS.map((tool) => (
          <ToolCard
            key={tool.id}
            tool={tool}
            isFavorite={favorites.includes(tool.id)}
            onToggleFavorite={toggleFavorite}
          />
        ))}
      </div>
    </section>
  );
}
