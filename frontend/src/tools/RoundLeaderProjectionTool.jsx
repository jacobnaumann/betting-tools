import { useMemo, useState } from 'react';
import { useBetLab } from '../state/BetLabContext';
import { useSortableTable } from '../hooks/useSortableTable';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

const DEFAULT_LEADERBOARD_URL =
  'https://www.pgatour.com/tournaments/2026/valspar-championship/R2026475/leaderboard';
const DEFAULT_TOURCAST_URL =
  'https://www.pgatour.com/tournaments/2026/valspar-championship/R2026475/tourcast';

function formatSignedValue(value, digits = 2) {
  if (!Number.isFinite(value)) return '-';
  if (value > 0) return `+${value.toFixed(digits)}`;
  if (value === 0) return 'E';
  return value.toFixed(digits);
}

export function RoundLeaderProjectionTool() {
  const [leaderboardUrl, setLeaderboardUrl] = useState(DEFAULT_LEADERBOARD_URL);
  const [tourcastUrl, setTourcastUrl] = useState(DEFAULT_TOURCAST_URL);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState(null);
  const [isHoleStatsExpanded, setIsHoleStatsExpanded] = useState(false);
  const { addHistoryItem } = useBetLab();

  const projectedLeader = useMemo(() => payload?.players?.[0] || null, [payload]);
  const playerRows = useMemo(() => payload?.players || [], [payload]);
  const holeRows = useMemo(() => payload?.holeStats || [], [payload]);

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

  const loadProjection = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/tools/round-leader-projection`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          leaderboardUrl,
          tourcastUrl,
        }),
      });

      const json = await response.json();
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to scrape PGA Tour data.');
      }

      setPayload(json.data);
    } catch (requestError) {
      setPayload(null);
      setError(requestError.message || 'Failed to build projection.');
    } finally {
      setLoading(false);
    }
  };

  const saveSnapshot = () => {
    if (!payload || !projectedLeader) return;
    addHistoryItem({
      id: `${Date.now()}-round-leader-projection`,
      toolName: 'Round Leader Projection',
      summary: `Leader: ${projectedLeader.playerName} | Projected ${projectedLeader.expectedFinalScoreDisplay}`,
    });
  };

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
          <label>
            Leaderboard URL
            <input
              value={leaderboardUrl}
              onChange={(event) => setLeaderboardUrl(event.target.value)}
              placeholder="https://www.pgatour.com/.../leaderboard"
            />
          </label>
          <label>
            Tourcast URL
            <input
              value={tourcastUrl}
              onChange={(event) => setTourcastUrl(event.target.value)}
              placeholder="https://www.pgatour.com/.../tourcast"
            />
          </label>
          <div className="row">
            <button
              type="button"
              className="primary-button"
              onClick={loadProjection}
              disabled={loading || !leaderboardUrl.trim() || !tourcastUrl.trim()}
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
            Enter both URLs, run the scraper, then review hole stats and projected player finishes.
          </p>
        ) : (
          <>
            <div className="stat-grid">
              <div className="stat-card">
                <span>Players</span>
                <strong>{payload.playerCount}</strong>
              </div>
              <div className="stat-card">
                <span>Projected Leader</span>
                <strong>{projectedLeader?.playerName || '-'}</strong>
              </div>
              <div className="stat-card">
                <span>Projected Leader Score</span>
                <strong>{projectedLeader?.expectedFinalScoreDisplay || '-'}</strong>
              </div>
            </div>

            <div className="stack">
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
                          Current Score{' '}
                          <span className="table-sort-indicator">{getPlayerSortIndicator('scoreNumber')}</span>
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
                          Started Back 9{' '}
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
                          Holes Remaining{' '}
                          <span className="table-sort-indicator">{getPlayerSortIndicator('holesRemaining')}</span>
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="table-sort-button"
                          onClick={() => requestPlayerSort('expectedFinalScoreNumber')}
                        >
                          Expected Final Score{' '}
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
                        <td>{player.thruRaw}</td>
                        <td>{player.startedOnBackNine ? 'Yes' : 'No'}</td>
                        <td>{player.currentHole}</td>
                        <td>{player.holesRemaining}</td>
                        <td>{formatSignedValue(player.expectedFinalScoreNumber)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="stack">
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
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>
                          <button
                            type="button"
                            className="table-sort-button"
                            onClick={() => requestHoleSort('holeNumber')}
                          >
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
                          <button
                            type="button"
                            className="table-sort-button"
                            onClick={() => requestHoleSort('averageScore')}
                          >
                            Avg Score <span className="table-sort-indicator">{getHoleSortIndicator('averageScore')}</span>
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedHoleStats.map((hole) => (
                        <tr key={`hole-${hole.holeNumber}`}>
                          <td>{hole.holeNumber}</td>
                          <td>{hole.par}</td>
                          <td>{hole.yards ?? '-'}</td>
                          <td>{hole.averageScore.toFixed(3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
