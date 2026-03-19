import { useMemo, useState } from 'react';
import { useBetLab } from '../state/BetLabContext';
import { decimalToAmerican, formatAmerican } from '../utils/odds';
import { clearNumberInputUnlessSpinnerClick } from '../utils/numericInput';

const DEFAULT_EVENT_PROBABILITY = '50';

function toValidProbabilityDecimal(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0 || parsed > 100) return null;
  return parsed / 100;
}

function probabilityToDecimalOdds(probabilityDecimal) {
  if (!Number.isFinite(probabilityDecimal) || probabilityDecimal <= 0 || probabilityDecimal >= 1) return null;
  return 1 / probabilityDecimal;
}

export function ProbabilityCalculatorTool() {
  const [eventProbabilities, setEventProbabilities] = useState([
    DEFAULT_EVENT_PROBABILITY,
    DEFAULT_EVENT_PROBABILITY,
  ]);
  const { addHistoryItem } = useBetLab();

  const calculation = useMemo(() => {
    if (eventProbabilities.length === 0) {
      return {
        isValid: false,
        message: 'Add at least one event probability to calculate a combination.',
      };
    }

    const parsedEvents = eventProbabilities.map((value) => toValidProbabilityDecimal(value));

    if (parsedEvents.some((value) => value === null)) {
      return {
        isValid: false,
        message: 'Each event must be a number from 0 to 100.',
      };
    }

    const combinationDecimal = parsedEvents.reduce((acc, probability) => acc * probability, 1);
    const combinationPercent = combinationDecimal * 100;
    const notAllOccurPercent = (1 - combinationDecimal) * 100;
    const decimalOdds = probabilityToDecimalOdds(combinationDecimal);
    const americanOdds = decimalOdds === null ? null : decimalToAmerican(decimalOdds);
    const eventPercents = parsedEvents.map((value) => value * 100);
    const eventCount = eventPercents.length;
    const meanPercent = eventPercents.reduce((acc, value) => acc + value, 0) / eventCount;
    const variancePercentPoints = eventPercents.reduce((acc, value) => {
      const distance = value - meanPercent;
      return acc + distance * distance;
    }, 0) / eventCount;
    const stdDevPercentPoints = Math.sqrt(variancePercentPoints);
    const minPercent = Math.min(...eventPercents);
    const maxPercent = Math.max(...eventPercents);
    const rangePercentPoints = maxPercent - minPercent;
    const lowerBandPercent = Math.max(0, meanPercent - stdDevPercentPoints);
    const upperBandPercent = Math.min(100, meanPercent + stdDevPercentPoints);

    return {
      isValid: true,
      combinationDecimal,
      combinationPercent,
      notAllOccurPercent,
      decimalOdds,
      americanOdds,
      eventPercents,
      eventCount,
      meanPercent,
      variancePercentPoints,
      stdDevPercentPoints,
      minPercent,
      maxPercent,
      rangePercentPoints,
      lowerBandPercent,
      upperBandPercent,
    };
  }, [eventProbabilities]);

  const updateEvent = (index, value) => {
    setEventProbabilities((prev) => prev.map((item, i) => (i === index ? value : item)));
  };

  const clearEventInput = (index) => {
    setEventProbabilities((prev) => prev.map((item, i) => (i === index ? '' : item)));
  };

  const addEvent = () => {
    setEventProbabilities((prev) => [...prev, DEFAULT_EVENT_PROBABILITY]);
  };

  const removeEvent = (index) => {
    setEventProbabilities((prev) => prev.filter((_, i) => i !== index));
  };

  const saveSnapshot = () => {
    if (!calculation.isValid) return;
    addHistoryItem({
      id: `${Date.now()}-probability`,
      toolName: 'Probability Calculator',
      summary: `${eventProbabilities.length} events - ${calculation.combinationPercent.toFixed(4)}% all occur`,
    });
  };

  return (
    <section className="stack">
      <header>
        <h2>Probability Calculator</h2>
        <p className="page-subtitle">
          Multiply independent event probabilities to estimate the chance all events occur.
        </p>
      </header>

      <div className="panel stack">
        <div className="stack">
          {eventProbabilities.map((probability, index) => (
            <div className="row" key={`event-${index}`}>
              <label className="grow">
                Event {index + 1} Probability (%)
                <input
                  className="incremental-number-input"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={probability}
                  onChange={(event) => updateEvent(index, event.target.value)}
                  onClick={(event) =>
                    clearNumberInputUnlessSpinnerClick(event, () => clearEventInput(index))
                  }
                  placeholder="50"
                />
              </label>
              <button
                type="button"
                className="ghost-button"
                onClick={() => removeEvent(index)}
                disabled={eventProbabilities.length <= 1}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <button type="button" className="ghost-button" onClick={addEvent}>
          Add Event
        </button>

        {calculation.isValid && (
          <section className="probability-visual stack">
            <div className="row-between">
              <h3>Distribution Snapshot</h3>
              <p className="muted">{calculation.eventCount} events</p>
            </div>

            <div className="stat-grid">
              <div className="stat-card">
                <span>Mean Probability</span>
                <strong>{calculation.meanPercent.toFixed(2)}%</strong>
              </div>
              <div className="stat-card">
                <span>Std Dev (pp)</span>
                <strong>{calculation.stdDevPercentPoints.toFixed(2)}</strong>
              </div>
              <div className="stat-card">
                <span>Variance (pp^2)</span>
                <strong>{calculation.variancePercentPoints.toFixed(2)}</strong>
              </div>
              <div className="stat-card">
                <span>Range (pp)</span>
                <strong>{calculation.rangePercentPoints.toFixed(2)}</strong>
              </div>
            </div>

            <div className="probability-bars">
              {calculation.eventPercents.map((value, index) => (
                <div className="probability-bar-row" key={`distribution-event-${index}`}>
                  <div className="row-between">
                    <span>Event {index + 1}</span>
                    <strong>{value.toFixed(2)}%</strong>
                  </div>
                  <div className="probability-track">
                    <div
                      className="probability-band"
                      style={{
                        left: `${calculation.lowerBandPercent}%`,
                        width: `${Math.max(
                          0,
                          calculation.upperBandPercent - calculation.lowerBandPercent
                        )}%`,
                      }}
                    />
                    <div className="probability-fill" style={{ width: `${value}%` }} />
                    <div className="probability-mean-marker" style={{ left: `${calculation.meanPercent}%` }} />
                  </div>
                </div>
              ))}
            </div>

            <p className="muted">
              Band shows mean +/- 1 standard deviation. Marker shows mean. Bars show each event probability.
            </p>
          </section>
        )}

        {!calculation.isValid ? (
          <p className="muted">{calculation.message}</p>
        ) : (
          <div className="stat-grid">
            <div className="stat-card">
              <span>All Events Occur (Percent)</span>
              <strong>{calculation.combinationPercent.toFixed(4)}%</strong>
            </div>
            <div className="stat-card">
              <span>Equivalent Decimal Odds</span>
              <strong>{calculation.decimalOdds === null ? '-' : calculation.decimalOdds.toFixed(3)}</strong>
            </div>
            <div className="stat-card">
              <span>Equivalent American Odds</span>
              <strong>{formatAmerican(calculation.americanOdds)}</strong>
            </div>
            <div className="stat-card">
              <span>Not All Events Occur</span>
              <strong>{calculation.notAllOccurPercent.toFixed(4)}%</strong>
            </div>
          </div>
        )}

        <button type="button" className="primary-button" onClick={saveSnapshot} disabled={!calculation.isValid}>
          Save to History
        </button>
      </div>
    </section>
  );
}
