import { useEffect, useMemo, useRef, useState } from 'react';
import { useBetLab } from '../state/BetLabContext';
import { useSortableTable } from '../hooks/useSortableTable';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

const DEFAULT_BASE_URL = 'https://www.pgatour.com/tournaments/2026/valspar-championship/R2026475/';
const DEFAULT_SELECTED_STATS = ['course_hole_model', 'par3_scoring_avg', 'par4_scoring_avg', 'par5_scoring_avg'];
const PROJECTION_MODEL_STANDARD = 'standard';
const PROJECTION_MODEL_BLENDED = 'blended';
const GROUP_WINNER_TAB_KEY = 'group';
const GROUP_WINNER_MIN_PLAYERS = 2;
const GROUP_WINNER_MAX_PLAYERS = 4;
const GROUP_WINNER_SIMULATION_TRIALS = 8000;
const SG_TOTAL_STAT = 'sg_total';
const SG_COMPONENT_STATS = ['sg_t2g', 'sg_ott', 'sg_app', 'sg_arg', 'sg_putt'];
const SG_T2G_STAT = 'sg_t2g';
const SG_T2G_COMPONENT_STATS = ['sg_ott', 'sg_app', 'sg_arg'];
const RECENT_FORM_STAT = 'recent_form_l20';
const DEFAULT_RECENT_FORM_WEIGHT = 0.3;
const DEFAULT_WEATHER_OVERRIDES = {
  enabled: false,
  amWaveAdjustmentPerRound: 0,
  pmWaveAdjustmentPerRound: 0,
  windVolatilityMultiplier: 1,
};
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
  {
    id: 'recent-form',
    title: 'Recent Form',
    options: [
      { key: RECENT_FORM_STAT, label: 'Recent Form L20' },
    ],
  },
];
const PROJECTION_TABS = [
  { key: 'round', label: 'Round Leader' },
  { key: 'tournament', label: 'Tournament' },
  { key: GROUP_WINNER_TAB_KEY, label: 'Group Winner' },
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
  RECENT_FORM_STAT,
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
  if (projectionScopeKey === GROUP_WINNER_TAB_KEY) {
    return formatWinPct(player?.groupWinProbability);
  }
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

function getMissingProjectionStatKeys(player) {
  if (Array.isArray(player?.missingProjectionStatKeys) && player.missingProjectionStatKeys.length) {
    return player.missingProjectionStatKeys;
  }
  if (Array.isArray(player?.missingProjectionStats) && player.missingProjectionStats.length) {
    return player.missingProjectionStats.map((stat) => stat?.statKey).filter(Boolean);
  }
  return player?.missingSgData ? ['SG stats'] : [];
}

function buildMissingProjectionStatsTooltip(player) {
  const missingStatLabels = getMissingProjectionStatKeys(player).map(formatStatKey);
  if (!missingStatLabels.length) return '';
  return `Missing projection stat data: ${missingStatLabels.join(', ')}. Projection uses field-average fallback values.`;
}

function valuesDifferFromBaseline(value, baselineValue) {
  const numericValue = Number(value);
  const numericBaseline = Number(baselineValue);
  if (!Number.isFinite(numericValue)) return false;
  if (!Number.isFinite(numericBaseline)) return true;
  return Math.abs(numericValue - numericBaseline) > 0.00005;
}

function formatScoreInputKey(inputKey) {
  const map = {
    totalScoreNumber: 'Total Score',
    roundScoreNumber: 'Round Score',
    completedHoles: 'Completed Holes',
  };
  return map[inputKey] || inputKey;
}

function buildManualOverrideTooltip(player) {
  const statLabels = Object.entries(player?.playerStatInputs || {})
    .filter(([, input]) => input?.source === 'manual_override' && valuesDifferFromBaseline(input?.value, input?.baselineValue))
    .map(([statKey]) => formatStatKey(statKey));
  const scoreLabels = Object.entries(player?.playerScoreInputs || {})
    .filter(([, input]) => input?.source === 'manual_override' && valuesDifferFromBaseline(input?.value, input?.baselineValue))
    .map(([inputKey]) => formatScoreInputKey(inputKey));
  const labels = [...statLabels, ...scoreLabels];
  if (!labels.length) return '';
  return `Manual overrides applied: ${labels.join(', ')}.`;
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function hashStringToUint32(value) {
  const stringValue = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < stringValue.length; index += 1) {
    hash ^= stringValue.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
}

function createSeededRandom(seedInput) {
  let state = hashStringToUint32(seedInput);
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createStandardNormalSampler(randomFn) {
  let cachedValue = null;
  return () => {
    if (cachedValue !== null) {
      const output = cachedValue;
      cachedValue = null;
      return output;
    }

    let u1 = randomFn();
    let u2 = randomFn();
    if (u1 <= Number.EPSILON) u1 = Number.EPSILON;
    if (u2 <= Number.EPSILON) u2 = Number.EPSILON;

    const magnitude = Math.sqrt(-2 * Math.log(u1));
    const angle = 2 * Math.PI * u2;
    cachedValue = magnitude * Math.sin(angle);
    return magnitude * Math.cos(angle);
  };
}

function toOutcomeScoreBucket(score) {
  if (!Number.isFinite(score)) return null;
  return roundTo(score, 0);
}

function accumulateGroupPlacementShares(scoresByIndex, placeSharesByIndex, groupWinTieCounts = null) {
  const scoreGroups = new Map();
  scoresByIndex.forEach((scoreRaw, index) => {
    const score = Number(scoreRaw);
    if (!Number.isFinite(score)) return;
    if (!scoreGroups.has(score)) {
      scoreGroups.set(score, []);
    }
    scoreGroups.get(score).push(index);
  });

  const orderedGroups = Array.from(scoreGroups.entries()).sort((left, right) => left[0] - right[0]);
  const firstPlaceGroup = orderedGroups[0]?.[1] || [];
  if (Array.isArray(groupWinTieCounts)) {
    firstPlaceGroup.forEach((playerIndex) => {
      groupWinTieCounts[playerIndex] += 1;
    });
  }
  let occupiedPlaces = 0;
  orderedGroups.forEach(([, groupIndexes]) => {
    const groupSize = groupIndexes.length;
    if (!groupSize) return;
    const groupStartPlace = occupiedPlaces + 1;
    const groupEndPlace = occupiedPlaces + groupSize;
    const placeShare = 1 / groupSize;
    groupIndexes.forEach((playerIndex) => {
      for (let place = groupStartPlace; place <= groupEndPlace; place += 1) {
        placeSharesByIndex[playerIndex][place - 1] += placeShare;
      }
    });
    occupiedPlaces += groupSize;
  });
}

function buildGroupWinnerProjectionRows(players, options = {}) {
  const selectedPlayers = Array.isArray(players) ? players : [];
  const groupSize = selectedPlayers.length;
  const hasEnoughPlayers = groupSize >= GROUP_WINNER_MIN_PLAYERS && groupSize <= GROUP_WINNER_MAX_PLAYERS;
  if (!hasEnoughPlayers) {
    return {
      players: selectedPlayers.map((player) => ({
        ...player,
        groupSize,
        groupWinProbability: null,
        groupWinTieProbability: null,
        groupFairValueCents: null,
        groupPlaceProbabilities: {},
      })),
      modelMeta: {
        method: 'monte-carlo-normal',
        trials: 0,
        deterministic: true,
        groupSize,
      },
    };
  }

  const expectedScores = selectedPlayers.map((player) => Number(player?.expectedFinalScoreNumber));
  const scoreStdDevs = selectedPlayers.map((player) => {
    const fromPayload = Number(player?.scoreStdDev);
    if (Number.isFinite(fromPayload) && fromPayload >= 0) return fromPayload;
    const remainingHoles = Array.isArray(player?.remainingHoles) ? player.remainingHoles.length : 0;
    return remainingHoles > 0 ? Math.sqrt(remainingHoles) * 0.84 : 0;
  });
  const hasValidScores = expectedScores.every((score) => Number.isFinite(score));
  const canRunSimulation = hasValidScores && scoreStdDevs.some((value) => Number.isFinite(value) && value > 0);
  const denominator = canRunSimulation ? GROUP_WINNER_SIMULATION_TRIALS : 1;
  const placeSharesByIndex = selectedPlayers.map(() => new Array(groupSize).fill(0));
  const groupWinTieCounts = new Array(groupSize).fill(0);

  if (!hasValidScores) {
    return {
      players: selectedPlayers.map((player) => ({
        ...player,
        groupSize,
        groupWinProbability: null,
        groupWinTieProbability: null,
        groupFairValueCents: null,
        groupPlaceProbabilities: {},
      })),
      modelMeta: {
        method: 'monte-carlo-normal',
        trials: 0,
        deterministic: true,
        groupSize,
      },
    };
  }

  if (!canRunSimulation) {
    accumulateGroupPlacementShares(expectedScores.map(toOutcomeScoreBucket), placeSharesByIndex, groupWinTieCounts);
  } else {
    const randomFn = createSeededRandom(options.seedInput || selectedPlayers.map((player) => player?.normalizedPlayerName).join('|'));
    const sampleNormal = createStandardNormalSampler(randomFn);
    for (let trial = 0; trial < GROUP_WINNER_SIMULATION_TRIALS; trial += 1) {
      const sampledScores = expectedScores.map((expectedScore, index) => {
        const scoreStdDev = scoreStdDevs[index] || 0;
        const sampledScore = scoreStdDev > 0 ? expectedScore + sampleNormal() * scoreStdDev : expectedScore;
        return toOutcomeScoreBucket(sampledScore);
      });
      accumulateGroupPlacementShares(sampledScores, placeSharesByIndex, groupWinTieCounts);
    }
  }

  return {
    players: selectedPlayers
      .map((player, index) => {
        const groupPlaceProbabilities = {};
        placeSharesByIndex[index].forEach((share, placeIndex) => {
          groupPlaceProbabilities[placeIndex + 1] = roundTo(share / denominator, 6);
        });
        const groupWinProbability = groupPlaceProbabilities[1];
        const groupWinTieProbability = groupWinTieCounts[index] / denominator;
        return {
          ...player,
          groupSize,
          groupWinProbability: Number.isFinite(groupWinProbability) ? groupWinProbability : null,
          groupWinTieProbability: Number.isFinite(groupWinTieProbability) ? roundTo(groupWinTieProbability, 6) : null,
          groupFairValueCents: Number.isFinite(groupWinProbability) ? roundTo(groupWinProbability * 100, 2) : null,
          groupPlaceProbabilities,
          groupPlace1Probability: groupPlaceProbabilities[1] ?? null,
          groupPlace2Probability: groupPlaceProbabilities[2] ?? null,
          groupPlace3Probability: groupPlaceProbabilities[3] ?? null,
          groupPlace4Probability: groupPlaceProbabilities[4] ?? null,
        };
      })
      .sort((left, right) => {
        const leftWin = Number(left?.groupWinProbability);
        const rightWin = Number(right?.groupWinProbability);
        if (Number.isFinite(leftWin) && Number.isFinite(rightWin) && leftWin !== rightWin) {
          return rightWin - leftWin;
        }
        return Number(left?.expectedFinalScoreNumber) - Number(right?.expectedFinalScoreNumber);
      }),
    modelMeta: {
      method: 'monte-carlo-normal',
      tieHandling: 'dead-heat-place-split',
      trials: canRunSimulation ? GROUP_WINNER_SIMULATION_TRIALS : 0,
      deterministic: !canRunSimulation,
      groupSize,
    },
  };
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

function normalizeCompletedHolesForThruSort(player) {
  const completedFromInput = Number(player?.playerScoreInputs?.completedHoles?.value);
  if (Number.isFinite(completedFromInput)) {
    return Math.max(0, Math.min(18, Math.floor(completedFromInput)));
  }
  const thruRaw = String(player?.thruRaw || '')
    .replace('*', '')
    .trim()
    .toUpperCase();
  if (!thruRaw) return null;
  if (thruRaw === 'F') return 18;
  const parsed = Number(thruRaw);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(18, Math.floor(parsed)));
}

function comparePlayersByThruColumn(leftPlayer, rightPlayer, compareValues) {
  const leftAwaiting = Boolean(leftPlayer?.isAwaitingCurrentRoundStart);
  const rightAwaiting = Boolean(rightPlayer?.isAwaitingCurrentRoundStart);
  if (leftAwaiting && rightAwaiting) {
    const leftTeeTime = Number.isFinite(Number(leftPlayer?.teeTimeMs)) ? Number(leftPlayer?.teeTimeMs) : null;
    const rightTeeTime = Number.isFinite(Number(rightPlayer?.teeTimeMs)) ? Number(rightPlayer?.teeTimeMs) : null;
    const teeResult = compareValues(leftTeeTime, rightTeeTime);
    if (teeResult !== 0) return teeResult;
    return compareValues(leftPlayer?.playerName, rightPlayer?.playerName);
  }
  if (leftAwaiting !== rightAwaiting) {
    return leftAwaiting ? 1 : -1;
  }

  const leftCompleted = normalizeCompletedHolesForThruSort(leftPlayer);
  const rightCompleted = normalizeCompletedHolesForThruSort(rightPlayer);
  const completedResult = compareValues(leftCompleted, rightCompleted);
  if (completedResult !== 0) return completedResult;
  return compareValues(leftPlayer?.playerName, rightPlayer?.playerName);
}

function formatWeatherSummary(weatherOverrides) {
  if (!weatherOverrides?.enabled) return 'Weather: Off';
  const amValue = Number(weatherOverrides?.amWaveAdjustmentPerRound);
  const pmValue = Number(weatherOverrides?.pmWaveAdjustmentPerRound);
  const volatilityValue = Number(weatherOverrides?.windVolatilityMultiplier);
  const amDisplay = Number.isFinite(amValue) ? formatSignedValue(amValue, 2) : 'E';
  const pmDisplay = Number.isFinite(pmValue) ? formatSignedValue(pmValue, 2) : 'E';
  const volatilityDisplay = Number.isFinite(volatilityValue) ? volatilityValue.toFixed(2) : '1.00';
  return `Weather (Round): AM ${amDisplay} | PM ${pmDisplay} | Vol x${volatilityDisplay}`;
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
  const [useBlendedModel, setUseBlendedModel] = useState(false);
  const [uploadedSgCsv, setUploadedSgCsv] = useState(null);
  const [sgCsvValidation, setSgCsvValidation] = useState({
    status: 'idle',
    message: '',
  });
  const [uploadedRecentFormCsv, setUploadedRecentFormCsv] = useState(null);
  const [recentFormCsvValidation, setRecentFormCsvValidation] = useState({
    status: 'idle',
    message: '',
  });
  const [recentFormWeight, setRecentFormWeight] = useState(DEFAULT_RECENT_FORM_WEIGHT);
  const [playerStatOverrides, setPlayerStatOverrides] = useState({});
  const [playerScoreOverrides, setPlayerScoreOverrides] = useState({});
  const [weatherOverrides, setWeatherOverrides] = useState(DEFAULT_WEATHER_OVERRIDES);
  const [payload, setPayload] = useState(null);
  const [activeProjectionTab, setActiveProjectionTab] = useState('round');
  const [selectedGroupPlayerNames, setSelectedGroupPlayerNames] = useState([]);
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
  const recentFormCsvInputRef = useRef(null);
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
  const tournamentProjectionPlayers = useMemo(
    () => projectionScopes?.tournament?.players || payload?.tournamentPlayers || [],
    [projectionScopes, payload]
  );
  const selectedGroupPlayers = useMemo(() => {
    if (!selectedGroupPlayerNames.length || !tournamentProjectionPlayers.length) return [];
    const playersByName = new Map(
      tournamentProjectionPlayers
        .filter((player) => player?.normalizedPlayerName)
        .map((player) => [player.normalizedPlayerName, player])
    );
    return selectedGroupPlayerNames.map((playerName) => playersByName.get(playerName)).filter(Boolean);
  }, [selectedGroupPlayerNames, tournamentProjectionPlayers]);
  const groupProjectionResult = useMemo(
    () =>
      buildGroupWinnerProjectionRows(selectedGroupPlayers, {
        seedInput: [
          payload?.tournamentId,
          payload?.currentRound,
          payload?.totalRounds,
          payload?.projectionModel,
          selectedGroupPlayerNames.join('|'),
          selectedGroupPlayers.map((player) => player?.expectedFinalScoreNumber).join('|'),
        ].join('::'),
      }),
    [payload, selectedGroupPlayerNames, selectedGroupPlayers]
  );
  const activeProjectionScope = useMemo(() => {
    if (activeProjectionTab === GROUP_WINNER_TAB_KEY) {
      return {
        key: GROUP_WINNER_TAB_KEY,
        label: 'Group Winner',
        description: 'Select 2-4 tournament players to project head-to-head, 3-ball, or 4-ball group outcomes.',
        players: groupProjectionResult.players,
        winProbabilityModel: groupProjectionResult.modelMeta,
      };
    }
    if (!projectionScopes) return null;
    return projectionScopes[activeProjectionTab] || projectionScopes.round || null;
  }, [projectionScopes, activeProjectionTab, groupProjectionResult]);
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
    () => (activeProjectionTab === 'tournament' || activeProjectionTab === GROUP_WINNER_TAB_KEY ? 'Rem. (Tourn)' : 'Rem. (Round)'),
    [activeProjectionTab]
  );
  const isTournamentProjection = activeProjectionTab === 'tournament';
  const isGroupProjection = activeProjectionTab === GROUP_WINNER_TAB_KEY;
  const showTop10Column = !isGroupProjection;
  const showTop5Column = !isGroupProjection;
  const selectedGroupSize = selectedGroupPlayers.length;
  const hasValidGroupSelection =
    selectedGroupSize >= GROUP_WINNER_MIN_PLAYERS && selectedGroupSize <= GROUP_WINNER_MAX_PLAYERS;
  const activeWeatherOverrides = useMemo(
    () => (payload?.weatherOverrides && typeof payload.weatherOverrides === 'object' ? payload.weatherOverrides : weatherOverrides),
    [payload, weatherOverrides]
  );
  const activeProjectionModel = payload?.projectionModel || (useBlendedModel ? PROJECTION_MODEL_BLENDED : PROJECTION_MODEL_STANDARD);
  const activeProjectionModelLabel = activeProjectionModel === PROJECTION_MODEL_BLENDED ? 'Blended Model' : 'Standard Model';
  const weatherSummary = useMemo(() => formatWeatherSummary(activeWeatherOverrides), [activeWeatherOverrides]);
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
  } = useSortableTable(
    playerRows,
    {
      key: 'expectedFinalScoreNumber',
      direction: 'asc',
    },
    {
      customComparators: {
        thruSortValue: comparePlayersByThruColumn,
      },
    }
  );

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
    const weatherOverridesForRequest =
      options.weatherOverrides && typeof options.weatherOverrides === 'object' ? options.weatherOverrides : weatherOverrides;
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
          projectionModel: useBlendedModel ? PROJECTION_MODEL_BLENDED : PROJECTION_MODEL_STANDARD,
          statOverrides: statOverridesForRequest,
          scoreOverrides: scoreOverridesForRequest,
          weatherOverrides: weatherOverridesForRequest,
          uploadedSgCsv: hasAnySgStatSelected ? uploadedSgCsv : null,
          uploadedRecentFormCsv: hasRecentFormSelected ? uploadedRecentFormCsv : null,
          recentFormWeight,
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
        message: `OK: SG CSV structure is valid${
          json?.data?.schemaLabel ? ` (${json.data.schemaLabel})` : ''
        } (${json?.data?.playerRowCount || 0} player rows).`,
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

  const handleRecentFormCsvUpload = async (event) => {
    const file = event.target?.files?.[0];
    if (!file) {
      setUploadedRecentFormCsv(null);
      setRecentFormCsvValidation({
        status: 'idle',
        message: '',
      });
      return;
    }

    setRecentFormCsvValidation({
      status: 'validating',
      message: `Validating ${file.name}...`,
    });

    try {
      const content = await file.text();
      if (!content.trim()) {
        throw new Error('Selected Recent Form CSV is empty.');
      }
      const nextUploadedRecentFormCsv = {
        fileName: file.name,
        content,
      };
      const response = await fetch(`${API_BASE_URL}/api/tools/round-leader-projection/validate-recent-form-csv`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          uploadedRecentFormCsv: nextUploadedRecentFormCsv,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Uploaded Recent Form CSV failed validation.');
      }

      setUploadedRecentFormCsv(nextUploadedRecentFormCsv);
      setRecentFormCsvValidation({
        status: 'valid',
        message: `OK: Recent Form CSV structure is valid${
          json?.data?.schemaLabel ? ` (${json.data.schemaLabel})` : ''
        } (${json?.data?.playerRowCount || 0} player rows).`,
      });
    } catch (uploadError) {
      setUploadedRecentFormCsv(null);
      setRecentFormCsvValidation({
        status: 'invalid',
        message: uploadError.message || 'Could not validate the selected Recent Form CSV file.',
      });
      if (recentFormCsvInputRef.current) {
        recentFormCsvInputRef.current.value = '';
      }
    }
  };

  const clearUploadedRecentFormCsv = () => {
    setUploadedRecentFormCsv(null);
    setRecentFormCsvValidation({
      status: 'idle',
      message: '',
    });
    if (recentFormCsvInputRef.current) {
      recentFormCsvInputRef.current.value = '';
    }
  };

  const setWeatherEnabled = (enabled) => {
    setWeatherOverrides((previous) => ({
      ...previous,
      enabled: Boolean(enabled),
    }));
  };

  const updateWeatherOverrideNumber = (fieldKey, rawValue) => {
    const numericValue = Number(rawValue);
    setWeatherOverrides((previous) => ({
      ...previous,
      [fieldKey]: Number.isFinite(numericValue) ? numericValue : previous[fieldKey],
    }));
  };

  const updateRecentFormWeight = (rawValue) => {
    const numericValue = Number(rawValue);
    if (!Number.isFinite(numericValue)) return;
    setRecentFormWeight(Math.min(1, Math.max(0, numericValue)));
  };

  const exportPlayerProjectionsCsv = () => {
    if (!sortedPlayers.length) return;

    const csvHeaders = [
      'projection_scope',
      'projection_scope_label',
      'tournament_name',
      'display_date',
      'selected_stats',
      'projection_model',
      'projection_model_label',
      'recent_form_weight',
      'weather_enabled',
      'weather_am_wave_adjustment_per_round',
      'weather_pm_wave_adjustment_per_round',
      'weather_wind_volatility_multiplier',
      'missing_projection_stats',
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
      'group_size',
      'group_win_probability',
      'group_win_tie_probability',
      'group_fair_value_cents',
      'group_place_1_probability',
      'group_place_2_probability',
      'group_place_3_probability',
      'group_place_4_probability',
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
      'total_recent_form_adjustment',
      'total_adjustment',
      'playoff_sg_rating',
      'weather_player_wave',
      'weather_adjustment',
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
        projection_model: activeProjectionModel,
        projection_model_label: activeProjectionModelLabel,
        recent_form_weight: recentFormWeight,
        weather_enabled: Boolean(activeWeatherOverrides?.enabled),
        weather_am_wave_adjustment_per_round: activeWeatherOverrides?.amWaveAdjustmentPerRound,
        weather_pm_wave_adjustment_per_round: activeWeatherOverrides?.pmWaveAdjustmentPerRound,
        weather_wind_volatility_multiplier: activeWeatherOverrides?.windVolatilityMultiplier,
        missing_projection_stats: getMissingProjectionStatKeys(player).map(formatStatKey).join('|'),
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
        group_size: player?.groupSize,
        group_win_probability: player?.groupWinProbability,
        group_win_tie_probability: player?.groupWinTieProbability,
        group_fair_value_cents: player?.groupFairValueCents,
        group_place_1_probability: player?.groupPlaceProbabilities?.[1],
        group_place_2_probability: player?.groupPlaceProbabilities?.[2],
        group_place_3_probability: player?.groupPlaceProbabilities?.[3],
        group_place_4_probability: player?.groupPlaceProbabilities?.[4],
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
        total_recent_form_adjustment: player?.projectionBreakdown?.totalRecentFormAdjustment,
        total_adjustment: player?.projectionBreakdown?.totalAdjustment,
        playoff_sg_rating: player?.playoffSgRating,
        weather_player_wave: player?.teeWave || '',
        weather_adjustment: player?.projectionBreakdown?.weatherAdjustment,
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
    const scopeKey =
      activeProjectionTab === GROUP_WINNER_TAB_KEY ? 'group-winner' : activeProjectionTab === 'tournament' ? 'tournament' : 'round';
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
      if (statKey === SG_T2G_STAT) {
        SG_T2G_COMPONENT_STATS.forEach((componentKey) => next.delete(componentKey));
      }
      if (SG_T2G_COMPONENT_STATS.includes(statKey)) {
        next.delete(SG_T2G_STAT);
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
      const baselineValue = editingPlayer?.playerStatInputs?.[statKey]?.baselineValue;
      if (!valuesDifferFromBaseline(numericValue, baselineValue)) continue;
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
      if (valuesDifferFromBaseline(numericValue, editingPlayer?.playerScoreInputs?.totalScoreNumber?.baselineValue)) {
        nextPlayerScoreMap.totalScoreNumber = numericValue;
      }
    }
    const rawRoundScore = String(editScoreDraft?.roundScoreNumber || '').trim();
    if (rawRoundScore) {
      const numericValue = Number(rawRoundScore);
      if (!Number.isFinite(numericValue)) {
        setEditError('Invalid number for Round Score.');
        return;
      }
      if (valuesDifferFromBaseline(numericValue, editingPlayer?.playerScoreInputs?.roundScoreNumber?.baselineValue)) {
        nextPlayerScoreMap.roundScoreNumber = numericValue;
      }
    }
    const rawCompletedHoles = String(editScoreDraft?.completedHoles || '').trim();
    if (rawCompletedHoles) {
      const numericValue = Number(rawCompletedHoles);
      if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > 18) {
        setEditError('Completed Holes must be a number between 0 and 18.');
        return;
      }
      const completedHolesValue = Math.floor(numericValue);
      if (valuesDifferFromBaseline(completedHolesValue, editingPlayer?.playerScoreInputs?.completedHoles?.baselineValue)) {
        nextPlayerScoreMap.completedHoles = completedHolesValue;
      }
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
  const hasAnySgStatSelected = useMemo(
    () => selectedStats.includes(SG_TOTAL_STAT) || SG_COMPONENT_STATS.some((statKey) => selectedStats.includes(statKey)),
    [selectedStats]
  );
  const hasAnySgT2gComponentSelected = useMemo(
    () => SG_T2G_COMPONENT_STATS.some((statKey) => selectedStats.includes(statKey)),
    [selectedStats]
  );
  const hasRecentFormSelected = selectedStats.includes(RECENT_FORM_STAT);
  const isValidatingSgCsv = sgCsvValidation.status === 'validating';
  const isValidatingRecentFormCsv = recentFormCsvValidation.status === 'validating';
  const toggleGroupPlayerSelection = (normalizedPlayerName) => {
    if (!normalizedPlayerName) return;
    setSelectedGroupPlayerNames((previous) => {
      if (previous.includes(normalizedPlayerName)) {
        return previous.filter((playerName) => playerName !== normalizedPlayerName);
      }
      if (previous.length >= GROUP_WINNER_MAX_PLAYERS) return previous;
      return [...previous, normalizedPlayerName];
    });
  };
  const clearGroupPlayerSelection = () => {
    setSelectedGroupPlayerNames([]);
  };

  useEffect(() => {
    loadEvents();
  }, []);

  useEffect(() => {
    if (!selectedGroupPlayerNames.length) return;
    const validPlayerNames = new Set(tournamentProjectionPlayers.map((player) => player?.normalizedPlayerName).filter(Boolean));
    const nextSelectedNames = selectedGroupPlayerNames.filter((playerName) => validPlayerNames.has(playerName));
    if (nextSelectedNames.length !== selectedGroupPlayerNames.length) {
      setSelectedGroupPlayerNames(nextSelectedNames);
    }
  }, [selectedGroupPlayerNames, tournamentProjectionPlayers]);

  useEffect(() => {
    if (!projectionScopes) {
      if (activeProjectionTab !== 'round' && activeProjectionTab !== GROUP_WINNER_TAB_KEY) {
        setActiveProjectionTab('round');
      }
      return;
    }

    if (activeProjectionTab === GROUP_WINNER_TAB_KEY && tournamentProjectionPlayers.length) return;
    if (projectionScopes[activeProjectionTab]) return;
    if (projectionScopes.round) {
      setActiveProjectionTab('round');
      return;
    }

    const firstScopeKey = Object.keys(projectionScopes)[0];
    if (firstScopeKey) {
      setActiveProjectionTab(firstScopeKey);
    }
  }, [projectionScopes, activeProjectionTab, tournamentProjectionPlayers.length]);

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
                        const disableSgT2g = option.key === SG_T2G_STAT && hasAnySgT2gComponentSelected;
                        const disableSgT2gComponent =
                          SG_T2G_COMPONENT_STATS.includes(option.key) && selectedStats.includes(SG_T2G_STAT);
                        const isDisabled =
                          disableSgTotal || disableSgComponent || disableSgT2g || disableSgT2gComponent || loading;
                        const isRecentFormOption = option.key === RECENT_FORM_STAT;
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
                            {isRecentFormOption ? (
                              <input
                                className="incremental-number-input rlp-inline-weight-input"
                                type="number"
                                step="0.05"
                                min="0"
                                max="1"
                                value={recentFormWeight}
                                onChange={(event) => updateRecentFormWeight(event.target.value)}
                                disabled={loading || !hasRecentFormSelected}
                                title="Recent Form weight"
                                aria-label="Recent Form weight"
                              />
                            ) : null}
                          </label>
                        );
                      })}
                    </div>
                    {group.id === 'strokes-gained' ? (
                      <div className="rlp-stat-upload stack">
                        <label>
                          Strokes Gained CSV (optional)
                          <input
                            ref={sgCsvInputRef}
                            type="file"
                            accept=".csv,text/csv"
                            onChange={handleSgCsvUpload}
                            disabled={loading || isValidatingSgCsv || !hasAnySgStatSelected}
                          />
                        </label>
                        <p className="muted">
                          {!hasAnySgStatSelected
                            ? 'Select an SG metric to enable SG CSV upload.'
                            : uploadedSgCsv
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
                              Clear Uploaded SG CSV
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {group.id === 'recent-form' ? (
                      <div className="rlp-stat-upload stack">
                        <label>
                          Recent Form CSV (optional)
                          <input
                            ref={recentFormCsvInputRef}
                            type="file"
                            accept=".csv,text/csv"
                            onChange={handleRecentFormCsvUpload}
                            disabled={loading || isValidatingRecentFormCsv || !hasRecentFormSelected}
                          />
                        </label>
                        <p className="muted">
                          {!hasRecentFormSelected
                            ? 'Select Recent Form L20 to enable Recent Form CSV upload.'
                            : uploadedRecentFormCsv
                              ? `Using uploaded Recent Form file: ${uploadedRecentFormCsv.fileName}.`
                              : 'No uploaded Recent Form CSV selected. Using latest backend Recent Form CSV by default.'}
                        </p>
                        {recentFormCsvValidation.status !== 'idle' ? (
                          <p className={`rlp-upload-status is-${recentFormCsvValidation.status}`}>
                            {recentFormCsvValidation.message}
                          </p>
                        ) : null}
                        {uploadedRecentFormCsv ? (
                          <div className="row">
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={clearUploadedRecentFormCsv}
                              disabled={loading || isValidatingRecentFormCsv}
                            >
                              Clear Uploaded Recent Form CSV
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
                <div className="rlp-stat-group">
                  <strong className="rlp-stat-group-title">Projection Model</strong>
                  <div className="rlp-stat-options">
                    <label className="rlp-stat-option">
                      <input
                        type="checkbox"
                        checked={useBlendedModel}
                        onChange={(event) => setUseBlendedModel(event.target.checked)}
                        disabled={loading}
                      />
                      <span>Blended Model</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="rlp-weather-panel stack">
                <div className="row-between">
                  <strong>Weather (Round Only, Optional)</strong>
                  <label className="rlp-weather-toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(weatherOverrides.enabled)}
                      onChange={(event) => setWeatherEnabled(event.target.checked)}
                      disabled={loading}
                    />
                    <span>Enable</span>
                  </label>
                </div>
                <p className="muted">
                  Applies only to Round Leader projections. Tournament projections ignore weather overrides.
                </p>
                <div className="rlp-weather-grid">
                  <label>
                    AM Wave Adj (strokes / round)
                    <input
                      className="incremental-number-input"
                      type="number"
                      step="0.05"
                      value={weatherOverrides.amWaveAdjustmentPerRound}
                      onChange={(event) => updateWeatherOverrideNumber('amWaveAdjustmentPerRound', event.target.value)}
                      disabled={loading || !weatherOverrides.enabled}
                    />
                  </label>
                  <label>
                    PM Wave Adj (strokes / round)
                    <input
                      className="incremental-number-input"
                      type="number"
                      step="0.05"
                      value={weatherOverrides.pmWaveAdjustmentPerRound}
                      onChange={(event) => updateWeatherOverrideNumber('pmWaveAdjustmentPerRound', event.target.value)}
                      disabled={loading || !weatherOverrides.enabled}
                    />
                  </label>
                  <label>
                    Wind Volatility Multiplier
                    <input
                      className="incremental-number-input"
                      type="number"
                      step="0.05"
                      min="0.4"
                      max="2.5"
                      value={weatherOverrides.windVolatilityMultiplier}
                      onChange={(event) => updateWeatherOverrideNumber('windVolatilityMultiplier', event.target.value)}
                      disabled={loading || !weatherOverrides.enabled}
                    />
                  </label>
                </div>
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
              disabled={loading || isValidatingSgCsv || isValidatingRecentFormCsv || !baseUrl.trim() || !selectedStats.length}
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
                  const isDisabled =
                    tab.key === GROUP_WINNER_TAB_KEY ? !tournamentProjectionPlayers.length : !projectionScopes?.[tab.key];
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
              {isGroupProjection ? (
                <div className="rlp-group-selector stack">
                  <div className="row-between">
                    <strong>Group Players</strong>
                    <div className="row rlp-group-selector-actions">
                      <span className="muted">
                        {selectedGroupSize} of {GROUP_WINNER_MAX_PLAYERS} selected
                      </span>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={clearGroupPlayerSelection}
                        disabled={!selectedGroupSize || loading}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <p className="muted">
                    Select 2-4 players from the tournament field. Group probabilities use the Tournament projection
                    horizon and apply dead-heat share splitting for ties.
                  </p>
                  <div className="rlp-group-player-grid">
                    {tournamentProjectionPlayers.map((player) => {
                      const normalizedPlayerName = player?.normalizedPlayerName;
                      const isSelected = selectedGroupPlayerNames.includes(normalizedPlayerName);
                      const isDisabled =
                        loading ||
                        (!isSelected && selectedGroupPlayerNames.length >= GROUP_WINNER_MAX_PLAYERS);
                      return (
                        <label
                          key={normalizedPlayerName || player?.playerName}
                          className={`rlp-group-player-option ${isSelected ? 'is-selected' : ''} ${
                            isDisabled ? 'is-disabled' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleGroupPlayerSelection(normalizedPlayerName)}
                            disabled={isDisabled}
                          />
                          <span>{player?.playerName || 'Unknown Player'}</span>
                          <small>{player?.expectedFinalScoreDisplay || '-'}</small>
                        </label>
                      );
                    })}
                  </div>
                  {!hasValidGroupSelection ? (
                    <p className="muted">Select at least 2 players to calculate group winner probabilities.</p>
                  ) : null}
                </div>
              ) : null}
              <div className="rlp-badge-row">
                {effectiveSelectedStats.map((statKey) => (
                  <span key={statKey} className="rlp-badge">
                    {formatStatKey(statKey)}
                  </span>
                ))}
                {manualOverrideCount ? <span className="rlp-badge">Manual Overrides: {manualOverrideCount}</span> : null}
                <span className="rlp-badge">Model: {activeProjectionModelLabel}</span>
                {payload.statDataSource ? (
                  <span className="rlp-badge">Stat Data: {payload.statDataSource}</span>
                ) : null}
                {payload.recentFormDataFile?.fileName ? (
                  <span className="rlp-badge">Recent Form: {payload.recentFormDataFile.fileName}</span>
                ) : null}
                {payload.displayDate ? <span className="rlp-badge">Dates: {payload.displayDate}</span> : null}
                {isGroupProjection && hasValidGroupSelection ? (
                  <span className="rlp-badge">Group: {selectedGroupSize} players, dead-heat adjusted</span>
                ) : null}
                {activeWeatherOverrides?.enabled ? <span className="rlp-badge">{weatherSummary}</span> : null}
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
                  disabled={loading || isValidatingSgCsv || isValidatingRecentFormCsv || !baseUrl.trim() || !selectedStats.length}
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
                        <button type="button" className="table-sort-button" onClick={() => requestPlayerSort('thruSortValue')}>
                          Thru <span className="table-sort-indicator">{getPlayerSortIndicator('thruSortValue')}</span>
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
                          On Hole{' '}
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
                        <button
                          type="button"
                          className="table-sort-button"
                          onClick={() => requestPlayerSort(isGroupProjection ? 'groupWinProbability' : 'winTieProbability')}
                          title={isGroupProjection ? 'Dead-heat adjusted probability of winning the selected group' : undefined}
                        >
                          {isGroupProjection ? 'DH Group Win' : 'Win/Tie Pct'}{' '}
                          <span className="table-sort-indicator">
                            {getPlayerSortIndicator(isGroupProjection ? 'groupWinProbability' : 'winTieProbability')}
                          </span>
                        </button>
                      </th>
                      {isGroupProjection ? (
                        <th>
                          <button
                            type="button"
                            className="table-sort-button"
                            onClick={() => requestPlayerSort('groupWinTieProbability')}
                            title="Raw probability of winning or tying for first in the selected group before dead-heat split"
                          >
                            Win Tie %{' '}
                            <span className="table-sort-indicator">{getPlayerSortIndicator('groupWinTieProbability')}</span>
                          </button>
                        </th>
                      ) : null}
                      {isGroupProjection ? (
                        <th>
                          <button
                            type="button"
                            className="table-sort-button"
                            onClick={() => requestPlayerSort('groupPlace1Probability')}
                            title="Dead-heat adjusted probability share for finishing first in the selected group"
                          >
                            1/{selectedGroupSize || 'x'}{' '}
                            <span className="table-sort-indicator">{getPlayerSortIndicator('groupPlace1Probability')}</span>
                          </button>
                        </th>
                      ) : null}
                      {isGroupProjection ? (
                        <th>
                          <button
                            type="button"
                            className="table-sort-button"
                            onClick={() => requestPlayerSort('groupPlace2Probability')}
                            title="Dead-heat adjusted probability share for finishing second in the selected group"
                          >
                            2/{selectedGroupSize || 'x'}{' '}
                            <span className="table-sort-indicator">{getPlayerSortIndicator('groupPlace2Probability')}</span>
                          </button>
                        </th>
                      ) : null}
                      {isGroupProjection && selectedGroupSize >= 3 ? (
                        <th>
                          <button
                            type="button"
                            className="table-sort-button"
                            onClick={() => requestPlayerSort('groupPlace3Probability')}
                            title="Dead-heat adjusted probability share for finishing third in the selected group"
                          >
                            3/{selectedGroupSize}{' '}
                            <span className="table-sort-indicator">{getPlayerSortIndicator('groupPlace3Probability')}</span>
                          </button>
                        </th>
                      ) : null}
                      {isGroupProjection && selectedGroupSize >= 4 ? (
                        <th>
                          <button
                            type="button"
                            className="table-sort-button"
                            onClick={() => requestPlayerSort('groupPlace4Probability')}
                            title="Dead-heat adjusted probability share for finishing fourth in the selected group"
                          >
                            4/{selectedGroupSize}{' '}
                            <span className="table-sort-indicator">{getPlayerSortIndicator('groupPlace4Probability')}</span>
                          </button>
                        </th>
                      ) : null}
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
                      {showTop10Column ? (
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
                      {showTop5Column ? (
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
                          onClick={() => requestPlayerSort(isGroupProjection ? 'groupFairValueCents' : 'fairValueYesCents')}
                          title={isGroupProjection ? 'Dead-heat adjusted group winner fair value' : 'Win fair value'}
                        >
                          {isGroupProjection ? 'DH Group FV' : 'Win'}{' '}
                          <span className="table-sort-indicator">
                            {getPlayerSortIndicator(isGroupProjection ? 'groupFairValueCents' : 'fairValueYesCents')}
                          </span>
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
                      const missingProjectionStatsTooltip = buildMissingProjectionStatsTooltip(player);
                      const manualOverrideTooltip = buildManualOverrideTooltip(player);
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
                              {missingProjectionStatsTooltip ? (
                                <span
                                  className="rlp-missing-stat-icon"
                                  title={missingProjectionStatsTooltip}
                                  aria-label={`${player.playerName} missing projection stat data`}
                                >
                                  !
                                </span>
                              ) : null}
                              {manualOverrideTooltip ? (
                                <span
                                  className="rlp-manual-override-icon"
                                  title={manualOverrideTooltip}
                                  aria-label={`${player.playerName} has manual projection overrides`}
                                >
                                  m
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
                          <td>{player.currentThruDisplay || player.thruRaw}</td>
                          <td>{player.startedOnBackNine ? 'Back' : 'Front'}</td>
                          <td>{player.currentHole}</td>
                          <td>{player.holesRemaining}</td>
                          <td>{formatWinTiePct(player, activeProjectionTab)}</td>
                          {isGroupProjection ? <td>{formatWinPct(player?.groupWinTieProbability)}</td> : null}
                          {isGroupProjection ? <td>{formatWinPct(player?.groupPlaceProbabilities?.[1])}</td> : null}
                          {isGroupProjection ? <td>{formatWinPct(player?.groupPlaceProbabilities?.[2])}</td> : null}
                          {isGroupProjection && selectedGroupSize >= 3 ? (
                            <td>{formatWinPct(player?.groupPlaceProbabilities?.[3])}</td>
                          ) : null}
                          {isGroupProjection && selectedGroupSize >= 4 ? (
                            <td>{formatWinPct(player?.groupPlaceProbabilities?.[4])}</td>
                          ) : null}
                          {isTournamentProjection ? (
                            <td title={buildTopFinishTooltip(player, 20)}>
                              {formatFairValueFromProbability(player?.top20DeadHeatProbability)}
                            </td>
                          ) : null}
                          {showTop10Column ? (
                            <td title={buildTopFinishTooltip(player, 10)}>
                              {formatFairValueFromProbability(player?.top10DeadHeatProbability)}
                            </td>
                          ) : null}
                          {showTop5Column ? (
                            <td title={buildTopFinishTooltip(player, 5)}>
                              {formatFairValueFromProbability(player?.top5DeadHeatProbability)}
                            </td>
                          ) : null}
                          <td>{formatFairValueCents(isGroupProjection ? player.groupFairValueCents : player.fairValueYesCents)}</td>
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
    recent_form_l20: 'Recent Form L20',
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
  if (Number.isFinite(sgValue)) return sgValue;
  const recentFormValue = Number(projectionBreakdown?.recentFormAdjustments?.[statKey]);
  return Number.isFinite(recentFormValue) ? recentFormValue : null;
}

function buildProjectionTooltip(player) {
  const projectionBreakdown = player?.projectionBreakdown;
  if (!projectionBreakdown) return '';

  const selectedStats = Array.isArray(projectionBreakdown.selectedStats) ? projectionBreakdown.selectedStats : [];
  const projectionModel = String(projectionBreakdown?.projectionModel || PROJECTION_MODEL_STANDARD);
  const summaryLines = selectedStats
    .map((statKey) => {
      const value = getBreakdownValueByStatKey(projectionBreakdown, statKey);
      if (!Number.isFinite(value)) return null;
      const label = statKey === 'course_hole_model' ? 'Base' : formatStatKey(statKey);
      return `${label}: ${formatSignedValue(value, 4)}`;
    })
    .filter(Boolean);
  if (projectionModel === PROJECTION_MODEL_BLENDED) {
    const parWeight = Number(projectionBreakdown?.parBlendWeight);
    const sgWeight = Number(projectionBreakdown?.sgBlendWeight);
    const weightParts = [];
    if (Number.isFinite(parWeight)) weightParts.push(`Par x${parWeight.toFixed(2)}`);
    if (Number.isFinite(sgWeight)) weightParts.push(`SG x${sgWeight.toFixed(2)}`);
    summaryLines.unshift(`Model: Blended${weightParts.length ? ` (${weightParts.join(' | ')})` : ''}`);
  }
  const weatherAdjustment = Number(projectionBreakdown?.weatherAdjustment);
  const weatherAdjustmentPerRound = Number(projectionBreakdown?.weatherAdjustmentPerRound);
  const weatherVolatilityMultiplier = Number(projectionBreakdown?.windVolatilityMultiplier);
  const teeWave = String(projectionBreakdown?.teeWave || '').toUpperCase();
  const hasWeatherSignal =
    Number.isFinite(weatherAdjustment) ||
    Number.isFinite(weatherAdjustmentPerRound) ||
    Number.isFinite(weatherVolatilityMultiplier);
  if (hasWeatherSignal) {
    const weatherParts = [];
    if (Number.isFinite(weatherAdjustment)) {
      weatherParts.push(`Adj ${formatSignedValue(weatherAdjustment, 4)}`);
    }
    if (Number.isFinite(weatherAdjustmentPerRound)) {
      weatherParts.push(`PerRound ${formatSignedValue(weatherAdjustmentPerRound, 3)}`);
    }
    if (Number.isFinite(weatherVolatilityMultiplier) && Math.abs(weatherVolatilityMultiplier - 1) > 0.0005) {
      weatherParts.push(`Vol x${weatherVolatilityMultiplier.toFixed(2)}`);
    }
    if (teeWave) {
      weatherParts.push(`Wave ${teeWave}`);
    }
    if (weatherParts.length) {
      summaryLines.push(`Weather: ${weatherParts.join(' | ')}`);
    }
  }
  const recentFormWeight = Number(projectionBreakdown?.recentFormWeight);
  if (selectedStats.includes(RECENT_FORM_STAT) && Number.isFinite(recentFormWeight)) {
    summaryLines.push(`Recent Form Weight: ${recentFormWeight.toFixed(2)}`);
  }

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
        const recentFormValue = Number(hole.recentFormAdjustment);
        const recentFormPart = Number.isFinite(recentFormValue) && Math.abs(recentFormValue) > 0.00005
          ? ` | RFAdj ${formatSignedValue(recentFormValue, 4)}`
          : '';
        const totalPart = `Total ${formatSignedValue(Number(hole.total), 4)}`;
        return `${holeLabel}: ${basePart} | ${parPart}${sgPart}${recentFormPart} | ${totalPart}`;
      })
    : [];

  return [...summaryLines, ...(holeLines.length ? ['', 'Per-hole:'] : []), ...holeLines].join('\n');
}
