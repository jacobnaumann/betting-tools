import { useEffect, useMemo, useRef, useState } from 'react';
import { useBetLab } from '../state/BetLabContext';
import { useSortableTable } from '../hooks/useSortableTable';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

const DEFAULT_BASE_URL = 'https://www.pgatour.com/tournaments/2026/valspar-championship/R2026475/';
const DEFAULT_SELECTED_STATS = ['course_hole_model', 'par3_scoring_avg', 'par4_scoring_avg', 'par5_scoring_avg'];
const SG_TOTAL_STAT = 'sg_total';
const SG_COMPONENT_STATS = ['sg_t2g', 'sg_ott', 'sg_app', 'sg_arg', 'sg_putt'];
const STAT_GROUPS = [
  {
    id: 'course-hole',
    title: 'Course / Hole',
    options: [
      { key: 'course_hole_model', label: 'Course (Hole) Model' },
      { key: 'par3_scoring_avg', label: 'Par 3 Scoring Avg' },
      { key: 'par4_scoring_avg', label: 'Par 4 Scoring Avg' },
      { key: 'par5_scoring_avg', label: 'Par 5 Scoring Avg' },
    ],
  },
  {
    id: 'strokes-gained',
    title: 'Strokes Gained',
    options: [
      { key: 'sg_total', label: 'SG: Total' },
      { key: 'sg_t2g', label: 'SG: Tee-to-Green' },
      { key: 'sg_ott', label: 'SG: Off-the-Tee' },
      { key: 'sg_app', label: 'SG: Approach' },
      { key: 'sg_arg', label: 'SG: Around-the-Green' },
      { key: 'sg_putt', label: 'SG: Putting' },
    ],
  },
];
const PROJECTION_TABS = [
  { key: 'round', label: 'Round Leader' },
  { key: 'tournament', label: 'Tournament' },
];
const PLAYER_PROJECTION_STAT_KEYS = [
  'par3_scoring_avg',
  'par4_scoring_avg',
  'par5_scoring_avg',
  'sg_total',
  'sg_t2g',
  'sg_ott',
  'sg_app',
  'sg_arg',
  'sg_putt',
];
const PLAYER_EDITABLE_STAT_KEYS = new Set(PLAYER_PROJECTION_STAT_KEYS);

function formatSignedValue(value, digits = 2) {
  if (!Number.isFinite(value)) return '-';
  if (value > 0) return `+${value.toFixed(digits)}`;
  if (value === 0) return 'E';
  return value.toFixed(digits);
}

function formatWinPct(value) {
  if (!Number.isFinite(value)) return '-';
  return `${(value * 100).toFixed(1)}%`;
}

function formatWinTiePct(player, projectionScopeKey) {
  const winValue = projectionScopeKey === 'tournament' ? player?.winProbability : player?.winSoloProbability;
  const winPart = formatWinPct(winValue);
  const tiePart = formatWinPct(player?.tieForLeadProbability);
  if (winPart === '-' && tiePart === '-') return '-';
  return `${winPart} / ${tiePart}`;
}

function formatFairValueCents(value) {
  if (!Number.isFinite(value)) return '-';
  return `${value.toFixed(2)}c`;
}

function formatFairValueFromProbability(probability) {
  const probabilityValue = Number(probability);
  if (!Number.isFinite(probabilityValue)) return '-';
  return formatFairValueCents(probabilityValue * 100);
}

function buildTopFinishTooltip(player, cutoff) {
  const deadHeatProbability = Number(player?.[`top${cutoff}DeadHeatProbability`]);
  const rawProbability = Number(player?.[`top${cutoff}Probability`]);
  const deadHeatFvDisplay = formatFairValueFromProbability(deadHeatProbability);
  const rawFvDisplay = formatFairValueFromProbability(rawProbability);
  const deadHeatPctDisplay = formatWinPct(deadHeatProbability);
  const rawPctDisplay = formatWinPct(rawProbability);
  if (deadHeatFvDisplay === '-' && rawFvDisplay === '-') return '';
  return `Dead-heat FV: ${deadHeatFvDisplay} (${deadHeatPctDisplay}) | Raw Top-${cutoff} FV: ${rawFvDisplay} (${rawPctDisplay})`;
}

function toCsvCellValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function escapeCsvValue(value) {
  const asString = toCsvCellValue(value);
  if (!/[",\n\r]/.test(asString)) return asString;
  return `"${asString.replace(/"/g, '""')}"`;
}

function slugifyForFileName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function formatStatInputSource(source) {
  const sourceLabels = {
    manual_override: 'Manual override',
    stat_feed: 'Stat feed',
    field_mean_fallback: 'Field mean fallback',
    zero_fallback: 'Zero fallback',
    missing: 'Missing',
  };
  return sourceLabels[source] || 'Unknown source';
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
  const [selectedEventUrl, setSelectedEventUrl] = useState('');
  const [selectedStats, setSelectedStats] = useState(DEFAULT_SELECTED_STATS);
  const [uploadedSgCsv, setUploadedSgCsv] = useState(null);
  const [sgCsvValidation, setSgCsvValidation] = useState({
    status: 'idle',
    message: '',
  });
  const [playerStatOverrides, setPlayerStatOverrides] = useState({});
  const [playerScoreOverrides, setPlayerScoreOverrides] = useState({});
  const [payload, setPayload] = useState(null);
  const [activeProjectionTab, setActiveProjectionTab] = useState('round');
  const [isInputExpanded, setIsInputExpanded] = useState(true);
  const [isHoleStatsExpanded, setIsHoleStatsExpanded] = useState(true);
  const [projectionRowMovement, setProjectionRowMovement] = useState({});
  const [editingPlayer, setEditingPlayer] = useState(null);
  const [editDraftValues, setEditDraftValues] = useState({});
  const [editScoreDraft, setEditScoreDraft] = useState({
    totalScoreNumber: '',
    roundScoreNumber: '',
    completedHoles: '',
  });
  const [editError, setEditError] = useState('');
  const playerProjectionsRef = useRef(null);
  const courseHoleStatsRef = useRef(null);
  const sgCsvInputRef = useRef(null);
  const previousProjectionRanksRef = useRef(new Map());
  const previousProjectionTabRef = useRef('round');
  const movementResetTimerRef = useRef(null);
  const { addHistoryItem } = useBetLab();

  const projectionScopes = useMemo(() => payload?.projectionScopes || null, [payload]);
  const effectiveSelectedStats = useMemo(
    () => (Array.isArray(payload?.selectedStats) && payload.selectedStats.length ? payload.selectedStats : selectedStats),
    [payload, selectedStats]
  );
  const editableSelectedStats = useMemo(
    () => effectiveSelectedStats.filter((statKey) => PLAYER_EDITABLE_STAT_KEYS.has(statKey)),
    [effectiveSelectedStats]
  );
  const manualStatOverrideCount = useMemo(
    () =>
      Object.values(playerStatOverrides).reduce((count, statMap) => {
        const nextCount = statMap && typeof statMap === 'object' ? Object.keys(statMap).length : 0;
        return count + nextCount;
      }, 0),
    [playerStatOverrides]
  );
  const manualScoreOverrideCount = useMemo(
    () =>
      Object.values(playerScoreOverrides).reduce((count, scoreMap) => {
        const nextCount = scoreMap && typeof scoreMap === 'object' ? Object.keys(scoreMap).length : 0;
        return count + nextCount;
      }, 0),
    [playerScoreOverrides]
  );
  const manualOverrideCount = manualStatOverrideCount + manualScoreOverrideCount;
  const activeProjectionScope = useMemo(() => {
    if (!projectionScopes) return null;
    return projectionScopes[activeProjectionTab] || projectionScopes.round || null;
  }, [projectionScopes, activeProjectionTab]);
  const projectedLeader = useMemo(
    () => activeProjectionScope?.players?.[0] || payload?.players?.[0] || null,
    [activeProjectionScope, payload]
  );
  const playerRows = useMemo(
    () => activeProjectionScope?.players || payload?.players || [],
    [activeProjectionScope, payload]
  );
  const holeRows = useMemo(() => payload?.holeStats || [], [payload]);
  const remainingColumnLabel = useMemo(
    () => (activeProjectionTab === 'tournament' ? 'Remaining (Tourn)' : 'Remaining (Round)'),
    [activeProjectionTab]
  );
  const isTournamentProjection = activeProjectionTab === 'tournament';
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
  const projectionRanks = useMemo(() => {
    const sorted = [...playerRows]
      .filter((player) => player?.playerName)
      .sort((left, right) => {
        const leftScore = Number(left?.expectedFinalScoreNumber);
        const rightScore = Number(right?.expectedFinalScoreNumber);
        if (!Number.isFinite(leftScore) && !Number.isFinite(rightScore)) return 0;
        if (!Number.isFinite(leftScore)) return 1;
        if (!Number.isFinite(rightScore)) return -1;
        return leftScore - rightScore;
      });

    const nextRanks = new Map();
    sorted.forEach((player, index) => {
      nextRanks.set(player.playerName, index);
    });
    return nextRanks;
  }, [playerRows]);

  useEffect(() => {
    if (previousProjectionTabRef.current !== activeProjectionTab) {
      previousProjectionTabRef.current = activeProjectionTab;
      previousProjectionRanksRef.current = projectionRanks;
      setProjectionRowMovement({});
      return;
    }

    const previousRanks = previousProjectionRanksRef.current;
    if (!previousRanks.size) {
      previousProjectionRanksRef.current = projectionRanks;
      return;
    }

    const nextMovement = {};
    projectionRanks.forEach((nextRank, playerName) => {
      if (!previousRanks.has(playerName)) return;
      const previousRank = previousRanks.get(playerName);
      if (!Number.isFinite(previousRank) || !Number.isFinite(nextRank) || previousRank === nextRank) return;
      nextMovement[playerName] = nextRank < previousRank ? 'up' : 'down';
    });

    previousProjectionRanksRef.current = projectionRanks;

    if (!Object.keys(nextMovement).length) return;
    setProjectionRowMovement(nextMovement);

    if (movementResetTimerRef.current) {
      clearTimeout(movementResetTimerRef.current);
    }
    movementResetTimerRef.current = setTimeout(() => {
      setProjectionRowMovement({});
      movementResetTimerRef.current = null;
    }, 1400);
  }, [projectionRanks, activeProjectionTab]);

  useEffect(
    () => () => {
      if (movementResetTimerRef.current) {
        clearTimeout(movementResetTimerRef.current);
      }
    },
    []
  );

  const loadProjection = async (inputUrl = baseUrl, options = {}) => {
    const statOverridesForRequest =
      options.statOverrides && typeof options.statOverrides === 'object' ? options.statOverrides : playerStatOverrides;
    const scoreOverridesForRequest =
      options.scoreOverrides && typeof options.scoreOverrides === 'object' ? options.scoreOverrides : playerScoreOverrides;
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
          selectedStats,
          statOverrides: statOverridesForRequest,
          scoreOverrides: scoreOverridesForRequest,
          uploadedSgCsv,
        }),
      });

      const json = await response.json();
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to scrape PGA Tour data.');
      }

      setPayload(json.data);
      setBaseUrl(targetUrl);
      setSelectedEventUrl(targetUrl);
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

  const selectEvent = (eventUrl) => {
    setBaseUrl(eventUrl);
    setSelectedEventUrl(eventUrl);
  };

  const handleSgCsvUpload = async (event) => {
    const file = event.target?.files?.[0];
    if (!file) {
      setUploadedSgCsv(null);
      setSgCsvValidation({
        status: 'idle',
        message: '',
      });
      return;
    }

    setSgCsvValidation({
      status: 'validating',
      message: `Validating ${file.name}...`,
    });

    try {
      const content = await file.text();
      if (!content.trim()) {
        throw new Error('Selected SG CSV is empty.');
      }
      const nextUploadedSgCsv = {
        fileName: file.name,
        content,
      };
      const response = await fetch(`${API_BASE_URL}/api/tools/round-leader-projection/validate-sg-csv`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          uploadedSgCsv: nextUploadedSgCsv,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Uploaded SG CSV failed validation.');
      }

      setUploadedSgCsv(nextUploadedSgCsv);
      setSgCsvValidation({
        status: 'valid',
        message: `OK: SG CSV structure is valid (${json?.data?.playerRowCount || 0} player rows).`,
      });
    } catch (uploadError) {
      setUploadedSgCsv(null);
      setSgCsvValidation({
        status: 'invalid',
        message: uploadError.message || 'Could not validate the selected SG CSV file.',
      });
      if (sgCsvInputRef.current) {
        sgCsvInputRef.current.value = '';
      }
    }
  };

  const clearUploadedSgCsv = () => {
    setUploadedSgCsv(null);
    setSgCsvValidation({
      status: 'idle',
      message: '',
    });
    if (sgCsvInputRef.current) {
      sgCsvInputRef.current.value = '';
    }
  };

  const exportPlayerProjectionsCsv = () => {
    if (!sortedPlayers.length) return;

    const csvHeaders = [
      'projection_scope',
      'projection_scope_label',
      'tournament_name',
      'display_date',
      'selected_stats',
      'player_name',
      'normalized_player_name',
      'score_display',
      'score_number',
      'round_display',
      'round_number',
      'thru',
      'started_on_back_nine',
      'player_state',
      'current_hole',
      'remaining_current_scope',
      'remaining_current_round',
      'remaining_future_rounds',
      'rounds_remaining_after_current',
      'remaining_holes',
      'remaining_par3_count',
      'remaining_par4_count',
      'remaining_par5_count',
      'win_tie_pct_display',
      'win_probability',
      'win_solo_probability',
      'tie_for_lead_probability',
      'win_tie_probability',
      'fair_value_yes_cents',
      'top_20_dead_heat_probability',
      'top_20_raw_probability',
      'top_10_dead_heat_probability',
      'top_10_raw_probability',
      'top_5_dead_heat_probability',
      'top_5_raw_probability',
      'expected_final_score_display',
      'expected_final_score_number',
      'baseline_remaining',
      'total_par_adjustment',
      'total_sg_adjustment',
      'total_adjustment',
      'playoff_sg_rating',
      'score_input_total',
      'score_input_total_source',
      'score_input_round',
      'score_input_round_source',
      'score_input_completed_holes',
      'score_input_completed_holes_source',
      ...PLAYER_PROJECTION_STAT_KEYS.flatMap((statKey) => [
        `${statKey}_value`,
        `${statKey}_source`,
        `${statKey}_field_mean`,
      ]),
    ];

    const csvLines = [csvHeaders.map((header) => escapeCsvValue(header)).join(',')];
    sortedPlayers.forEach((player) => {
      const scoreInput = player?.playerScoreInputs || {};
      const rowData = {
        projection_scope: activeProjectionTab,
        projection_scope_label: activeProjectionScope?.label || '',
        tournament_name: payload?.tournamentName || '',
        display_date: payload?.displayDate || '',
        selected_stats: effectiveSelectedStats.join('|'),
        player_name: player?.playerName || '',
        normalized_player_name: player?.normalizedPlayerName || '',
        score_display: player?.scoreRaw || '',
        score_number: player?.scoreNumber,
        round_display: player?.roundScoreRaw || '',
        round_number: player?.roundScoreNumber,
        thru: player?.thruRaw || '',
        started_on_back_nine: Boolean(player?.startedOnBackNine),
        player_state: player?.playerState || '',
        current_hole: player?.currentHole || '',
        remaining_current_scope: player?.holesRemaining,
        remaining_current_round: player?.holesRemainingCurrentRound,
        remaining_future_rounds: player?.holesRemainingFutureRounds,
        rounds_remaining_after_current: player?.roundsRemainingAfterCurrent,
        remaining_holes: Array.isArray(player?.remainingHoles) ? player.remainingHoles.join('|') : '',
        remaining_par3_count: player?.remainingParCounts?.[3],
        remaining_par4_count: player?.remainingParCounts?.[4],
        remaining_par5_count: player?.remainingParCounts?.[5],
        win_tie_pct_display: formatWinTiePct(player, activeProjectionTab),
        win_probability: player?.winProbability,
        win_solo_probability: player?.winSoloProbability,
        tie_for_lead_probability: player?.tieForLeadProbability,
        win_tie_probability: player?.winTieProbability,
        fair_value_yes_cents: player?.fairValueYesCents,
        top_20_dead_heat_probability: player?.top20DeadHeatProbability,
        top_20_raw_probability: player?.top20Probability,
        top_10_dead_heat_probability: player?.top10DeadHeatProbability,
        top_10_raw_probability: player?.top10Probability,
        top_5_dead_heat_probability: player?.top5DeadHeatProbability,
        top_5_raw_probability: player?.top5Probability,
        expected_final_score_display: player?.expectedFinalScoreDisplay || '',
        expected_final_score_number: player?.expectedFinalScoreNumber,
        baseline_remaining: player?.projectionBreakdown?.baselineRemaining,
        total_par_adjustment: player?.projectionBreakdown?.totalParAdjustment,
        total_sg_adjustment: player?.projectionBreakdown?.totalSgAdjustment,
        total_adjustment: player?.projectionBreakdown?.totalAdjustment,
        playoff_sg_rating: player?.playoffSgRating,
        score_input_total: scoreInput?.totalScoreNumber?.value,
        score_input_total_source: scoreInput?.totalScoreNumber?.source || '',
        score_input_round: scoreInput?.roundScoreNumber?.value,
        score_input_round_source: scoreInput?.roundScoreNumber?.source || '',
        score_input_completed_holes: scoreInput?.completedHoles?.value,
        score_input_completed_holes_source: scoreInput?.completedHoles?.source || '',
      };

      PLAYER_PROJECTION_STAT_KEYS.forEach((statKey) => {
        const statInput = player?.playerStatInputs?.[statKey] || {};
        rowData[`${statKey}_value`] = statInput?.value;
        rowData[`${statKey}_source`] = statInput?.source || '';
        rowData[`${statKey}_field_mean`] = statInput?.fieldMean;
      });

      csvLines.push(csvHeaders.map((header) => escapeCsvValue(rowData[header])).join(','));
    });

    const csvContent = `${csvLines.join('\n')}\n`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const eventSlug = slugifyForFileName(payload?.tournamentName || selectedEventUrl || 'player-projections');
    const scopeKey = activeProjectionTab === 'tournament' ? 'tournament' : 'round';
    const dateStamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.href = objectUrl;
    link.download = `${eventSlug || 'player-projections'}-${scopeKey}-player-projections-${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
  };

  const toggleStatSelection = (statKey) => {
    setSelectedStats((previous) => {
      const next = new Set(previous);
      const isSelected = next.has(statKey);

      if (isSelected) {
        next.delete(statKey);
        if (!next.size) {
          return previous;
        }
        return Array.from(next);
      }

      if (statKey === SG_TOTAL_STAT) {
        SG_COMPONENT_STATS.forEach((componentKey) => next.delete(componentKey));
      }
      if (SG_COMPONENT_STATS.includes(statKey)) {
        next.delete(SG_TOTAL_STAT);
      }

      next.add(statKey);
      return Array.from(next);
    });
  };

  const closePlayerStatEditor = () => {
    setEditingPlayer(null);
    setEditDraftValues({});
    setEditScoreDraft({
      totalScoreNumber: '',
      roundScoreNumber: '',
      completedHoles: '',
    });
    setEditError('');
  };

  const openPlayerStatEditor = (player) => {
    if (!player) return;
    const normalizedPlayerName = player.normalizedPlayerName;
    const playerOverrideValues = playerStatOverrides[normalizedPlayerName] || {};
    const playerScoreOverrideValues = playerScoreOverrides[normalizedPlayerName] || {};
    const nextDraftValues = {};
    editableSelectedStats.forEach((statKey) => {
      const overrideValue = Number(playerOverrideValues?.[statKey]);
      if (Number.isFinite(overrideValue)) {
        nextDraftValues[statKey] = String(overrideValue);
        return;
      }

      const baseValue = Number(player?.playerStatInputs?.[statKey]?.value);
      nextDraftValues[statKey] = Number.isFinite(baseValue) ? String(baseValue) : '';
    });
    const scoreInput = player?.playerScoreInputs || {};
    const totalOverrideValue = Number(playerScoreOverrideValues?.totalScoreNumber);
    const roundOverrideValue = Number(playerScoreOverrideValues?.roundScoreNumber);
    const completedOverrideValue = Number(playerScoreOverrideValues?.completedHoles);
    const totalFromFeed = Number(scoreInput?.totalScoreNumber?.value);
    const roundFromFeed = Number(scoreInput?.roundScoreNumber?.value);
    const completedFromFeed = Number(scoreInput?.completedHoles?.value);

    const nextScoreDraft = {
      totalScoreNumber: Number.isFinite(totalOverrideValue)
        ? String(totalOverrideValue)
        : Number.isFinite(totalFromFeed)
          ? String(totalFromFeed)
          : '',
      roundScoreNumber: Number.isFinite(roundOverrideValue)
        ? String(roundOverrideValue)
        : Number.isFinite(roundFromFeed)
          ? String(roundFromFeed)
          : '',
      completedHoles: Number.isFinite(completedOverrideValue)
        ? String(completedOverrideValue)
        : Number.isFinite(completedFromFeed)
          ? String(completedFromFeed)
          : '',
    };
    setEditingPlayer(player);
    setEditDraftValues(nextDraftValues);
    setEditScoreDraft(nextScoreDraft);
    setEditError('');
  };

  const updateEditDraftValue = (statKey, value) => {
    setEditDraftValues((previous) => ({
      ...previous,
      [statKey]: value,
    }));
  };

  const updateEditScoreDraftValue = (fieldKey, value) => {
    setEditScoreDraft((previous) => ({
      ...previous,
      [fieldKey]: value,
    }));
  };

  const applyPlayerStatEdits = async () => {
    if (!editingPlayer) return;

    const nextPlayerStatMap = {};
    for (const statKey of editableSelectedStats) {
      const rawValue = String(editDraftValues?.[statKey] || '').trim();
      if (!rawValue) continue;
      const numericValue = Number(rawValue);
      if (!Number.isFinite(numericValue)) {
        setEditError(`Invalid number for ${formatStatKey(statKey)}.`);
        return;
      }
      nextPlayerStatMap[statKey] = numericValue;
    }

    const nextPlayerScoreMap = {};
    const rawTotalScore = String(editScoreDraft?.totalScoreNumber || '').trim();
    if (rawTotalScore) {
      const numericValue = Number(rawTotalScore);
      if (!Number.isFinite(numericValue)) {
        setEditError('Invalid number for Total Score.');
        return;
      }
      nextPlayerScoreMap.totalScoreNumber = numericValue;
    }
    const rawRoundScore = String(editScoreDraft?.roundScoreNumber || '').trim();
    if (rawRoundScore) {
      const numericValue = Number(rawRoundScore);
      if (!Number.isFinite(numericValue)) {
        setEditError('Invalid number for Round Score.');
        return;
      }
      nextPlayerScoreMap.roundScoreNumber = numericValue;
    }
    const rawCompletedHoles = String(editScoreDraft?.completedHoles || '').trim();
    if (rawCompletedHoles) {
      const numericValue = Number(rawCompletedHoles);
      if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > 18) {
        setEditError('Completed Holes must be a number between 0 and 18.');
        return;
      }
      nextPlayerScoreMap.completedHoles = Math.floor(numericValue);
    }

    const normalizedPlayerName = editingPlayer.normalizedPlayerName;
    const nextStatOverrides = {
      ...playerStatOverrides,
    };
    if (Object.keys(nextPlayerStatMap).length) {
      nextStatOverrides[normalizedPlayerName] = nextPlayerStatMap;
    } else {
      delete nextStatOverrides[normalizedPlayerName];
    }
    const nextScoreOverrides = {
      ...playerScoreOverrides,
    };
    if (Object.keys(nextPlayerScoreMap).length) {
      nextScoreOverrides[normalizedPlayerName] = nextPlayerScoreMap;
    } else {
      delete nextScoreOverrides[normalizedPlayerName];
    }

    setPlayerStatOverrides(nextStatOverrides);
    setPlayerScoreOverrides(nextScoreOverrides);
    closePlayerStatEditor();
    await loadProjection(baseUrl, {
      statOverrides: nextStatOverrides,
      scoreOverrides: nextScoreOverrides,
    });
  };

  const clearPlayerStatOverrides = async () => {
    if (!editingPlayer) return;
    const normalizedPlayerName = editingPlayer.normalizedPlayerName;
    const nextStatOverrides = {
      ...playerStatOverrides,
    };
    delete nextStatOverrides[normalizedPlayerName];
    const nextScoreOverrides = {
      ...playerScoreOverrides,
    };
    delete nextScoreOverrides[normalizedPlayerName];
    setPlayerStatOverrides(nextStatOverrides);
    setPlayerScoreOverrides(nextScoreOverrides);
    closePlayerStatEditor();
    await loadProjection(baseUrl, {
      statOverrides: nextStatOverrides,
      scoreOverrides: nextScoreOverrides,
    });
  };

  const hasAnySgComponentSelected = useMemo(
    () => SG_COMPONENT_STATS.some((statKey) => selectedStats.includes(statKey)),
    [selectedStats]
  );
  const isValidatingSgCsv = sgCsvValidation.status === 'validating';

  useEffect(() => {
    loadEvents();
  }, []);

  useEffect(() => {
    if (!projectionScopes) {
      if (activeProjectionTab !== 'round') {
        setActiveProjectionTab('round');
      }
      return;
    }

    if (projectionScopes[activeProjectionTab]) return;
    if (projectionScopes.round) {
      setActiveProjectionTab('round');
      return;
    }

    const firstScopeKey = Object.keys(projectionScopes)[0];
    if (firstScopeKey) {
      setActiveProjectionTab(firstScopeKey);
    }
  }, [projectionScopes, activeProjectionTab]);

  const saveSnapshot = () => {
    if (!payload || !projectedLeader) return;
    const activeScopeLabel = activeProjectionScope?.label || 'Round Leader';
    addHistoryItem({
      id: `${Date.now()}-round-leader-projection`,
      toolName: 'Golf Projection',
      summary: `${activeScopeLabel}: ${projectedLeader.playerName} | Projected ${projectedLeader.expectedFinalScoreDisplay}`,
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
        <h2>Golf Projection</h2>
        <p className="page-subtitle">
          Scrape live PGA TOUR data and switch between round-only and full-tournament projections.
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
                          className={`rlp-event-item ${selectedEventUrl === eventItem.tournamentUrl ? 'is-selected' : ''}`}
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

              <div className="rlp-stat-picker stack">
                <div className="row-between">
                  <strong>Projection Stats</strong>
                  <span className="muted">{selectedStats.length} selected</span>
                </div>
                {STAT_GROUPS.map((group) => (
                  <div key={group.id} className="rlp-stat-group">
                    <strong className="rlp-stat-group-title">{group.title}</strong>
                    <div className="rlp-stat-options">
                      {group.options.map((option) => {
                        const isChecked = selectedStats.includes(option.key);
                        const disableSgTotal = option.key === SG_TOTAL_STAT && hasAnySgComponentSelected;
                        const disableSgComponent =
                          SG_COMPONENT_STATS.includes(option.key) && selectedStats.includes(SG_TOTAL_STAT);
                        const isDisabled = disableSgTotal || disableSgComponent || loading;
                        return (
                          <label
                            key={option.key}
                            className={`rlp-stat-option ${isDisabled ? 'is-disabled' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleStatSelection(option.key)}
                              disabled={isDisabled}
                            />
                            <span>{option.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="stack">
                <label>
                  Strokes Gained CSV (optional)
                  <input
                    ref={sgCsvInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleSgCsvUpload}
                    disabled={loading || isValidatingSgCsv}
                  />
                </label>
                <p className="muted">
                  {uploadedSgCsv
                    ? `Using uploaded SG file: ${uploadedSgCsv.fileName}.`
                    : 'No uploaded SG CSV selected. Using latest backend SG CSV by default.'}
                </p>
                {sgCsvValidation.status !== 'idle' ? (
                  <p className={`rlp-upload-status is-${sgCsvValidation.status}`}>{sgCsvValidation.message}</p>
                ) : null}
                {uploadedSgCsv ? (
                  <div className="row">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={clearUploadedSgCsv}
                      disabled={loading || isValidatingSgCsv}
                    >
                      Clear Uploaded CSV
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="muted">Inputs are hidden. Use Show Inputs to edit the source URL.</p>
          )}
          <div className="row">
            <button
              type="button"
              className="primary-button"
              onClick={loadProjection}
              disabled={loading || isValidatingSgCsv || !baseUrl.trim() || !selectedStats.length}
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
                  <span>Current Round</span>
                  <strong>
                    {payload.roundDisplay || (Number.isFinite(Number(payload.currentRound)) ? `R${payload.currentRound}` : '-')}
                  </strong>
                </div>
                <div className="stat-card rlp-stat-card">
                  <span>Rounds Remaining</span>
                  <strong>{Number.isFinite(Number(payload.roundsRemainingAfterCurrent)) ? payload.roundsRemainingAfterCurrent : '-'}</strong>
                </div>
                <div className="stat-card rlp-stat-card">
                  <span>Projected Leader</span>
                  <strong>{projectedLeader?.playerName || '-'}</strong>
                </div>
                <div className="stat-card rlp-stat-card">
                  <span>Projected Leader Score</span>
                  <strong>{projectedLeader?.expectedFinalScoreDisplay || '-'}</strong>
                </div>
                <div className="stat-card rlp-stat-card">
                  <span>Projection Mode</span>
                  <strong>{activeProjectionScope?.label || 'Round Leader'}</strong>
                </div>
              </div>
            </section>

            <div className="stack" ref={playerProjectionsRef}>
              <h3>Player Projections</h3>
              <div className="rlp-projection-tabs" role="tablist" aria-label="Projection modes">
                {PROJECTION_TABS.map((tab) => {
                  const isActive = activeProjectionTab === tab.key;
                  const isDisabled = !projectionScopes?.[tab.key];
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      className={`rlp-projection-tab ${isActive ? 'is-active' : ''}`}
                      onClick={() => setActiveProjectionTab(tab.key)}
                      disabled={isDisabled}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
              {activeProjectionScope?.description ? (
                <p className="muted">{activeProjectionScope.description}</p>
              ) : null}
              <div className="rlp-badge-row">
                {effectiveSelectedStats.map((statKey) => (
                  <span key={statKey} className="rlp-badge">
                    {formatStatKey(statKey)}
                  </span>
                ))}
                {manualOverrideCount ? <span className="rlp-badge">Manual Overrides: {manualOverrideCount}</span> : null}
                {payload.statDataSource ? (
                  <span className="rlp-badge">Stat Data: {payload.statDataSource}</span>
                ) : null}
                {payload.displayDate ? <span className="rlp-badge">Dates: {payload.displayDate}</span> : null}
                <button
                  type="button"
                  className="ghost-button rlp-inline-export-button"
                  onClick={exportPlayerProjectionsCsv}
                  disabled={loading || !sortedPlayers.length}
                  title="Export player projections as CSV"
                  aria-label="Export player projections as CSV"
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  className="ghost-button rlp-inline-refresh-button"
                  onClick={() => loadProjection()}
                  disabled={loading || !baseUrl.trim() || !selectedStats.length}
                  title="Refresh projections"
                  aria-label="Refresh projections"
                >
                  ↻
                </button>
              </div>
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
                          {remainingColumnLabel}{' '}
                          <span className="table-sort-indicator">{getPlayerSortIndicator('holesRemaining')}</span>
                        </button>
                      </th>
                      <th>
                        <button type="button" className="table-sort-button" onClick={() => requestPlayerSort('winTieProbability')}>
                          Win/Tie Pct{' '}
                          <span className="table-sort-indicator">{getPlayerSortIndicator('winTieProbability')}</span>
                        </button>
                      </th>
                      {isTournamentProjection ? (
                        <th>
                          <button
                            type="button"
                            className="table-sort-button"
                            onClick={() => requestPlayerSort('top20DeadHeatProbability')}
                            title="Dead-heat adjusted Top 20 fair value"
                          >
                            Top 20 <span className="table-sort-indicator">{getPlayerSortIndicator('top20DeadHeatProbability')}</span>
                          </button>
                        </th>
                      ) : null}
                      {isTournamentProjection ? (
                        <th>
                          <button
                            type="button"
                            className="table-sort-button"
                            onClick={() => requestPlayerSort('top10DeadHeatProbability')}
                            title="Dead-heat adjusted Top 10 fair value (tie-at-cutline payout split)"
                          >
                            Top 10 <span className="table-sort-indicator">{getPlayerSortIndicator('top10DeadHeatProbability')}</span>
                          </button>
                        </th>
                      ) : null}
                      {isTournamentProjection ? (
                        <th>
                          <button
                            type="button"
                            className="table-sort-button"
                            onClick={() => requestPlayerSort('top5DeadHeatProbability')}
                            title="Dead-heat adjusted Top 5 fair value"
                          >
                            Top 5 <span className="table-sort-indicator">{getPlayerSortIndicator('top5DeadHeatProbability')}</span>
                          </button>
                        </th>
                      ) : null}
                      <th>
                        <button
                          type="button"
                          className="table-sort-button"
                          onClick={() => requestPlayerSort('fairValueYesCents')}
                          title="Win fair value"
                        >
                          Win <span className="table-sort-indicator">{getPlayerSortIndicator('fairValueYesCents')}</span>
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
                    {sortedPlayers.map((player) => {
                      const projectionTooltip = buildProjectionTooltip(player);
                      const movement = projectionRowMovement[player.playerName];
                      const movementClass =
                        movement === 'up'
                          ? 'rlp-row-moved-up'
                          : movement === 'down'
                            ? 'rlp-row-moved-down'
                            : '';
                      return (
                        <tr key={player.playerName} className={movementClass}>
                          <td>
                            <span className="rlp-player-name-cell">
                              {player.playerName}
                              {player.missingSgData ? (
                                <span
                                  className="rlp-missing-sg-icon"
                                  title="Missing in SG CSV file. Projection uses field-average SG fallback."
                                  aria-label={`${player.playerName} missing in SG CSV file`}
                                >
                                  !
                                </span>
                              ) : null}
                              <button
                                type="button"
                                className="rlp-edit-player-button"
                                onClick={() => openPlayerStatEditor(player)}
                                aria-label={`Edit ${player.playerName} projection stats`}
                                title={`Edit ${player.playerName} projection stats`}
                                disabled={loading}
                              >
                                ✎
                              </button>
                            </span>
                          </td>
                          <td>{player.currentScoreDisplay || player.scoreRaw}</td>
                          <td>{player.roundScoreRaw || '-'}</td>
                          <td>{player.thruRaw}</td>
                          <td>{player.startedOnBackNine ? 'Back' : 'Front'}</td>
                          <td>{player.currentHole}</td>
                          <td>{player.holesRemaining}</td>
                          <td>{formatWinTiePct(player, activeProjectionTab)}</td>
                          {isTournamentProjection ? (
                            <td title={buildTopFinishTooltip(player, 20)}>
                              {formatFairValueFromProbability(player?.top20DeadHeatProbability)}
                            </td>
                          ) : null}
                          {isTournamentProjection ? (
                            <td title={buildTopFinishTooltip(player, 10)}>
                              {formatFairValueFromProbability(player?.top10DeadHeatProbability)}
                            </td>
                          ) : null}
                          {isTournamentProjection ? (
                            <td title={buildTopFinishTooltip(player, 5)}>
                              {formatFairValueFromProbability(player?.top5DeadHeatProbability)}
                            </td>
                          ) : null}
                          <td>{formatFairValueCents(player.fairValueYesCents)}</td>
                          <td>
                            <span className="rlp-projected-cell">
                              {formatSignedValue(player.expectedFinalScoreNumber)}
                              {projectionTooltip ? (
                                <span
                                  className="rlp-projection-tooltip-icon"
                                  title={projectionTooltip}
                                  aria-label={`Projection stat adjustments for ${player.playerName}`}
                                >
                                  i
                                </span>
                              ) : null}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
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
      {editingPlayer ? (
        <div className="rlp-modal-backdrop" role="presentation" onClick={closePlayerStatEditor}>
          <div
            className="panel stack rlp-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Edit projection stats for ${editingPlayer.playerName}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="row-between">
              <h3>Edit Projection Stats</h3>
              <button type="button" className="ghost-button" onClick={closePlayerStatEditor} disabled={loading}>
                Close
              </button>
            </div>
            <p className="muted">
              {editingPlayer.playerName} | Modify current-round score inputs and selected stat values, then re-run.
            </p>
            <div className="rlp-edit-score-grid">
              <label className="rlp-edit-stat-row">
                <span className="rlp-edit-stat-label">Total Score</span>
                <input
                  className="incremental-number-input"
                  type="number"
                  step="1"
                  value={editScoreDraft.totalScoreNumber}
                  onChange={(event) => updateEditScoreDraftValue('totalScoreNumber', event.target.value)}
                  disabled={loading}
                />
                <span className="muted rlp-edit-stat-meta">
                  {formatStatInputSource(editingPlayer?.playerScoreInputs?.totalScoreNumber?.source)}
                </span>
              </label>
              <label className="rlp-edit-stat-row">
                <span className="rlp-edit-stat-label">Round Score</span>
                <input
                  className="incremental-number-input"
                  type="number"
                  step="1"
                  value={editScoreDraft.roundScoreNumber}
                  onChange={(event) => updateEditScoreDraftValue('roundScoreNumber', event.target.value)}
                  disabled={loading}
                />
                <span className="muted rlp-edit-stat-meta">
                  {formatStatInputSource(editingPlayer?.playerScoreInputs?.roundScoreNumber?.source)}
                </span>
              </label>
              <label className="rlp-edit-stat-row">
                <span className="rlp-edit-stat-label">Completed Holes</span>
                <input
                  className="incremental-number-input"
                  type="number"
                  step="1"
                  min="0"
                  max="18"
                  value={editScoreDraft.completedHoles}
                  onChange={(event) => updateEditScoreDraftValue('completedHoles', event.target.value)}
                  disabled={loading}
                />
                <span className="muted rlp-edit-stat-meta">
                  {formatStatInputSource(editingPlayer?.playerScoreInputs?.completedHoles?.source)}
                </span>
              </label>
            </div>
            {!editableSelectedStats.length ? (
              <p className="muted">No editable Par/SG stats are selected for this run.</p>
            ) : (
              <div className="rlp-edit-stat-grid">
                {editableSelectedStats.map((statKey) => {
                  const statInput = editingPlayer?.playerStatInputs?.[statKey] || null;
                  const fieldMeanValue = Number(statInput?.fieldMean);
                  return (
                    <label key={statKey} className="rlp-edit-stat-row">
                      <span className="rlp-edit-stat-label">{formatStatKey(statKey)}</span>
                      <input
                        className="incremental-number-input"
                        type="number"
                        step="0.0001"
                        value={editDraftValues?.[statKey] ?? ''}
                        onChange={(event) => updateEditDraftValue(statKey, event.target.value)}
                        disabled={loading}
                      />
                      <span className="muted rlp-edit-stat-meta">
                        {formatStatInputSource(statInput?.source)}
                        {Number.isFinite(fieldMeanValue) ? ` | Field ${fieldMeanValue.toFixed(3)}` : ''}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            {editError ? <p className="muted">{editError}</p> : null}
            <div className="row">
              <button type="button" className="ghost-button" onClick={closePlayerStatEditor} disabled={loading}>
                Cancel
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={clearPlayerStatOverrides}
                disabled={loading}
              >
                Clear Overrides
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={applyPlayerStatEdits}
                disabled={loading}
              >
                {loading ? 'Re-running...' : 'Apply and Re-run'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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

function formatStatKey(statKey) {
  const map = {
    course_hole_model: 'Course (Hole)',
    par3_scoring_avg: 'Par 3 Avg',
    par4_scoring_avg: 'Par 4 Avg',
    par5_scoring_avg: 'Par 5 Avg',
    sg_total: 'SG: Total',
    sg_t2g: 'SG: Tee-to-Green',
    sg_ott: 'SG: Off-the-Tee',
    sg_app: 'SG: Approach',
    sg_arg: 'SG: Around-the-Green',
    sg_putt: 'SG: Putting',
  };
  return map[statKey] || statKey;
}

function getBreakdownValueByStatKey(projectionBreakdown, statKey) {
  if (statKey === 'course_hole_model') {
    return Number(projectionBreakdown?.baselineRemaining);
  }
  const parValue = Number(projectionBreakdown?.parAdjustments?.[statKey]);
  if (Number.isFinite(parValue)) return parValue;
  const sgValue = Number(projectionBreakdown?.sgAdjustments?.[statKey]);
  return Number.isFinite(sgValue) ? sgValue : null;
}

function buildProjectionTooltip(player) {
  const projectionBreakdown = player?.projectionBreakdown;
  if (!projectionBreakdown) return '';

  const selectedStats = Array.isArray(projectionBreakdown.selectedStats) ? projectionBreakdown.selectedStats : [];
  const summaryLines = selectedStats
    .map((statKey) => {
      const value = getBreakdownValueByStatKey(projectionBreakdown, statKey);
      if (!Number.isFinite(value)) return null;
      const label = statKey === 'course_hole_model' ? 'Base' : formatStatKey(statKey);
      return `${label}: ${formatSignedValue(value, 4)}`;
    })
    .filter(Boolean);

  const holeLines = Array.isArray(projectionBreakdown.holeBreakdown)
    ? projectionBreakdown.holeBreakdown.map((hole) => {
        const roundPrefix = Number.isFinite(Number(hole.roundNumber)) ? `R${hole.roundNumber}-` : '';
        const holeLabel = `${roundPrefix}H${hole.holeNumber}${Number.isFinite(Number(hole.par)) ? ` (P${hole.par})` : ''}`;
        const basePart = `Base ${formatSignedValue(Number(hole.base), 4)}`;
        const parPart = `ParAdj ${formatSignedValue(Number(hole.parAdjustment), 4)}`;
        const sgValue = Number(hole.sgAdjustment);
        const sgPart = Number.isFinite(sgValue) && Math.abs(sgValue) > 0.00005
          ? ` | SGAdj ${formatSignedValue(sgValue, 4)}`
          : '';
        const totalPart = `Total ${formatSignedValue(Number(hole.total), 4)}`;
        return `${holeLabel}: ${basePart} | ${parPart}${sgPart} | ${totalPart}`;
      })
    : [];

  return [...summaryLines, ...(holeLines.length ? ['', 'Per-hole:'] : []), ...holeLines].join('\n');
}
