import { useMemo, useState } from 'react';
import { useBetLab } from '../state/BetLabContext';
import { americanToDecimal, decimalToAmerican, formatAmerican } from '../utils/odds';
import { clearNumberInputUnlessSpinnerClick } from '../utils/numericInput';

function parseAmericanOdds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.trunc(parsed);
  if (rounded <= -101 || rounded >= 100) return rounded;
  return null;
}

function normalizeAmericanOddsInput(rawValue, previousValue) {
  if (rawValue === '') return '';
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return rawValue;

  // Handle spinner transitions across the invalid -100..+99 window.
  const previousParsed = Number(previousValue);
  if (parsed === -100 && previousParsed === -101) return '100';
  if (parsed === 99 && previousParsed === 100) return '-101';

  return rawValue;
}

export function ParlayTool() {
  const [stake, setStake] = useState('25');
  const [legs, setLegs] = useState(['-110', '-105']);
  const { addHistoryItem } = useBetLab();
  const clearInput = (setter) => () => setter('');

  const parsedLegs = useMemo(() => legs.map((value) => parseAmericanOdds(value)), [legs]);
  const hasInvalidLegs = useMemo(() => parsedLegs.some((value) => value === null), [parsedLegs]);
  const totalDecimal = useMemo(() => {
    if (hasInvalidLegs) return null;
    const converted = parsedLegs.map((american) => americanToDecimal(american)).filter(Boolean);
    if (converted.length === 0) return null;
    return converted.reduce((acc, value) => acc * value, 1);
  }, [parsedLegs, hasInvalidLegs]);
  const totalAmerican = totalDecimal ? decimalToAmerican(totalDecimal) : null;
  const payout = totalDecimal ? (Number(stake) || 0) * totalDecimal : 0;

  const updateLeg = (index, value) => {
    setLegs((prev) =>
      prev.map((leg, i) => (i === index ? normalizeAmericanOddsInput(value, leg) : leg))
    );
  };

  const addLeg = () => setLegs((prev) => [...prev, '-110']);
  const removeLeg = (index) => setLegs((prev) => prev.filter((_, i) => i !== index));

  const saveSnapshot = () => {
    if (!totalDecimal) return;
    addHistoryItem({
      id: `${Date.now()}-parlay`,
      toolName: 'Parlay Builder',
      summary: `${legs.length} legs - ${formatAmerican(totalAmerican)} - $${payout.toFixed(2)} return`,
    });
  };

  return (
    <section className="stack">
      <header>
        <h2>Parlay Builder</h2>
        <p className="page-subtitle">Stack leg prices and estimate total payout instantly.</p>
      </header>

      <div className="panel stack">
        <label>
          Stake
          <input
            className="incremental-number-input"
            type="number"
            min="0"
            step="1"
            value={stake}
            onChange={(event) => setStake(event.target.value)}
            onClick={(event) =>
              clearNumberInputUnlessSpinnerClick(event, clearInput(setStake))
            }
          />
        </label>

        <div className="stack">
          {legs.map((leg, index) => (
            <div className="row" key={`leg-${index}`}>
              <label className="grow">
                Leg {index + 1} (American)
                <input
                  className="incremental-number-input"
                  type="number"
                  step="1"
                  min="-10000"
                  max="10000"
                  value={leg}
                  onChange={(event) => updateLeg(index, event.target.value)}
                  onClick={(event) =>
                    clearNumberInputUnlessSpinnerClick(event, () => updateLeg(index, ''))
                  }
                />
              </label>
              <button type="button" className="ghost-button" onClick={() => removeLeg(index)} disabled={legs.length <= 1}>
                Remove
              </button>
            </div>
          ))}
        </div>

        <button type="button" className="ghost-button" onClick={addLeg}>
          Add Leg
        </button>

        {hasInvalidLegs ? (
          <p className="muted">Leg odds must be American values at -101 or lower, or +100 or higher.</p>
        ) : null}

        <div className="stat-grid">
          <div className="stat-card">
            <span>Total American</span>
            <strong>{formatAmerican(totalAmerican)}</strong>
          </div>
          <div className="stat-card">
            <span>Total Decimal</span>
            <strong>{totalDecimal ? totalDecimal.toFixed(3) : '-'}</strong>
          </div>
          <div className="stat-card">
            <span>Projected Return</span>
            <strong>${payout.toFixed(2)}</strong>
          </div>
        </div>

        <button type="button" className="primary-button" onClick={saveSnapshot}>
          Save to History
        </button>
      </div>
    </section>
  );
}
