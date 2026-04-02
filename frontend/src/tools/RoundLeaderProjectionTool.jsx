import { useEffect, useMemo, useRef, useState } from 'react';
import { useBetLab } from '../state/BetLabContext';
import { useSortableTable } from '../hooks/useSortableTable';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

const DEFAULT_BASE_URL = 'https://www.pgatour.com/tournaments/2026/valspar-championship/R2026475/';

function formatSignedValue(value, digits = 2) {
  if (!Number.isFinite(value)) return '-';
  if (value > 0) return `+${value.toFixed(digits)}`;
  if (value === 0) return 'E';
  return value.toFixed(digits);
}

export function RoundLeaderProjectionTool() {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [loading, setLoading] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsRefreshing, setEventsRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [eventsError, setEventsError] = useState('');
  const [events, setEvents] = useState([]);
  const [eventsUpdatedAt, setEventsUpdatedAt] = useState(null);
  const [payload, setPayload] = useState(null);
  const [isInputExpanded, setIsInputExpanded] = useState(true);
  const [isHoleStatsExpanded, setIsHoleStatsExpanded] = useState(true);
  const playerProjectionsRef = useRef(null);
  const courseHoleStatsRef = useRef(null);
  const { addHistoryItem } = useBetLab();

  const projectedLeader = useMemo(() => payload?.players?.[0] || null, [payload]);
  const playerRows = useMemo(() => payload?.players || [], [payload]);
  const holeRows = useMemo(() => payload?.holeStats || [], [payload]);
  const courseAverageScore = useMemo(() => {
    if (!holeRows.length) return null;
    const totals = holeRows.reduce(
      (accumulator, hole) => {
        const averageScore = Number(hole.averageScore);
        const par = Number(hole.par);
        if (!Number.isFinite(averageScore) || !Number.isFinite(par)) return accumulator;
        return {
          avgScoreSum: accumulator.avgScoreSum + averageScore,
          parSum: accumulator.parSum + par,
          validCount: accumulator.validCount + 1,
        };
      },
      { avgScoreSum: 0, parSum: 0, validCount: 0 }
    );

    if (!totals.validCount) return null;
    return totals.avgScoreSum - totals.parSum;
  }, [holeRows]);

  const {
    sortedRows: sortedPlayers,
    requestSort: requestPlayerSort,
    getSortIndicator: getPlayerSortIndicator,
  } = useSortableTable(playerRows, {
    key: 'expectedFinalScoreNumber',
    direction: 'asc',
  });

  const {
    sortedRows: sortedHoleStats,
    requestSort: requestHoleSort,
    getSortIndicator: getHoleSortIndicator,
  } = useSortableTable(holeRows, {
    key: 'holeNumber',
    direction: 'asc',
  });
  const frontNineHoleStats = useMemo(
    () => sortedHoleStats.filter((hole) => Number(hole.holeNumber) >= 1 && Number(hole.holeNumber) <= 9),
    [sortedHoleStats]
  );
  const backNineHoleStats = useMemo(
    () => sortedHoleStats.filter((hole) => Number(hole.holeNumber) >= 10 && Number(hole.holeNumber) <= 18),
    [sortedHoleStats]
  );
  const frontNineTotals = useMemo(() => buildHoleTotals(frontNineHoleStats), [frontNineHoleStats]);
  const backNineTotals = useMemo(() => buildHoleTotals(backNineHoleStats), [backNineHoleStats]);
  const visibleEvents = useMemo(
    () =>
      events.filter((eventItem) => {
        const status = String(eventItem?.status || '').trim().toUpperCase();
        return status !== 'COMPLETED';
      }),
    [events]
  );

  const loadProjection = async (inputUrl = baseUrl) => {
    const requestedUrl = typeof inputUrl === 'string' ? inputUrl : baseUrl;
    const targetUrl = String(requestedUrl || '').trim();
    if (!targetUrl) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/tools/round-leader-projection`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          baseUrl: targetUrl,
        }),
      });

      const json = await response.json();
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to scrape PGA Tour data.');
      }

      setPayload(json.data);
      setBaseUrl(targetUrl);
    } catch (requestError) {
      setPayload(null);
      setError(requestError.message || 'Failed to build projection.');
    } finally {
      setLoading(false);
    }
  };

  const loadEvents = async (options = {}) => {
    const { refresh = false } = options;
    if (refresh) {
      setEventsRefreshing(true);
    } else {
      setEventsLoading(true);
    }
    setEventsError('');

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/tools/round-leader-projection/events${refresh ? '/refresh' : ''}`,
        {
          method: refresh ? 'POST' : 'GET',
          headers: {
            'content-type': 'application/json',
          },
        }
      );
      const json = await response.json();
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to load PGA TOUR events.');
      }

      setEvents(Array.isArray(json?.data?.events) ? json.data.events : []);
      setEventsUpdatedAt(json?.data?.updatedAt || null);
    } catch (requestError) {
      setEventsError(requestError.message || 'Failed to load PGA TOUR events.');
    } finally {
      setEventsLoading(false);
      setEventsRefreshing(false);
    }
  };

  const selectEvent = async (eventUrl) => {
    setBaseUrl(eventUrl);
    await loadProjection(eventUrl);
  };

  useEffect(() => {
    loadEvents();
  }, []);

  const saveSnapshot = () => {
    if (!payload || !projectedLeader) return;
    addHistoryItem({
      id: `${Date.now()}-round-leader-projection`,
      toolName: 'Round Leader Projection',
      summary: `Leader: ${projectedLeader.playerName} | Projected ${projectedLeader.expectedFinalScoreDisplay}`,
    });
  };

  const scrollToPlayerProjections = () => {
    playerProjectionsRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  const scrollToCourseHoleStats = () => {
    courseHoleStatsRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  const renderHoleStatsTable = (title, holeSet, totals) => (
    <div className="stack">
      <h4 className="rlp-hole-section-title">{title}</h4>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>
                <button type="button" className="table-sort-button" onClick={() => requestHoleSort('holeNumber')}>
                  Hole <span className="table-sort-indicator">{getHoleSortIndicator('holeNumber')}</span>
                </button>
              </th>
              <th>
                <button type="button" className="table-sort-button" onClick={() => requestHoleSort('par')}>
                  Par <span className="table-sort-indicator">{getHoleSortIndicator('par')}</span>
                </button>
              </th>
              <th>
                <button type="button" className="table-sort-button" onClick={() => requestHoleSort('yards')}>
                  Yards <span className="table-sort-indicator">{getHoleSortIndicator('yards')}</span>
                </button>
              </th>
              <th>
                <button type="button" className="table-sort-button" onClick={() => requestHoleSort('difficultyRank')}>
                  Rank <span className="table-sort-indicator">{getHoleSortIndicator('difficultyRank')}</span>
                </button>
              </th>
              <th>
                <button type="button" className="table-sort-button" onClick={() => requestHoleSort('averageScore')}>
                  Avg Score <span className="table-sort-indicator">{getHoleSortIndicator('averageScore')}</span>
                </button>
              </th>
              <th>
                <button type="button" className="table-sort-button" onClick={() => requestHoleSort('scoringAverageDiff')}>
                  Diff <span className="table-sort-indicator">{getHoleSortIndicator('scoringAverageDiff')}</span>
                </button>
              </th>
              <th>
                <button type="button" className="table-sort-button" onClick={() => requestHoleSort('birdies')}>
                  Birdies <span className="table-sort-indicator">{getHoleSortIndicator('birdies')}</span>
                </button>
              </th>
              <th>
                <button type="button" className="table-sort-button" onClick={() => requestHoleSort('pars')}>
                  Pars <span className="table-sort-indicator">{getHoleSortIndicator('pars')}</span>
                </button>
              </th>
              <th>
                <button type="button" className="table-sort-button" onClick={() => requestHoleSort('bogeys')}>
                  Bogeys <span className="table-sort-indicator">{getHoleSortIndicator('bogeys')}</span>
                </button>
              </th>
              <th>
                <button type="button" className="table-sort-button" onClick={() => requestHoleSort('doubleBogeys')}>
                  Doubles <span className="table-sort-indicator">{getHoleSortIndicator('doubleBogeys')}</span>
                </button>
              </th>
              <th>
                <button type="button" className="table-sort-button" onClick={() => requestHoleSort('eagles')}>
                  Eagles <span className="table-sort-indicator">{getHoleSortIndicator('eagles')}</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {holeSet.map((hole) => (
              <tr key={`hole-${hole.holeNumber}`}>
                <td>{hole.holeNumber}</td>
                <td>{hole.par}</td>
                <td>{hole.yards ?? '-'}</td>
                <td>{hole.difficultyRank ?? '-'}</td>
                <td>{hole.averageScore.toFixed(3)}</td>
                <td>{formatSignedValue(hole.scoringAverageDiff, 3)}</td>
                <td>{hole.birdies ?? '-'}</td>
                <td>{hole.pars ?? '-'}</td>
                <td>{hole.bogeys ?? '-'}</td>
                <td>{hole.doubleBogeys ?? '-'}</td>
                <td>{hole.eagles ?? '-'}</td>
              </tr>
            ))}
            <tr className="rlp-hole-summary-row">
              <td>{title} Total</td>
              <td>{totals.par}</td>
              <td>{totals.yards}</td>
              <td>-</td>
              <td>-</td>
              <td>{formatSignedValue(totals.scoringAverageDiff, 3)}</td>
              <td>{totals.birdies}</td>
              <td>{totals.pars}</td>
              <td>{totals.bogeys}</td>
              <td>{totals.doubleBogeys}</td>
              <td>{totals.eagles}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <section className="stack">
      <header>
        <h2>Round Leader Projection</h2>
        <p className="page-subtitle">
          Scrape live PGA TOUR data and project each player&apos;s expected final round score.
        </p>
      </header>

      <div className="panel stack">
        <div className="stack">
          <div className="row-between">
            <strong>Inputs</strong>
            <button
              type="button"
              className="ghost-button"
              onClick={() => setIsInputExpanded((previous) => !previous)}
            >
              {isInputExpanded ? 'Hide Inputs' : 'Show Inputs'}
            </button>
          </div>
          {isInputExpanded ? (
            <div className="stack">
              <div className="rlp-event-picker">
                <div className="row-between">
                  <strong className="rlp-event-picker-title">Event Picker</strong>
                  <button
                    type="button"
                    className="ghost-button rlp-event-refresh-button"
                    onClick={() => loadEvents({ refresh: true })}
                    disabled={eventsLoading || eventsRefreshing}
                  >
                    {eventsRefreshing ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>
                <p className="muted">
                  {eventsUpdatedAt
                    ? `Cached event list updated ${new Date(eventsUpdatedAt).toLocaleString()}.`
                    : 'Select an event below or use manual URL input.'}
                </p>
                {eventsError ? <p className="muted">{eventsError}</p> : null}
                <div className="rlp-event-list" role="list">
                  {eventsLoading ? <p className="muted">Loading PGA TOUR events...</p> : null}
                  {!eventsLoading && !visibleEvents.length ? (
                    <p className="muted">No events available yet. Try Refresh.</p>
                  ) : null}
                  {!eventsLoading
                    ? visibleEvents.map((eventItem) => (
                        <button
                          key={`${eventItem.id}-${eventItem.tournamentUrl}`}
                          type="button"
                          className="rlp-event-item"
                          onClick={() => selectEvent(eventItem.tournamentUrl)}
                          disabled={loading}
                        >
                          <span className="rlp-event-item-name">{eventItem.name}</span>
                          <span className="rlp-event-item-meta">
                            {[eventItem.roundLabel, eventItem.status, eventItem.displayDate]
                              .filter(Boolean)
                              .join(' | ') || 'Open tournament'}
                          </span>
                        </button>
                      ))
                    : null}
                </div>
              </div>

              <label>
                Tournament URL
                <input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://www.pgatour.com/tournaments/.../R2026xxx/"
                />
              </label>
            </div>
          ) : (
            <p className="muted">Inputs are hidden. Use Show Inputs to edit the source URL.</p>
          )}
          <div className="row">
            <button
              type="button"
              className="primary-button"
              onClick={loadProjection}
              disabled={loading || !baseUrl.trim()}
            >
              {loading ? 'Scraping...' : 'Scrape and Project'}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={saveSnapshot}
              disabled={!payload || !projectedLeader}
            >
              Save to History
            </button>
          </div>
        </div>

        {error ? <p className="muted">{error}</p> : null}

        {!payload ? (
          <p className="muted">
            Enter one tournament URL (base, leaderboard, or tourcast), run the scraper, then review player
            projections and course stats.
          </p>
        ) : (
          <>
            <div className="stack">
              <h3>{payload.tournamentName || 'Tournament'}</h3>
              <p className="muted">{payload.courseName || '-'}</p>
            </div>

            <section className="rlp-info-section">
              <h4>
                <button type="button" className="rlp-section-link" onClick={scrollToCourseHoleStats}>
                  Course Info
                </button>
              </h4>
              <div className="stat-grid rlp-player-info-grid">
                <div className="stat-card rlp-stat-card">
                  <span>Par</span>
                  <strong>{payload.coursePar ?? '-'}</strong>
                </div>
                <div className="stat-card rlp-stat-card">
                  <span>Yards</span>
                  <strong>{payload.courseYardageDisplay || '-'}</strong>
                </div>
                <div className="stat-card rlp-stat-card">
                  <span>Avg Score</span>
                  <strong>{Number.isFinite(courseAverageScore) ? courseAverageScore.toFixed(3) : '-'}</strong>
                </div>
              </div>
            </section>

            <section className="rlp-info-section">
              <h4>
                <button type="button" className="rlp-section-link" onClick={scrollToPlayerProjections}>
                  Player Info
                </button>
              </h4>
              <div className="stat-grid rlp-player-info-grid">
                <div className="stat-card rlp-stat-card">
                  <span>Players</span>
                  <strong>{payload.playerCount}</strong>
                </div>
                <div className="stat-card rlp-stat-card">
                  <span>Projected Leader</span>
                  <strong>{projectedLeader?.playerName || '-'}</strong>
                </div>
                <div className="stat-card rlp-stat-card">
                  <span>Projected Leader Score</span>
                  <strong>{projectedLeader?.expectedFinalScoreDisplay || '-'}</strong>
                </div>
              </div>
            </section>

            <div className="stack" ref={playerProjectionsRef}>
              <h3>Player Projections</h3>
              <div className={`table-wrap ${loading ? 'is-loading-dim' : ''}`}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>
                        <button type="button" className="table-sort-button" onClick={() => requestPlayerSort('playerName')}>
                          Player <span className="table-sort-indicator">{getPlayerSortIndicator('playerName')}</span>
                        </button>
                      </th>
                      <th>
                        <button type="button" className="table-sort-button" onClick={() => requestPlayerSort('scoreNumber')}>
                          Score <span className="table-sort-indicator">{getPlayerSortIndicator('scoreNumber')}</span>
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="table-sort-button"
                          onClick={() => requestPlayerSort('roundScoreNumber')}
                        >
                          Round <span className="table-sort-indicator">{getPlayerSortIndicator('roundScoreNumber')}</span>
                        </button>
                      </th>
                      <th>
                        <button type="button" className="table-sort-button" onClick={() => requestPlayerSort('thruRaw')}>
                          Thru <span className="table-sort-indicator">{getPlayerSortIndicator('thruRaw')}</span>
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="table-sort-button"
                          onClick={() => requestPlayerSort('startedOnBackNine')}
                        >
                          Started{' '}
                          <span className="table-sort-indicator">{getPlayerSortIndicator('startedOnBackNine')}</span>
                        </button>
                      </th>
                      <th>
                        <button type="button" className="table-sort-button" onClick={() => requestPlayerSort('currentHole')}>
                          Current Hole{' '}
                          <span className="table-sort-indicator">{getPlayerSortIndicator('currentHole')}</span>
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="table-sort-button"
                          onClick={() => requestPlayerSort('holesRemaining')}
                        >
                          Remaining{' '}
                          <span className="table-sort-indicator">{getPlayerSortIndicator('holesRemaining')}</span>
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="table-sort-button"
                          onClick={() => requestPlayerSort('expectedFinalScoreNumber')}
                        >
                          Projected{' '}
                          <span className="table-sort-indicator">
                            {getPlayerSortIndicator('expectedFinalScoreNumber')}
                          </span>
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPlayers.map((player) => (
                      <tr key={player.playerName}>
                        <td>{player.playerName}</td>
                        <td>{player.currentScoreDisplay || player.scoreRaw}</td>
                        <td>{player.roundScoreRaw || '-'}</td>
                        <td>{player.thruRaw}</td>
                        <td>{player.startedOnBackNine ? 'Back' : 'Front'}</td>
                        <td>{player.currentHole}</td>
                        <td>{player.holesRemaining}</td>
                        <td>{formatSignedValue(player.expectedFinalScoreNumber)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="stack" ref={courseHoleStatsRef}>
              <div className="row-between">
                <h3>Course Hole Stats</h3>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setIsHoleStatsExpanded((previous) => !previous)}
                >
                  {isHoleStatsExpanded ? 'Collapse' : 'Expand'}
                </button>
              </div>
              {isHoleStatsExpanded ? (
                <div className="stack">
                  {renderHoleStatsTable('Front 9', frontNineHoleStats, frontNineTotals)}
                  {renderHoleStatsTable('Back 9', backNineHoleStats, backNineTotals)}
                </div>
              ) : (
                <p className="muted">Hole stats table is collapsed.</p>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function buildHoleTotals(holeSet) {
  return holeSet.reduce(
    (totals, hole) => ({
      par: totals.par + toFiniteNumber(hole.par),
      yards: totals.yards + toFiniteNumber(hole.yards),
      scoringAverageDiff: totals.scoringAverageDiff + toFiniteNumber(hole.scoringAverageDiff),
      birdies: totals.birdies + toFiniteNumber(hole.birdies),
      pars: totals.pars + toFiniteNumber(hole.pars),
      bogeys: totals.bogeys + toFiniteNumber(hole.bogeys),
      doubleBogeys: totals.doubleBogeys + toFiniteNumber(hole.doubleBogeys),
      eagles: totals.eagles + toFiniteNumber(hole.eagles),
    }),
    {
      par: 0,
      yards: 0,
      scoringAverageDiff: 0,
      birdies: 0,
      pars: 0,
      bogeys: 0,
      doubleBogeys: 0,
      eagles: 0,
    }
  );
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
