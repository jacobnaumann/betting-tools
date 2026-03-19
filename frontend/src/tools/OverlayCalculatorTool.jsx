import { useMemo, useState } from 'react';
import { useBetLab } from '../state/BetLabContext';
import { clearNumberInputUnlessSpinnerClick } from '../utils/numericInput';

function toPositiveNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function OverlayCalculatorTool() {
  const [entryFee, setEntryFee] = useState('20');
  const [prizePool, setPrizePool] = useState('10000');
  const [entries, setEntries] = useState('420');
  const { addHistoryItem } = useBetLab();
  const clearInput = (setter) => () => setter('');

  const results = useMemo(() => {
    const fee = toPositiveNumber(entryFee);
    const pool = toPositiveNumber(prizePool);
    const currentEntries = toPositiveNumber(entries);

    if (!fee || !pool || !currentEntries) return null;

    const totalCollected = fee * currentEntries;
    const totalOverlay = Math.max(0, pool - totalCollected);
    const overlayPerPlayerDollars = totalOverlay / currentEntries;
    const overlayPerPlayerPercent = (overlayPerPlayerDollars / fee) * 100;

    return {
      totalOverlay,
      overlayPerPlayerDollars,
      overlayPerPlayerPercent,
    };
  }, [entryFee, prizePool, entries]);

  const saveSnapshot = () => {
    if (!results) return;
    addHistoryItem({
      id: `${Date.now()}-overlay`,
      toolName: 'Overlay Calculator',
      summary: `Overlay $${results.totalOverlay.toFixed(2)} | Per player $${results.overlayPerPlayerDollars.toFixed(
        2
      )} (${results.overlayPerPlayerPercent.toFixed(2)}%)`,
    });
  };

  return (
    <section className="stack">
      <header>
        <h2>Overlay Calculator</h2>
        <p className="page-subtitle">Calculate total overlay and overlay value per player.</p>
      </header>

      <div className="panel stack">
        <div className="row">
          <label>
            Entry Fee
            <input
              className="incremental-number-input"
              type="number"
              min="0"
              step="1"
              value={entryFee}
              onChange={(event) => setEntryFee(event.target.value)}
              onClick={(event) =>
                clearNumberInputUnlessSpinnerClick(event, clearInput(setEntryFee))
              }
            />
          </label>
          <label>
            Prize Pool
            <input
              className="incremental-number-input"
              type="number"
              min="0"
              step="1"
              value={prizePool}
              onChange={(event) => setPrizePool(event.target.value)}
              onClick={(event) =>
                clearNumberInputUnlessSpinnerClick(event, clearInput(setPrizePool))
              }
            />
          </label>
          <label>
            Current Entries
            <input
              className="incremental-number-input"
              type="number"
              min="0"
              step="1"
              value={entries}
              onChange={(event) => setEntries(event.target.value)}
              onClick={(event) =>
                clearNumberInputUnlessSpinnerClick(event, clearInput(setEntries))
              }
            />
          </label>
        </div>

        {!results ? (
          <p className="muted">Enter valid positive values to calculate overlay.</p>
        ) : (
          <div className="stat-grid">
            <div className="stat-card">
              <span>Total Overlay</span>
              <strong>${results.totalOverlay.toFixed(2)}</strong>
            </div>
            <div className="stat-card">
              <span>Overlay Per Player ($)</span>
              <strong>${results.overlayPerPlayerDollars.toFixed(2)}</strong>
            </div>
            <div className="stat-card">
              <span>Overlay Per Player (%)</span>
              <strong>{results.overlayPerPlayerPercent.toFixed(2)}%</strong>
            </div>
          </div>
        )}

        <button type="button" className="primary-button" onClick={saveSnapshot} disabled={!results}>
          Save to History
        </button>
      </div>
    </section>
  );
}
