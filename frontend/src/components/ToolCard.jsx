import { Link } from 'react-router-dom';

export function ToolCard({ tool, isFavorite, onToggleFavorite }) {
  return (
    <article className="tool-card">
      <div className="tool-card-top">
        <span className="tool-tag">{tool.category}</span>
        <button type="button" className="ghost-button" onClick={() => onToggleFavorite(tool.id)}>
          {isFavorite ? 'Unfavorite' : 'Favorite'}
        </button>
      </div>
      <h3>{tool.name}</h3>
      <p>{tool.description}</p>
      <Link className="primary-link" to={tool.path}>
        Open Tool
      </Link>
    </article>
  );
}
