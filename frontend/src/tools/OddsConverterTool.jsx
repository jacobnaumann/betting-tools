import { useState } from 'react';
import { useBetLab } from '../state/BetLabContext';
import {
  americanToDecimal,
  americanToCents,
  centsToAmerican,
  centsToDecimal,
  decimalToCents,
  decimalToAmerican,
  formatAmerican,
  formatPercent,
  impliedProbabilityFromAmerican,
} from '../utils/odds';

export function OddsConverterTool() {
  const [inputType, setInputType] = useState('american');
  const [inputValue, setInputValue] = useState('');
  const { addHistoryItem } = useBetLab();

  const numeric = Number(inputValue);
  const hasInput = inputValue !== '';

  let americanOdds = null;
  let decimalOdds = null;
  let centsOdds = null;

  if (hasInput) {
    if (inputType === 'american') {
      americanOdds = numeric;
      decimalOdds = americanToDecimal(numeric);
      centsOdds = americanToCents(numeric);
    } else if (inputType === 'decimal') {
      decimalOdds = numeric;
      americanOdds = decimalToAmerican(numeric);
      centsOdds = decimalToCents(numeric);
    } else {
      centsOdds = numeric;
      americanOdds = centsToAmerican(numeric);
      decimalOdds = centsToDecimal(numeric);
    }
  }

  const impliedProbability = americanOdds === null
    ? null
    : impliedProbabilityFromAmerican(americanOdds);

  const saveSnapshot = () => {
    if (!inputValue || decimalOdds === null || americanOdds === null || impliedProbability === null) return;
    addHistoryItem({
      id: `${Date.now()}-odds`,
      toolName: 'Odds Converter',
      summary: `${formatAmerican(americanOdds)} | ${decimalOdds.toFixed(3)} | ${formatPercent(
        impliedProbability
      )}`,
    });
  };

  return (
    <section className="stack">
      <header>
        <h2>Odds Converter</h2>
        <p className="page-subtitle">Switch between American, Decimal, and Cents with implied probability.</p>
      </header>

      <div className="panel stack">
        <div className="row">
          <label>
            Input Type
            <select value={inputType} onChange={(event) => setInputType(event.target.value)}>
              <option value="american">American</option>
              <option value="decimal">Decimal</option>
              <option value="cents">Cents</option>
            </select>
          </label>
          <label>
            Odds
            <input
              className="incremental-number-input"
              type="number"
              min={inputType === 'decimal' ? '1.01' : inputType === 'cents' ? '0.01' : undefined}
              max={inputType === 'cents' ? '99.99' : undefined}
              step={inputType === 'decimal' || inputType === 'cents' ? '0.01' : '1'}
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              placeholder={inputType === 'american' ? '-110' : inputType === 'decimal' ? '1.91' : '20'}
            />
          </label>
        </div>

        <div className="stat-grid">
          <div className="stat-card">
            <span>American</span>
            <strong>{formatAmerican(americanOdds)}</strong>
          </div>
          <div className="stat-card">
            <span>Decimal</span>
            <strong>{decimalOdds ? decimalOdds.toFixed(3) : '-'}</strong>
          </div>
          <div className="stat-card">
            <span>Cents</span>
            <strong>{centsOdds === null || Number.isNaN(centsOdds) ? '-' : centsOdds.toFixed(2)}</strong>
          </div>
          <div className="stat-card">
            <span>Implied Probability</span>
            <strong>{formatPercent(impliedProbability)}</strong>
          </div>
        </div>

        <p className="muted">Cents represents implied win probability percentage (example: 20 cents = 20%).</p>

        <button type="button" className="primary-button" onClick={saveSnapshot}>
          Save to History
        </button>
      </div>
    </section>
  );
}
