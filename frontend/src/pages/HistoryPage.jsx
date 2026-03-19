import { useBetLab } from '../state/BetLabContext';

export function HistoryPage() {
  const { history, clearHistory } = useBetLab();

  return (
    <section className="stack">
      <header className="row-between">
        <div>
          <h2>History</h2>
          <p className="page-subtitle">Saved calculations and quick snapshots.</p>
        </div>
        <button type="button" className="ghost-button" onClick={clearHistory}>
          Clear History
        </button>
      </header>

      <div className="panel">
        {history.length === 0 ? (
          <p className="muted">No saved history yet.</p>
        ) : (
          <ul className="history-list">
            {history.map((item) => (
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
