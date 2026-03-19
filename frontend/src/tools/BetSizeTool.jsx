import { useMemo, useState } from 'react';
import { useBetLab } from '../state/BetLabContext';
import { clearNumberInputUnlessSpinnerClick } from '../utils/numericInput';

function calculateKellyStake(bankroll, decimalOdds, winProbability, fraction) {
  const p = winProbability / 100;
  const b = decimalOdds - 1;
  if (b <= 0 || p <= 0 || p >= 1) return 0;
  const q = 1 - p;
  const kelly = (b * p - q) / b;
  return Math.max(0, bankroll * kelly * fraction);
}

export function BetSizeTool() {
  const [mode, setMode] = useState('percent');
  const [bankroll, setBankroll] = useState('1000');
  const [flatStake, setFlatStake] = useState('25');
  const [percentStake, setPercentStake] = useState('2');
  const [decimalOdds, setDecimalOdds] = useState('1.91');
  const [winProbability, setWinProbability] = useState('55');
  const [kellyFraction, setKellyFraction] = useState('0.5');
  const { addHistoryItem } = useBetLab();
  const clearInput = (setter) => () => setter('');

  const recommendation = useMemo(() => {
    const parsedBankroll = Number(bankroll);
    if (!parsedBankroll || parsedBankroll <= 0) return 0;
    if (mode === 'flat') return Math.max(0, Number(flatStake) || 0);
    if (mode === 'percent') return Math.max(0, parsedBankroll * ((Number(percentStake) || 0) / 100));
    return calculateKellyStake(
      parsedBankroll,
      Number(decimalOdds),
      Number(winProbability),
      Number(kellyFraction) || 0
    );
  }, [bankroll, mode, flatStake, percentStake, decimalOdds, winProbability, kellyFraction]);

  const saveSnapshot = () => {
    addHistoryItem({
      id: `${Date.now()}-bet-size`,
      toolName: 'Bet Size Calculator',
      summary: `${mode} mode - $${recommendation.toFixed(2)} stake`,
    });
  };

  return (
    <section className="stack">
      <header>
        <h2>Bet Size Calculator</h2>
        <p className="page-subtitle">Size bets with flat, bankroll %, or fractional Kelly logic.</p>
      </header>

      <div className="panel stack">
        <div className="row">
          <label>
            Mode
            <select value={mode} onChange={(event) => setMode(event.target.value)}>
              <option value="flat">Flat</option>
              <option value="percent">Percent of Bankroll</option>
              <option value="kelly">Fractional Kelly</option>
            </select>
          </label>
          <label>
            Bankroll
            <input
              className="incremental-number-input"
              type="number"
              min="0"
              step="1"
              value={bankroll}
              onChange={(event) => setBankroll(event.target.value)}
              onClick={(event) =>
                clearNumberInputUnlessSpinnerClick(event, clearInput(setBankroll))
              }
            />
          </label>
        </div>

        {mode === 'flat' && (
          <label>
            Flat Stake
            <input
              className="incremental-number-input"
              type="number"
              min="0"
              step="1"
              value={flatStake}
              onChange={(event) => setFlatStake(event.target.value)}
              onClick={(event) =>
                clearNumberInputUnlessSpinnerClick(event, clearInput(setFlatStake))
              }
            />
          </label>
        )}

        {mode === 'percent' && (
          <label>
            Stake %
            <input
              className="incremental-number-input"
              type="number"
              min="0"
              step="1"
              value={percentStake}
              onChange={(event) => setPercentStake(event.target.value)}
              onClick={(event) =>
                clearNumberInputUnlessSpinnerClick(event, clearInput(setPercentStake))
              }
            />
          </label>
        )}

        {mode === 'kelly' && (
          <div className="row">
            <label>
              Decimal Odds
              <input
                className="incremental-number-input"
                type="number"
                min="1.01"
                step="0.01"
                value={decimalOdds}
                onChange={(event) => setDecimalOdds(event.target.value)}
                onClick={(event) =>
                  clearNumberInputUnlessSpinnerClick(event, clearInput(setDecimalOdds))
                }
              />
            </label>
            <label>
              Win %
              <input
                className="incremental-number-input"
                type="number"
                min="0"
                max="100"
                step="1"
                value={winProbability}
                onChange={(event) => setWinProbability(event.target.value)}
                onClick={(event) =>
                  clearNumberInputUnlessSpinnerClick(event, clearInput(setWinProbability))
                }
              />
            </label>
            <label>
              Kelly Fraction
              <input
                className="incremental-number-input"
                type="number"
                min="0"
                step="0.01"
                value={kellyFraction}
                onChange={(event) => setKellyFraction(event.target.value)}
                onClick={(event) =>
                  clearNumberInputUnlessSpinnerClick(event, clearInput(setKellyFraction))
                }
              />
            </label>
          </div>
        )}

        <div className="stat-card">
          <span>Recommended Stake</span>
          <strong>${recommendation.toFixed(2)}</strong>
        </div>

        <button type="button" className="primary-button" onClick={saveSnapshot}>
          Save to History
        </button>
      </div>
    </section>
  );
}
