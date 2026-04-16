const NEXT_DATA_REGEX = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/;
const GRAPHQL_CONFIG_REGEX =
  /"graphqlHostname":"([^"]+)","graphqlKey":"([^"]+)","graphqlWebSocket":"[^"]*"/;
const PGA_URL_SUFFIXES = new Set(['leaderboard', 'tourcast', 'course-stats']);
const {
  DEFAULT_SELECTED_STATS,
  SG_STAT_KEYS,
  getRoundLeaderProjectionSgDataVersionKey,
  normalizePlayerName,
  normalizeStatSelection,
  scrapeRoundLeaderProjectionStats,
} = require('./roundLeaderProjectionStatService');
const { getOrCreateRoundLeaderProjectionStatSnapshot } = require('./roundLeaderProjectionStatCacheService');

const HOLE_DETAILS_QUERY = `
  query GetHoleStats($courseId: ID!, $hole: Int!, $tournamentId: ID!) {
    holeDetails(courseId: $courseId, hole: $hole, tournamentId: $tournamentId) {
      holeInfo {
        holeNum
        par
        scoringAverageDiff
        yards
      }
    }
  }
`;

const WIN_PROBABILITY_SIMULATION_TRIALS = 8000;
const SCORE_TIE_EPSILON = 0.000001;
const FINAL_SCORE_BUCKET_DECIMALS = 0;
const PLAYOFF_SG_SOFTMAX_TEMPERATURE = 0.65;
const TOP_FINISH_CUTOFFS = [20, 10, 5];
const DEFAULT_HOLE_STD_DEV_BY_PAR = {
  3: 0.72,
  4: 0.84,
  5: 0.93,
};
const PLAYER_EDITABLE_STAT_KEYS = new Set([
  'par3_scoring_avg',
  'par4_scoring_avg',
  'par5_scoring_avg',
  ...SG_STAT_KEYS,
]);
const ALL_PLAYER_PROJECTION_STAT_KEYS = [
  'par3_scoring_avg',
  'par4_scoring_avg',
  'par5_scoring_avg',
  ...SG_STAT_KEYS,
];

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function toNumberOrNull(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/,/g, '').trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIntegerOrNull(value) {
  const parsed = toNumberOrNull(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
}

function normalizeTournamentBaseUrl(inputUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(inputUrl);
  } catch (_error) {
    throw createHttpError(400, `Invalid URL: ${inputUrl}`);
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw createHttpError(400, `Unsupported protocol: ${parsedUrl.protocol}`);
  }

  const segments = parsedUrl.pathname.split('/').filter(Boolean);
  if (!segments.length) {
    throw createHttpError(400, 'Tournament URL path is required.');
  }

  const lastSegment = String(segments[segments.length - 1] || '').toLowerCase();
  if (PGA_URL_SUFFIXES.has(lastSegment)) {
    segments.pop();
  }

  if (!segments.length) {
    throw createHttpError(400, 'Tournament URL path is required.');
  }

  parsedUrl.search = '';
  parsedUrl.hash = '';
  parsedUrl.pathname = `/${segments.join('/')}/`;
  return parsedUrl.toString();
}

function resolveSourceUrls({
  baseUrl,
  leaderboardUrl,
  tourcastUrl,
  courseStatsUrl,
}) {
  const baseCandidate = baseUrl || leaderboardUrl || tourcastUrl || courseStatsUrl;
  if (!baseCandidate) {
    throw createHttpError(400, 'A tournament URL is required.');
  }

  const normalizedBaseUrl = normalizeTournamentBaseUrl(baseCandidate);
  return {
    normalizedBaseUrl,
    leaderboardUrl: `${normalizedBaseUrl}leaderboard`,
    tourcastUrl: `${normalizedBaseUrl}tourcast`,
    courseStatsUrl: `${normalizedBaseUrl}course-stats`,
  };
}

async function fetchText(url) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (_error) {
    throw createHttpError(400, `Invalid URL: ${url}`);
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw createHttpError(400, `Unsupported protocol: ${parsedUrl.protocol}`);
  }

  const response = await fetch(parsedUrl.toString(), {
    headers: {
      'user-agent': 'BetLab/1.0 (+https://localhost)',
      accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    throw createHttpError(502, `Failed to fetch ${parsedUrl.hostname} (${response.status}).`);
  }

  return response.text();
}

function parseNextDataFromHtml(html, sourceName) {
  const match = html.match(NEXT_DATA_REGEX);
  if (!match) {
    throw createHttpError(502, `Could not locate __NEXT_DATA__ in ${sourceName}.`);
  }

  try {
    return JSON.parse(match[1]);
  } catch (_error) {
    throw createHttpError(502, `Failed to parse embedded ${sourceName} page data.`);
  }
}

function getLeaderboardData(nextData) {
  const queries = nextData?.props?.pageProps?.dehydratedState?.queries;
  if (!Array.isArray(queries)) {
    throw createHttpError(502, 'Unexpected leaderboard page structure.');
  }

  const leaderboardQuery = queries.find((query) => query?.queryKey?.[0] === 'leaderboard');
  const leaderboardData = leaderboardQuery?.state?.data;
  if (!leaderboardData || !Array.isArray(leaderboardData.players)) {
    throw createHttpError(502, 'Leaderboard payload did not include player rows.');
  }

  return leaderboardData;
}

function parseGraphqlConfigFromTourcastHtml(html) {
  const normalizedHtml = html.replace(/\\"/g, '"');
  const match = normalizedHtml.match(GRAPHQL_CONFIG_REGEX);
  if (!match) {
    throw createHttpError(502, 'Could not locate Tourcast GraphQL configuration.');
  }

  return {
    graphqlHostname: match[1],
    graphqlKey: match[2],
  };
}

function getCourseStatsData(nextData) {
  const queries = nextData?.props?.pageProps?.dehydratedState?.queries;
  if (!Array.isArray(queries)) {
    throw createHttpError(502, 'Unexpected course-stats page structure.');
  }

  const courseStatsQuery = queries.find((query) => query?.queryKey?.[0] === 'courseStats');
  const courseStatsData = courseStatsQuery?.state?.data;
  if (!courseStatsData || !Array.isArray(courseStatsData.courses)) {
    throw createHttpError(502, 'Course stats payload did not include course rows.');
  }

  return courseStatsData;
}

function getTournamentData(nextData, tournamentId) {
  const queries = nextData?.props?.pageProps?.dehydratedState?.queries;
  if (!Array.isArray(queries)) return null;

  const exactMatch = queries.find(
    (query) => query?.queryKey?.[0] === 'tournament' && query?.queryKey?.[1]?.id === tournamentId
  );
  if (exactMatch?.state?.data) return exactMatch.state.data;

  const fallback = queries.find((query) => query?.queryKey?.[0] === 'tournament');
  return fallback?.state?.data || null;
}

function toScoreNumber(scoreRaw) {
  if (scoreRaw === null || scoreRaw === undefined) return null;
  const cleaned = String(scoreRaw).trim();
  if (!cleaned || cleaned === '-') return null;
  if (cleaned === 'E') return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDisplayScore(scoreNumber) {
  if (scoreNumber === null) return '-';
  if (scoreNumber > 0) return `+${scoreNumber}`;
  if (scoreNumber === 0) return 'E';
  return String(scoreNumber);
}

function toSimulationNumberOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function buildTeeOrder(startedOnBackNine) {
  if (!startedOnBackNine) {
    return Array.from({ length: 18 }, (_, index) => index + 1);
  }

  return [
    ...Array.from({ length: 9 }, (_, index) => index + 10),
    ...Array.from({ length: 9 }, (_, index) => index + 1),
  ];
}

function clampCompletedHoles(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(18, Math.floor(value)));
}

function parseCompletedHoles(thruRaw, thruSort) {
  const fromSort = clampCompletedHoles(thruSort);
  if (fromSort !== null) return fromSort;

  if (typeof thruRaw !== 'string' || !thruRaw.trim()) return null;
  const cleaned = thruRaw.replace('*', '').trim().toUpperCase();
  if (cleaned === 'F') return 18;

  const maybeNumber = Number(cleaned);
  return clampCompletedHoles(maybeNumber);
}

function deriveTotalRounds(rounds) {
  if (!Array.isArray(rounds) || !rounds.length) return 4;
  const values = rounds
    .map((round) => Number(round?.roundNumber))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.floor(value));
  if (!values.length) return Math.max(4, rounds.length);
  return Math.max(...values);
}

function normalizeCurrentRound(currentRound, totalRounds) {
  const parsed = Number(currentRound);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(totalRounds, Math.floor(parsed)));
}

function buildRemainingHolePlan({
  completedHoles,
  startedOnBackNine,
  projectionScope,
  currentRound,
  totalRounds,
}) {
  if (!Number.isFinite(completedHoles)) {
    return {
      currentRoundRemaining: [],
      futureRoundRemaining: [],
      allRemaining: [],
    };
  }

  const normalizedCurrentRound = normalizeCurrentRound(currentRound, totalRounds);
  const clampedCompletedHoles = Math.max(0, Math.min(18, Math.floor(completedHoles)));
  const teeOrder = buildTeeOrder(startedOnBackNine);
  const currentRoundRemaining = teeOrder.slice(clampedCompletedHoles).map((holeNumber) => ({
    roundNumber: normalizedCurrentRound,
    holeNumber,
    inCurrentRound: true,
  }));

  if (projectionScope !== 'tournament') {
    return {
      currentRoundRemaining,
      futureRoundRemaining: [],
      allRemaining: currentRoundRemaining,
    };
  }

  const futureRoundRemaining = [];
  for (let roundNumber = normalizedCurrentRound + 1; roundNumber <= totalRounds; roundNumber += 1) {
    for (let holeNumber = 1; holeNumber <= 18; holeNumber += 1) {
      futureRoundRemaining.push({
        roundNumber,
        holeNumber,
        inCurrentRound: false,
      });
    }
  }

  return {
    currentRoundRemaining,
    futureRoundRemaining,
    allRemaining: [...currentRoundRemaining, ...futureRoundRemaining],
  };
}

function normalizeStatOverrides(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  const normalizedByPlayer = {};
  Object.entries(input).forEach(([playerKey, statValues]) => {
    const normalizedPlayerName = normalizePlayerName(playerKey);
    if (!normalizedPlayerName || !statValues || typeof statValues !== 'object' || Array.isArray(statValues)) {
      return;
    }

    const nextStatValues = {};
    Object.entries(statValues).forEach(([statKey, value]) => {
      if (!PLAYER_EDITABLE_STAT_KEYS.has(statKey)) return;
      const numericValue = toNumberOrNull(value);
      if (!Number.isFinite(numericValue)) return;
      nextStatValues[statKey] = numericValue;
    });

    if (Object.keys(nextStatValues).length) {
      normalizedByPlayer[normalizedPlayerName] = nextStatValues;
    }
  });

  return normalizedByPlayer;
}

function parseCompletedHolesOverride(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') {
    const cleaned = value.trim().toUpperCase();
    if (!cleaned) return null;
    if (cleaned === 'F') return 18;
    return clampCompletedHoles(Number(cleaned));
  }
  return clampCompletedHoles(Number(value));
}

function normalizeScoreOverrides(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  const normalizedByPlayer = {};
  Object.entries(input).forEach(([playerKey, scoreValues]) => {
    const normalizedPlayerName = normalizePlayerName(playerKey);
    if (!normalizedPlayerName || !scoreValues || typeof scoreValues !== 'object' || Array.isArray(scoreValues)) {
      return;
    }

    const nextScoreValues = {};
    const totalScoreNumber = toNumberOrNull(
      scoreValues.totalScoreNumber ?? scoreValues.scoreNumber ?? scoreValues.totalScore ?? scoreValues.score
    );
    if (Number.isFinite(totalScoreNumber)) {
      nextScoreValues.totalScoreNumber = roundTo(totalScoreNumber, 2);
    }

    const roundScoreNumber = toNumberOrNull(
      scoreValues.roundScoreNumber ?? scoreValues.roundScore ?? scoreValues.currentRoundScore
    );
    if (Number.isFinite(roundScoreNumber)) {
      nextScoreValues.roundScoreNumber = roundTo(roundScoreNumber, 2);
    }

    const completedHoles = parseCompletedHolesOverride(
      scoreValues.completedHoles ?? scoreValues.thruSort ?? scoreValues.thru
    );
    if (completedHoles !== null) {
      nextScoreValues.completedHoles = completedHoles;
    }

    if (Object.keys(nextScoreValues).length) {
      normalizedByPlayer[normalizedPlayerName] = nextScoreValues;
    }
  });

  return normalizedByPlayer;
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toNonNegativeInteger(value) {
  const integerValue = toIntegerOrNull(value);
  if (!Number.isFinite(integerValue)) return 0;
  return Math.max(0, integerValue);
}

function getDefaultHoleStdDev(par) {
  return DEFAULT_HOLE_STD_DEV_BY_PAR[par] || DEFAULT_HOLE_STD_DEV_BY_PAR[4];
}

function estimateHoleStdDev(hole) {
  const par = toIntegerOrNull(hole?.par);
  const fallback = getDefaultHoleStdDev(par);
  const scoreBuckets = [
    { count: toNonNegativeInteger(hole?.eagles), deltaFromPar: -2 },
    { count: toNonNegativeInteger(hole?.birdies), deltaFromPar: -1 },
    { count: toNonNegativeInteger(hole?.pars), deltaFromPar: 0 },
    { count: toNonNegativeInteger(hole?.bogeys), deltaFromPar: 1 },
    { count: toNonNegativeInteger(hole?.doubleBogeys), deltaFromPar: 2 },
  ];
  const totalObservations = scoreBuckets.reduce((sum, bucket) => sum + bucket.count, 0);
  if (totalObservations < 20) {
    return fallback;
  }

  const mean =
    scoreBuckets.reduce((sum, bucket) => sum + bucket.deltaFromPar * bucket.count, 0) / totalObservations;
  const variance =
    scoreBuckets.reduce((sum, bucket) => {
      const diff = bucket.deltaFromPar - mean;
      return sum + diff * diff * bucket.count;
    }, 0) / totalObservations;

  if (!Number.isFinite(variance) || variance <= 0) {
    return fallback;
  }

  return clampNumber(Math.sqrt(variance), 0.3, 1.8);
}

function buildHoleStdDevByNumber(holeStats) {
  const byHoleNumber = new Map();
  (Array.isArray(holeStats) ? holeStats : []).forEach((hole) => {
    const holeNumber = toIntegerOrNull(hole?.holeNumber);
    if (!Number.isFinite(holeNumber)) return;
    byHoleNumber.set(holeNumber, estimateHoleStdDev(hole));
  });
  return byHoleNumber;
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

function resolveWinnerIndexesByScores(scoresByIndex) {
  let bestScore = Infinity;
  const winnerIndexes = [];

  scoresByIndex.forEach((scoreRaw, index) => {
    const score = toSimulationNumberOrNull(scoreRaw);
    if (!Number.isFinite(score)) return;
    if (score < bestScore - SCORE_TIE_EPSILON) {
      bestScore = score;
      winnerIndexes.length = 0;
      winnerIndexes.push(index);
      return;
    }
    if (Math.abs(score - bestScore) <= SCORE_TIE_EPSILON) {
      winnerIndexes.push(index);
    }
  });

  return winnerIndexes;
}

function toOutcomeScoreBucket(score) {
  if (!Number.isFinite(score)) return null;
  // Final golf scores are whole strokes, so bucket simulated outcomes at stroke granularity.
  return roundTo(score, FINAL_SCORE_BUCKET_DECIMALS);
}

function buildTieOutcomeShares({
  winnerIndexes,
  players,
  tieResolutionMode,
  playoffTemperature = PLAYOFF_SG_SOFTMAX_TEMPERATURE,
}) {
  if (!Array.isArray(winnerIndexes) || !winnerIndexes.length) {
    return [];
  }

  const equalShare = 1 / winnerIndexes.length;
  if (tieResolutionMode !== 'single_winner_sg_weighted') {
    return winnerIndexes.map(() => equalShare);
  }

  const ratings = winnerIndexes.map((winnerIndex) => {
    const rating = Number(players?.[winnerIndex]?.playoffSgRating);
    return Number.isFinite(rating) ? rating : 0;
  });
  const hasNonZeroSignal = ratings.some((value) => Math.abs(value) > 0.000001);
  if (!hasNonZeroSignal || !Number.isFinite(playoffTemperature) || playoffTemperature <= 0) {
    return winnerIndexes.map(() => equalShare);
  }

  const scaledRatings = ratings.map((rating) => rating / playoffTemperature);
  const maxScaledRating = Math.max(...scaledRatings);
  const exponentials = scaledRatings.map((scaled) => Math.exp(scaled - maxScaledRating));
  const denominator = exponentials.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return winnerIndexes.map(() => equalShare);
  }

  return exponentials.map((value) => value / denominator);
}

function buildTopFinishOutcomeShares({ scoresByIndex, cutoff }) {
  const normalizedCutoff = toIntegerOrNull(cutoff);
  if (!Number.isFinite(normalizedCutoff) || normalizedCutoff <= 0) {
    return {
      rawTopFinishSharesByIndex: new Map(),
      deadHeatTopFinishSharesByIndex: new Map(),
    };
  }

  const scoreGroups = new Map();
  scoresByIndex.forEach((scoreRaw, index) => {
    const score = toSimulationNumberOrNull(scoreRaw);
    if (!Number.isFinite(score)) return;
    if (!scoreGroups.has(score)) {
      scoreGroups.set(score, []);
    }
    scoreGroups.get(score).push(index);
  });

  const orderedGroups = Array.from(scoreGroups.entries()).sort((left, right) => left[0] - right[0]);
  const rawTopFinishSharesByIndex = new Map();
  const deadHeatTopFinishSharesByIndex = new Map();
  let occupiedPlaces = 0;

  for (const [, groupIndexes] of orderedGroups) {
    if (occupiedPlaces >= normalizedCutoff) break;
    const groupSize = Array.isArray(groupIndexes) ? groupIndexes.length : 0;
    if (!groupSize) continue;

    const groupStartPlace = occupiedPlaces + 1;
    const groupEndPlace = occupiedPlaces + groupSize;
    const placesInsideCutoff = Math.max(0, Math.min(groupEndPlace, normalizedCutoff) - groupStartPlace + 1);
    const intersectsCutoff = placesInsideCutoff > 0;
    const deadHeatShare = intersectsCutoff ? placesInsideCutoff / groupSize : 0;

    if (intersectsCutoff) {
      groupIndexes.forEach((index) => {
        rawTopFinishSharesByIndex.set(index, 1);
        deadHeatTopFinishSharesByIndex.set(index, deadHeatShare);
      });
    }

    occupiedPlaces += groupSize;
  }

  return {
    rawTopFinishSharesByIndex,
    deadHeatTopFinishSharesByIndex,
  };
}

function attachWinProbabilities({
  players,
  holeStdDevByNumber,
  simulationTrials = WIN_PROBABILITY_SIMULATION_TRIALS,
  seedInput,
  tieResolutionMode = 'tie_split',
  playoffTemperature = PLAYOFF_SG_SOFTMAX_TEMPERATURE,
}) {
  const projectedPlayers = Array.isArray(players) ? players : [];
  if (!projectedPlayers.length) {
    return {
      players: projectedPlayers,
      modelMeta: {
        method: 'monte-carlo-normal',
        tieHandling: 'split',
        trials: 0,
        deterministic: true,
      },
    };
  }

  const scoreStdDevs = projectedPlayers.map((player) => {
    const expectedScore = toSimulationNumberOrNull(player?.expectedFinalScoreNumber);
    if (!Number.isFinite(expectedScore)) return null;

    const remainingHoles = Array.isArray(player?.remainingHoles) ? player.remainingHoles : [];
    const varianceSum = remainingHoles.reduce((sum, holeNumberRaw) => {
      const holeNumber = toIntegerOrNull(holeNumberRaw);
      const holeStdDev =
        Number.isFinite(holeNumber) && Number.isFinite(holeStdDevByNumber.get(holeNumber))
          ? holeStdDevByNumber.get(holeNumber)
          : DEFAULT_HOLE_STD_DEV_BY_PAR[4];
      return sum + holeStdDev * holeStdDev;
    }, 0);
    return varianceSum > 0 ? Math.sqrt(varianceSum) : 0;
  });

  const hasAnyValidScore = projectedPlayers.some((player) =>
    Number.isFinite(toSimulationNumberOrNull(player?.expectedFinalScoreNumber))
  );
  const canRunSimulation = hasAnyValidScore && scoreStdDevs.some((value) => Number.isFinite(value) && value > 0);
  const winShares = new Array(projectedPlayers.length).fill(0);
  const winSoloCounts = new Array(projectedPlayers.length).fill(0);
  const tieForLeadCounts = new Array(projectedPlayers.length).fill(0);
  const topFinishRawSharesByCutoff = TOP_FINISH_CUTOFFS.reduce((accumulator, cutoff) => {
    accumulator[cutoff] = new Array(projectedPlayers.length).fill(0);
    return accumulator;
  }, {});
  const topFinishDeadHeatSharesByCutoff = TOP_FINISH_CUTOFFS.reduce((accumulator, cutoff) => {
    accumulator[cutoff] = new Array(projectedPlayers.length).fill(0);
    return accumulator;
  }, {});

  const accumulateTopFinishShares = (scoresByIndex) => {
    TOP_FINISH_CUTOFFS.forEach((cutoff) => {
      const { rawTopFinishSharesByIndex, deadHeatTopFinishSharesByIndex } = buildTopFinishOutcomeShares({
        scoresByIndex,
        cutoff,
      });
      rawTopFinishSharesByIndex.forEach((share, index) => {
        if (!Number.isFinite(share) || !Number.isFinite(topFinishRawSharesByCutoff[cutoff][index])) return;
        topFinishRawSharesByCutoff[cutoff][index] += share;
      });
      deadHeatTopFinishSharesByIndex.forEach((share, index) => {
        if (!Number.isFinite(share) || !Number.isFinite(topFinishDeadHeatSharesByCutoff[cutoff][index])) return;
        topFinishDeadHeatSharesByCutoff[cutoff][index] += share;
      });
    });
  };

  if (!canRunSimulation) {
    const deterministicScores = projectedPlayers.map((player) => player?.expectedFinalScoreNumber);
    const deterministicWinnerIndexes = resolveWinnerIndexesByScores(
      deterministicScores
    );
    if (deterministicWinnerIndexes.length) {
      const outcomeShares = buildTieOutcomeShares({
        winnerIndexes: deterministicWinnerIndexes,
        players: projectedPlayers,
        tieResolutionMode,
        playoffTemperature,
      });
      deterministicWinnerIndexes.forEach((index, winnerOffset) => {
        winShares[index] = Number.isFinite(outcomeShares[winnerOffset]) ? outcomeShares[winnerOffset] : 0;
        if (deterministicWinnerIndexes.length === 1) {
          winSoloCounts[index] = 1;
        } else {
          tieForLeadCounts[index] = 1;
        }
      });
      accumulateTopFinishShares(deterministicScores);
    }
  } else {
    const randomFn = createSeededRandom(seedInput);
    const sampleNormal = createStandardNormalSampler(randomFn);

    for (let trial = 0; trial < simulationTrials; trial += 1) {
      const sampledScores = projectedPlayers.map((player, index) => {
        const expectedScore = toSimulationNumberOrNull(player?.expectedFinalScoreNumber);
        if (!Number.isFinite(expectedScore)) return null;
        const scoreStdDev = scoreStdDevs[index] || 0;
        const sampledScore = scoreStdDev > 0 ? expectedScore + sampleNormal() * scoreStdDev : expectedScore;
        return toOutcomeScoreBucket(sampledScore);
      });
      const winnerIndexes = resolveWinnerIndexesByScores(sampledScores);
      if (!winnerIndexes.length) continue;
      accumulateTopFinishShares(sampledScores);

      const outcomeShares = buildTieOutcomeShares({
        winnerIndexes,
        players: projectedPlayers,
        tieResolutionMode,
        playoffTemperature,
      });
      winnerIndexes.forEach((index, winnerOffset) => {
        const winnerShare = Number.isFinite(outcomeShares[winnerOffset]) ? outcomeShares[winnerOffset] : 0;
        winShares[index] += winnerShare;
        if (winnerIndexes.length === 1) {
          winSoloCounts[index] += 1;
        } else {
          tieForLeadCounts[index] += 1;
        }
      });
    }
  }

  const denominator = canRunSimulation ? simulationTrials : 1;
  return {
    players: projectedPlayers.map((player, index) => {
      const hasExpectedScore = Number.isFinite(toSimulationNumberOrNull(player?.expectedFinalScoreNumber));
      const shareProbability = hasExpectedScore ? winShares[index] / denominator : null;
      const winSoloProbability = hasExpectedScore ? winSoloCounts[index] / denominator : null;
      const tieForLeadProbability = hasExpectedScore ? tieForLeadCounts[index] / denominator : null;
      const winTieProbability =
        Number.isFinite(winSoloProbability) && Number.isFinite(tieForLeadProbability)
          ? winSoloProbability + tieForLeadProbability
          : null;
      const fairValueYesProbability = Number.isFinite(shareProbability) ? shareProbability : null;
      const topFinishFields = TOP_FINISH_CUTOFFS.reduce((accumulator, cutoff) => {
        const rawShare = Number(topFinishRawSharesByCutoff?.[cutoff]?.[index]);
        const deadHeatShare = Number(topFinishDeadHeatSharesByCutoff?.[cutoff]?.[index]);
        const rawProbability = hasExpectedScore ? rawShare / denominator : null;
        const deadHeatProbability = hasExpectedScore ? deadHeatShare / denominator : null;
        accumulator[`top${cutoff}Probability`] = Number.isFinite(rawProbability) ? roundTo(rawProbability, 6) : null;
        accumulator[`top${cutoff}ProbabilityPct`] = Number.isFinite(rawProbability)
          ? roundTo(rawProbability * 100, 2)
          : null;
        accumulator[`top${cutoff}DeadHeatProbability`] = Number.isFinite(deadHeatProbability)
          ? roundTo(deadHeatProbability, 6)
          : null;
        accumulator[`top${cutoff}DeadHeatPct`] = Number.isFinite(deadHeatProbability)
          ? roundTo(deadHeatProbability * 100, 2)
          : null;
        return accumulator;
      }, {});

      return {
        ...player,
        winProbability: Number.isFinite(shareProbability) ? roundTo(shareProbability, 6) : null,
        winProbabilityPct: Number.isFinite(shareProbability) ? roundTo(shareProbability * 100, 2) : null,
        winSoloProbability: Number.isFinite(winSoloProbability) ? roundTo(winSoloProbability, 6) : null,
        winSoloProbabilityPct: Number.isFinite(winSoloProbability) ? roundTo(winSoloProbability * 100, 2) : null,
        tieForLeadProbability: Number.isFinite(tieForLeadProbability) ? roundTo(tieForLeadProbability, 6) : null,
        tieForLeadProbabilityPct: Number.isFinite(tieForLeadProbability)
          ? roundTo(tieForLeadProbability * 100, 2)
          : null,
        winTieProbability: Number.isFinite(winTieProbability) ? roundTo(winTieProbability, 6) : null,
        fairValueYesProbability: Number.isFinite(fairValueYesProbability) ? roundTo(fairValueYesProbability, 6) : null,
        fairValueYesPct: Number.isFinite(fairValueYesProbability) ? roundTo(fairValueYesProbability * 100, 2) : null,
        fairValueYesCents: Number.isFinite(fairValueYesProbability) ? roundTo(fairValueYesProbability * 100, 2) : null,
        ...topFinishFields,
      };
    }),
    modelMeta: {
      method: 'monte-carlo-normal',
      tieHandling: tieResolutionMode === 'single_winner_sg_weighted' ? 'playoff-weighted-single-winner' : 'split',
      tieResolutionMode,
      playoffTemperature: tieResolutionMode === 'single_winner_sg_weighted' ? playoffTemperature : null,
      trials: canRunSimulation ? simulationTrials : 0,
      deterministic: !canRunSimulation,
    },
  };
}

function formatTeeTime(teeTimeMs, timezone) {
  if (!Number.isFinite(teeTimeMs)) return null;
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone || 'UTC',
    }).format(new Date(teeTimeMs));
  } catch (_error) {
    return null;
  }
}

function selectCourse(courses, courseId) {
  if (!Array.isArray(courses) || !courses.length) return null;
  const exact = courses.find((course) => String(course?.courseId) === String(courseId));
  if (exact) return exact;
  const host = courses.find((course) => course?.hostCourse);
  return host || courses[0];
}

function selectRoundHoleStats(roundHoleStats, currentRound) {
  if (!Array.isArray(roundHoleStats) || !roundHoleStats.length) return null;
  return (
    roundHoleStats.find((roundStats) => roundStats?.live) ||
    roundHoleStats.find((roundStats) => Number(roundStats?.roundNum) === currentRound) ||
    roundHoleStats.find((roundStats) => roundStats?.roundNum === null) ||
    roundHoleStats[0]
  );
}

function buildCourseContext({
  courseStatsData,
  tournamentData,
  courseId,
}) {
  const selectedCourse = selectCourse(courseStatsData?.courses, courseId);
  const currentRound = toIntegerOrNull(tournamentData?.currentRound);
  const selectedRoundStats = selectRoundHoleStats(selectedCourse?.roundHoleStats, currentRound);
  const selectedHoleStats = Array.isArray(selectedRoundStats?.holeStats) ? selectedRoundStats.holeStats : [];

  const holeStatsByHoleNumber = new Map();
  selectedHoleStats.forEach((hole) => {
    const holeNumber = toIntegerOrNull(hole?.courseHoleNum);
    if (!Number.isFinite(holeNumber)) return;
    holeStatsByHoleNumber.set(holeNumber, {
      difficultyRank: toIntegerOrNull(hole?.rank),
      scoringAverage: toNumberOrNull(hole?.scoringAverage),
      scoringAverageDiffDisplay: hole?.scoringAverageDiff || null,
      scoringAverageDiff: toNumberOrNull(hole?.scoringAverageDiff),
      scoringDiffTendency: hole?.scoringDiffTendency || null,
      eagles: toIntegerOrNull(hole?.eagles),
      birdies: toIntegerOrNull(hole?.birdies),
      pars: toIntegerOrNull(hole?.pars),
      bogeys: toIntegerOrNull(hole?.bogeys),
      doubleBogeys: toIntegerOrNull(hole?.doubleBogey),
      yards: toIntegerOrNull(hole?.yards),
      par: toIntegerOrNull(hole?.parValue),
    });
  });

  return {
    tournamentName: tournamentData?.tournamentName || null,
    currentRound,
    roundDisplay: tournamentData?.roundDisplay || null,
    roundStatusDisplay: tournamentData?.roundStatusDisplay || null,
    courseName: selectedCourse?.courseName || null,
    coursePar: toIntegerOrNull(selectedCourse?.par),
    courseYardageDisplay: selectedCourse?.yardage || null,
    courseYardage: toIntegerOrNull(selectedCourse?.yardage),
    holeStatsByHoleNumber,
  };
}

function buildBaseHoleStatsFromCourseContext(courseHoleStatsByHoleNumber) {
  const holeStats = [];
  for (let holeNumber = 1; holeNumber <= 18; holeNumber += 1) {
    const hole = courseHoleStatsByHoleNumber.get(holeNumber);
    if (!hole) continue;

    const par = Number(hole.par);
    const scoringAverage = Number(hole.scoringAverage);
    const scoringAverageDiff = Number(hole.scoringAverageDiff);
    const averageDiffFromPar = Number.isFinite(scoringAverageDiff)
      ? scoringAverageDiff
      : Number.isFinite(scoringAverage) && Number.isFinite(par)
        ? scoringAverage - par
        : null;
    if (!Number.isFinite(averageDiffFromPar)) {
      continue;
    }

    const averageScore = Number.isFinite(scoringAverage)
      ? roundTo(scoringAverage, 3)
      : Number.isFinite(par)
        ? roundTo(par + averageDiffFromPar, 3)
        : null;

    holeStats.push({
      holeNumber,
      par: Number.isFinite(par) ? par : null,
      yards: Number.isFinite(Number(hole.yards)) ? Number(hole.yards) : null,
      averageDiffFromPar,
      averageScore,
    });
  }

  return holeStats;
}

function enrichHoleStats(baseHoleStats, courseHoleStatsByHoleNumber) {
  return baseHoleStats.map((holeStats) => {
    const courseHoleStats = courseHoleStatsByHoleNumber.get(holeStats.holeNumber);
    return {
      ...holeStats,
      par: courseHoleStats?.par ?? holeStats.par,
      yards: courseHoleStats?.yards ?? holeStats.yards,
      scoringAverage: courseHoleStats?.scoringAverage ?? holeStats.averageScore,
      scoringAverageDiff: courseHoleStats?.scoringAverageDiff ?? holeStats.averageDiffFromPar,
      scoringAverageDiffDisplay:
        courseHoleStats?.scoringAverageDiffDisplay ||
        toDisplayScore(courseHoleStats?.scoringAverageDiff ?? holeStats.averageDiffFromPar),
      scoringDiffTendency: courseHoleStats?.scoringDiffTendency || null,
      difficultyRank: courseHoleStats?.difficultyRank ?? null,
      eagles: courseHoleStats?.eagles ?? null,
      birdies: courseHoleStats?.birdies ?? null,
      pars: courseHoleStats?.pars ?? null,
      bogeys: courseHoleStats?.bogeys ?? null,
      doubleBogeys: courseHoleStats?.doubleBogeys ?? null,
    };
  });
}

function countRemainingHolesByPar(remainingHoles, holeStatsByHoleNumber) {
  const counts = {
    3: 0,
    4: 0,
    5: 0,
  };

  remainingHoles.forEach((holeNumber) => {
    const par = Number(holeStatsByHoleNumber.get(holeNumber)?.par);
    if (par === 3 || par === 4 || par === 5) {
      counts[par] += 1;
    }
  });

  return counts;
}

function roundBreakdownMap(valuesByKey) {
  return Object.fromEntries(
    Object.entries(valuesByKey).map(([key, value]) => [key, roundTo(Number(value) || 0, 4)])
  );
}

function toSortedTokenKey(normalizedName) {
  return String(normalizedName || '')
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean)
    .sort()
    .join(' ');
}

function toInitialsSignature(tokenKey) {
  return String(tokenKey || '')
    .split(' ')
    .map((token) => token[0] || '')
    .join('');
}

function levenshteinDistance(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (!a) return b.length;
  if (!b) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array(b.length + 1).fill(0);

  for (let rowIndex = 1; rowIndex <= a.length; rowIndex += 1) {
    current[0] = rowIndex;
    for (let columnIndex = 1; columnIndex <= b.length; columnIndex += 1) {
      const substitutionCost = a[rowIndex - 1] === b[columnIndex - 1] ? 0 : 1;
      current[columnIndex] = Math.min(
        previous[columnIndex] + 1,
        current[columnIndex - 1] + 1,
        previous[columnIndex - 1] + substitutionCost
      );
    }
    for (let index = 0; index < previous.length; index += 1) {
      previous[index] = current[index];
    }
  }

  return previous[b.length];
}

function createSgNameMatcher(sgNameRows) {
  const rows = Array.isArray(sgNameRows) ? sgNameRows : [];
  const byNormalizedName = new Map();
  const byTokenKey = new Map();

  rows.forEach((row) => {
    const normalizedName = String(row?.normalizedName || '').trim();
    const tokenKey = String(row?.tokenKey || '').trim();
    if (normalizedName && !byNormalizedName.has(normalizedName)) {
      byNormalizedName.set(normalizedName, row);
    }
    if (tokenKey && !byTokenKey.has(tokenKey)) {
      byTokenKey.set(tokenKey, row);
    }
  });

  const cache = new Map();

  return ({ normalizedPlayerName, playerName }) => {
    const normalizedName = String(normalizedPlayerName || normalizePlayerName(playerName)).trim();
    if (!normalizedName) {
      return {
        found: false,
        matchedNormalizedName: null,
        matchType: null,
      };
    }

    if (cache.has(normalizedName)) {
      return cache.get(normalizedName);
    }

    if (byNormalizedName.has(normalizedName)) {
      const match = {
        found: true,
        matchedNormalizedName: normalizedName,
        matchType: 'exact',
      };
      cache.set(normalizedName, match);
      return match;
    }

    const tokenKey = toSortedTokenKey(normalizedName);
    if (byTokenKey.has(tokenKey)) {
      const tokenMatch = byTokenKey.get(tokenKey);
      const match = {
        found: true,
        matchedNormalizedName: tokenMatch.normalizedName,
        matchType: 'token',
      };
      cache.set(normalizedName, match);
      return match;
    }

    const initialsSignature = toInitialsSignature(tokenKey);
    const tokenCount = tokenKey ? tokenKey.split(' ').length : 0;
    const maxDistance = tokenKey.length >= 14 ? 2 : 1;
    let bestRow = null;
    let bestDistance = Infinity;

    rows.forEach((row) => {
      const candidateTokenKey = String(row?.tokenKey || '').trim();
      if (!candidateTokenKey) return;
      const candidateTokenCount = Number(row?.tokenCount) || candidateTokenKey.split(' ').length;
      if (Math.abs(candidateTokenCount - tokenCount) > 1) return;

      const candidateInitialsSignature =
        String(row?.initialsSignature || '').trim() || toInitialsSignature(candidateTokenKey);
      const initialsAreCompatible =
        !initialsSignature ||
        !candidateInitialsSignature ||
        candidateInitialsSignature === initialsSignature ||
        candidateInitialsSignature.includes(initialsSignature) ||
        initialsSignature.includes(candidateInitialsSignature);
      if (!initialsAreCompatible) {
        return;
      }

      const distance = levenshteinDistance(tokenKey, candidateTokenKey);
      if (distance > maxDistance) return;
      if (distance >= bestDistance) return;
      bestDistance = distance;
      bestRow = row;
    });

    if (bestRow?.normalizedName) {
      const match = {
        found: true,
        matchedNormalizedName: bestRow.normalizedName,
        matchType: 'fuzzy',
      };
      cache.set(normalizedName, match);
      return match;
    }

    const noMatch = {
      found: false,
      matchedNormalizedName: null,
      matchType: null,
    };
    cache.set(normalizedName, noMatch);
    return noMatch;
  };
}

function buildProjectedPlayers({
  players,
  holeStatsByHoleNumber,
  timezone,
  selectedStats,
  statSnapshot,
  statOverridesByPlayer = {},
  scoreOverridesByPlayer = {},
  projectionScope = 'round',
  currentRound,
  totalRounds,
}) {
  const selectedStatSet = new Set(selectedStats);
  const statMaps = statSnapshot?.byStatKey || {};
  const fieldMeans = statSnapshot?.fieldMeans || {};
  const selectedSgStatKeys = SG_STAT_KEYS.filter((statKey) => selectedStatSet.has(statKey));
  const hasSgSelection = selectedSgStatKeys.length > 0;
  const hasAnySgData = SG_STAT_KEYS.some((statKey) => {
    const entries = statMaps?.[statKey];
    return entries && Object.keys(entries).length > 0;
  });
  const resolveSgName = createSgNameMatcher(statSnapshot?.sgNameRows);

  return players
    .map((row) => {
      const playerName = row?.player?.displayName || 'Unknown Player';
      const normalizedPlayerName = normalizePlayerName(playerName);
      const playerStatOverrides = statOverridesByPlayer[normalizedPlayerName] || {};
      const playerScoreOverrides = scoreOverridesByPlayer[normalizedPlayerName] || {};
      const sgNameMatch = hasSgSelection || hasAnySgData
        ? resolveSgName({
            normalizedPlayerName,
            playerName,
          })
        : {
            found: false,
            matchedNormalizedName: null,
            matchType: null,
          };
      const sgLookupName = sgNameMatch?.matchedNormalizedName || normalizedPlayerName;
      const scoringData = row?.scoringData || {};
      const scoreRawFromFeed = scoringData.total ?? '-';
      const scoreNumberFromFeed = toScoreNumber(scoreRawFromFeed);
      const overrideScoreNumber = toNumberOrNull(playerScoreOverrides.totalScoreNumber);
      const scoreNumber = Number.isFinite(overrideScoreNumber) ? overrideScoreNumber : scoreNumberFromFeed;
      const scoreRaw = Number.isFinite(overrideScoreNumber) ? toDisplayScore(scoreNumber) : scoreRawFromFeed;

      const roundScoreRawFromFeed = scoringData.score ?? '-';
      const roundScoreNumberFromFeed = toScoreNumber(roundScoreRawFromFeed);
      const overrideRoundScoreNumber = toNumberOrNull(playerScoreOverrides.roundScoreNumber);
      const roundScoreNumber = Number.isFinite(overrideRoundScoreNumber)
        ? overrideRoundScoreNumber
        : roundScoreNumberFromFeed;
      const roundScoreRaw = Number.isFinite(overrideRoundScoreNumber)
        ? toDisplayScore(roundScoreNumber)
        : roundScoreRawFromFeed;

      const thruRawFromFeed = scoringData.thru ?? '-';
      const completedHolesFromFeed = parseCompletedHoles(thruRawFromFeed, scoringData.thruSort);
      const overrideCompletedHoles = parseCompletedHolesOverride(playerScoreOverrides.completedHoles);
      const completedHoles = overrideCompletedHoles !== null ? overrideCompletedHoles : completedHolesFromFeed;
      const thruRaw = overrideCompletedHoles !== null
        ? overrideCompletedHoles >= 18
          ? 'F'
          : String(overrideCompletedHoles)
        : thruRawFromFeed;
      const startedOnBackNine = Boolean(scoringData.backNine) || String(thruRaw).includes('*');
      const teeOrder = buildTeeOrder(startedOnBackNine);
      const playerState = scoringData.playerState || '';
      const normalizedPlayerState = String(playerState).trim().toUpperCase();
      const teeTimeMs = Number(scoringData.teeTime);
      const teeTimeDisplay = formatTeeTime(teeTimeMs, timezone);
      const hasFeedTotalScore = Number.isFinite(scoreNumberFromFeed);
      const hasFeedRoundScore = Number.isFinite(roundScoreNumberFromFeed);
      const hasFeedScoring = hasFeedTotalScore || hasFeedRoundScore;
      const hasStartedHolesFromFeed = Number.isFinite(completedHolesFromFeed) && completedHolesFromFeed > 0;
      const inferredNotStartedFromFeed =
        !hasFeedScoring &&
        !hasStartedHolesFromFeed &&
        Number.isFinite(teeTimeMs);
      const isNotStarted = normalizedPlayerState === 'NOT_STARTED' || inferredNotStartedFromFeed;
      const completedHolesForProjection =
        completedHoles === null && isNotStarted ? 0 : completedHoles;
      const remainingHolePlan = buildRemainingHolePlan({
        completedHoles: completedHolesForProjection,
        startedOnBackNine,
        projectionScope,
        currentRound,
        totalRounds,
      });
      const remainingHoles = remainingHolePlan.allRemaining.map((hole) => hole.holeNumber);
      const holesRemainingCurrentRound = remainingHolePlan.currentRoundRemaining.length;
      const holesRemainingFutureRounds = remainingHolePlan.futureRoundRemaining.length;
      const roundsRemainingAfterCurrent = Math.max(
        0,
        Number.isFinite(Number(totalRounds)) && Number.isFinite(Number(currentRound))
          ? Math.max(0, Math.floor(totalRounds) - Math.floor(currentRound))
          : 0
      );
      const currentHole =
        completedHoles === null
          ? '-'
          : completedHoles >= 18
            ? 'F'
            : String(teeOrder[completedHoles]);

      const baselineRemaining = selectedStatSet.has('course_hole_model')
        ? remainingHoles.reduce((accumulator, holeNumber) => {
            const holeStats = holeStatsByHoleNumber.get(holeNumber);
            if (!holeStats) return accumulator;
            return accumulator + holeStats.averageDiffFromPar;
          }, 0)
        : 0;

      const holesRemaining = remainingHoles.length;
      const remainingParCounts = countRemainingHolesByPar(remainingHoles, holeStatsByHoleNumber);
      const parDeltasByType = {
        3: 0,
        4: 0,
        5: 0,
      };
      const parAdjustments = {
        par3_scoring_avg: 0,
        par4_scoring_avg: 0,
        par5_scoring_avg: 0,
      };
      const playerStatInputs = {};
      const resolvePlayerStatInput = (statKey, lookupName) => {
        const overrideValue = toNumberOrNull(playerStatOverrides?.[statKey]);
        const playerValue = Number(statMaps?.[statKey]?.[lookupName]);
        const fieldMean = Number(fieldMeans?.[statKey]);
        const safePlayerValue = Number.isFinite(overrideValue)
          ? overrideValue
          : Number.isFinite(playerValue)
            ? playerValue
            : Number.isFinite(fieldMean)
              ? fieldMean
              : 0;
        const safeFieldMean = Number.isFinite(fieldMean) ? fieldMean : 0;
        const statValueSource = Number.isFinite(overrideValue)
          ? 'manual_override'
          : Number.isFinite(playerValue)
            ? 'stat_feed'
            : Number.isFinite(fieldMean)
              ? 'field_mean_fallback'
              : 'zero_fallback';
        playerStatInputs[statKey] = {
          value: roundTo(safePlayerValue, 4),
          source: statValueSource,
          fieldMean: roundTo(safeFieldMean, 4),
        };
        return {
          safePlayerValue,
          safeFieldMean,
          source: statValueSource,
        };
      };
      const parToStatKeyMap = {
        3: 'par3_scoring_avg',
        4: 'par4_scoring_avg',
        5: 'par5_scoring_avg',
      };
      const parInputByStatKey = {
        par3_scoring_avg: resolvePlayerStatInput('par3_scoring_avg', normalizedPlayerName),
        par4_scoring_avg: resolvePlayerStatInput('par4_scoring_avg', normalizedPlayerName),
        par5_scoring_avg: resolvePlayerStatInput('par5_scoring_avg', normalizedPlayerName),
      };
      [3, 4, 5].forEach((parType) => {
        const statKey = parToStatKeyMap[parType];
        if (!selectedStatSet.has(statKey)) return;
        const { safePlayerValue, safeFieldMean } = parInputByStatKey[statKey];
        parDeltasByType[parType] = safePlayerValue - safeFieldMean;
        parAdjustments[statKey] = parDeltasByType[parType] * remainingParCounts[parType];
      });

      const sgPerHoleDeltas = {
        sg_total: 0,
        sg_t2g: 0,
        sg_ott: 0,
        sg_app: 0,
        sg_arg: 0,
        sg_putt: 0,
      };
      const playoffSgEdgeValues = [];
      const sgAdjustments = {
        sg_total: 0,
        sg_t2g: 0,
        sg_ott: 0,
        sg_app: 0,
        sg_arg: 0,
        sg_putt: 0,
      };
      Object.keys(sgAdjustments).forEach((statKey) => {
        const { safePlayerValue, safeFieldMean } = resolvePlayerStatInput(statKey, sgLookupName);
        const sgEdgeVsField = safePlayerValue - safeFieldMean;
        if (Number.isFinite(sgEdgeVsField)) {
          playoffSgEdgeValues.push(sgEdgeVsField);
        }
        if (!selectedStatSet.has(statKey)) return;
        // Positive SG means a player gains strokes and should project to fewer strokes remaining.
        const perHoleDelta = (safeFieldMean - safePlayerValue) / 18;
        sgPerHoleDeltas[statKey] = perHoleDelta;
        sgAdjustments[statKey] = perHoleDelta * holesRemaining;
      });
      const playoffSgRating = playoffSgEdgeValues.length
        ? playoffSgEdgeValues.reduce((sum, value) => sum + value, 0) / playoffSgEdgeValues.length
        : 0;

      const holeBreakdown = remainingHolePlan.allRemaining.map((remainingHole) => {
        const holeStats = holeStatsByHoleNumber.get(remainingHole.holeNumber);
        const par = Number(holeStats?.par);
        const base = selectedStatSet.has('course_hole_model') ? Number(holeStats?.averageDiffFromPar) || 0 : 0;
        const parAdjustment = parDeltasByType[par] || 0;
        const sgAdjustment = Object.entries(sgPerHoleDeltas).reduce((accumulator, [statKey, value]) => {
          if (!selectedStatSet.has(statKey)) return accumulator;
          return accumulator + value;
        }, 0);
        const total = base + parAdjustment + sgAdjustment;
        return {
          roundNumber: remainingHole.roundNumber,
          holeNumber: remainingHole.holeNumber,
          par: Number.isFinite(par) ? par : null,
          base: roundTo(base, 4),
          parAdjustment: roundTo(parAdjustment, 4),
          sgAdjustment: roundTo(sgAdjustment, 4),
          total: roundTo(total, 4),
        };
      });

      const totalParAdjustment = Object.values(parAdjustments).reduce((accumulator, value) => accumulator + value, 0);
      const totalSgAdjustment = Object.values(sgAdjustments).reduce((accumulator, value) => accumulator + value, 0);
      const totalAdjustment = baselineRemaining + totalParAdjustment + totalSgAdjustment;
      const scoreNumberForProjection = scoreNumber === null && isNotStarted ? 0 : scoreNumber;

      const expectedFinalScoreNumber =
        scoreNumberForProjection === null ? null : roundTo(scoreNumberForProjection + totalAdjustment, 2);
      const missingSgData = hasSgSelection ? !sgNameMatch?.found : false;
      const playerScoreInputs = {
        totalScoreNumber: {
          value: Number.isFinite(scoreNumber) ? roundTo(scoreNumber, 2) : null,
          source: Number.isFinite(overrideScoreNumber)
            ? 'manual_override'
            : Number.isFinite(scoreNumberFromFeed)
              ? 'stat_feed'
              : 'missing',
        },
        roundScoreNumber: {
          value: Number.isFinite(roundScoreNumber) ? roundTo(roundScoreNumber, 2) : null,
          source: Number.isFinite(overrideRoundScoreNumber)
            ? 'manual_override'
            : Number.isFinite(roundScoreNumberFromFeed)
              ? 'stat_feed'
              : 'missing',
        },
        completedHoles: {
          value: Number.isFinite(completedHoles) ? completedHoles : null,
          source: overrideCompletedHoles !== null
            ? 'manual_override'
            : Number.isFinite(completedHolesFromFeed)
              ? 'stat_feed'
              : 'missing',
        },
      };

      return {
        playerName,
        normalizedPlayerName,
        scoreRaw,
        scoreNumber,
        roundScoreRaw,
        roundScoreNumber,
        thruRaw,
        startedOnBackNine,
        playerState,
        currentHole,
        holesRemaining,
        holesRemainingCurrentRound,
        holesRemainingFutureRounds,
        roundsRemainingAfterCurrent,
        remainingHoles,
        remainingParCounts,
        teeTimeMs: Number.isFinite(teeTimeMs) ? teeTimeMs : null,
        teeTimeDisplay,
        currentScoreDisplay: teeTimeDisplay && !Number.isFinite(scoreNumber) ? teeTimeDisplay : scoreRaw,
        missingSgData,
        sgNameMatchType: sgNameMatch?.matchType || null,
        playoffSgRating: roundTo(playoffSgRating, 6),
        playerStatInputs,
        playerScoreInputs,
        projectionScope,
        expectedFinalScoreNumber,
        expectedFinalScoreDisplay: toDisplayScore(expectedFinalScoreNumber),
        projectionBreakdown: {
          baselineRemaining: roundTo(baselineRemaining, 4),
          parAdjustments: roundBreakdownMap(parAdjustments),
          sgAdjustments: roundBreakdownMap(sgAdjustments),
          parDeltasByType: roundBreakdownMap({
            par3: parDeltasByType[3],
            par4: parDeltasByType[4],
            par5: parDeltasByType[5],
          }),
          sgPerHoleDeltas: roundBreakdownMap(sgPerHoleDeltas),
          totalAdjustment: roundTo(totalAdjustment, 4),
          selectedStats,
          holeBreakdown,
        },
      };
    })
    .sort((a, b) => {
      if (a.expectedFinalScoreNumber === null && b.expectedFinalScoreNumber === null) return 0;
      if (a.expectedFinalScoreNumber === null) return 1;
      if (b.expectedFinalScoreNumber === null) return -1;
      return a.expectedFinalScoreNumber - b.expectedFinalScoreNumber;
    });
}

async function fetchHoleStats({
  graphqlHostname,
  graphqlKey,
  tournamentId,
  courseId,
}) {
  const holeStats = [];

  for (let hole = 1; hole <= 18; hole += 1) {
    const response = await fetch(graphqlHostname, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': graphqlKey,
      },
      body: JSON.stringify({
        query: HOLE_DETAILS_QUERY,
        variables: {
          courseId,
          hole,
          tournamentId,
        },
      }),
    });

    if (!response.ok) {
      throw createHttpError(502, `Failed to fetch hole details (${response.status}).`);
    }

    const json = await response.json();
    if (json.errors?.length) {
      throw createHttpError(502, `Hole details query failed: ${json.errors[0]?.message || 'Unknown error'}`);
    }

    const holeInfo = json?.data?.holeDetails?.holeInfo;
    if (!holeInfo) {
      continue;
    }

    const par = Number(holeInfo.par);
    const yards = Number(holeInfo.yards);
    const scoringAverageDiff = Number(holeInfo.scoringAverageDiff);
    if (!Number.isFinite(par) || !Number.isFinite(scoringAverageDiff)) {
      continue;
    }

    const averageScore = roundTo(par + scoringAverageDiff, 3);
    holeStats.push({
      holeNumber: Number(holeInfo.holeNum),
      par,
      yards: Number.isFinite(yards) ? yards : null,
      averageDiffFromPar: scoringAverageDiff,
      averageScore,
    });
  }

  return holeStats.sort((a, b) => a.holeNumber - b.holeNumber);
}

async function buildRoundLeaderProjection({
  baseUrl,
  leaderboardUrl,
  tourcastUrl,
  courseStatsUrl,
  selectedStats: selectedStatsInput = DEFAULT_SELECTED_STATS,
  statOverrides: statOverridesInput,
  scoreOverrides: scoreOverridesInput,
  uploadedSgCsv,
}) {
  const selectedStats = normalizeStatSelection(selectedStatsInput);
  const statOverridesByPlayer = normalizeStatOverrides(statOverridesInput);
  const scoreOverridesByPlayer = normalizeScoreOverrides(scoreOverridesInput);
  const resolvedUrls = resolveSourceUrls({
    baseUrl,
    leaderboardUrl,
    tourcastUrl,
    courseStatsUrl,
  });

  const leaderboardHtml = await fetchText(resolvedUrls.leaderboardUrl);
  const leaderboardNextData = parseNextDataFromHtml(leaderboardHtml, 'leaderboard');
  const leaderboardData = getLeaderboardData(leaderboardNextData);

  const tournamentId = leaderboardData.tournamentId;
  const courseId = leaderboardData.players.find((row) => row?.scoringData?.courseId)?.scoringData?.courseId;

  if (!tournamentId || !courseId) {
    throw createHttpError(502, 'Missing tournamentId/courseId in leaderboard payload.');
  }

  const courseStatsHtml = await fetchText(resolvedUrls.courseStatsUrl);
  const courseStatsNextData = parseNextDataFromHtml(courseStatsHtml, 'course-stats');
  const courseStatsData = getCourseStatsData(courseStatsNextData);
  const tournamentData = getTournamentData(courseStatsNextData, tournamentId);
  const courseContext = buildCourseContext({
    courseStatsData,
    tournamentData,
    courseId,
  });

  const tourcastCandidates = [
    resolvedUrls.tourcastUrl,
    leaderboardData.tourcastURLWeb,
    leaderboardData.tourcastURL,
  ].filter(Boolean);

  let graphqlConfig = null;
  for (const candidateUrl of tourcastCandidates) {
    let parsedUrl;
    try {
      parsedUrl = new URL(candidateUrl);
    } catch (_error) {
      continue;
    }

    if (!parsedUrl.hostname.includes('pgatour.com')) {
      continue;
    }

    try {
      const html = await fetchText(parsedUrl.toString());
      graphqlConfig = parseGraphqlConfigFromTourcastHtml(html);
      break;
    } catch (_error) {
      // Keep trying fallbacks from leaderboard payload.
    }
  }

  let baseHoleStats = [];
  if (graphqlConfig) {
    try {
      const { graphqlHostname, graphqlKey } = graphqlConfig;
      baseHoleStats = await fetchHoleStats({
        graphqlHostname,
        graphqlKey,
        tournamentId,
        courseId,
      });
    } catch (_error) {
      // Fall back to course-stats hole data if Tourcast GraphQL shape/auth changes.
      baseHoleStats = [];
    }
  }
  if (!baseHoleStats.length) {
    baseHoleStats = buildBaseHoleStatsFromCourseContext(courseContext.holeStatsByHoleNumber);
  }
  if (!baseHoleStats.length) {
    throw createHttpError(502, 'Failed to build hole stats from Tourcast and course-stats sources.');
  }

  const holeStatsByHoleNumber = new Map(baseHoleStats.map((hole) => [hole.holeNumber, hole]));
  const holeStats = enrichHoleStats(baseHoleStats, courseContext.holeStatsByHoleNumber);
  const sgDataVersionKey = await getRoundLeaderProjectionSgDataVersionKey(uploadedSgCsv);
  const statSnapshotResult = await getOrCreateRoundLeaderProjectionStatSnapshot({
    tournamentId,
    currentRound: courseContext.currentRound,
    selectedStats: ALL_PLAYER_PROJECTION_STAT_KEYS,
    cacheVersionKey: sgDataVersionKey,
    scrapeSnapshot: async () =>
      scrapeRoundLeaderProjectionStats(ALL_PLAYER_PROJECTION_STAT_KEYS, { uploadedSgCsv }),
  });
  const totalRounds = deriveTotalRounds(leaderboardData.rounds);
  const normalizedCurrentRound = normalizeCurrentRound(courseContext.currentRound, totalRounds);
  const roundsRemainingAfterCurrent = Math.max(0, totalRounds - normalizedCurrentRound);
  const holeStdDevByNumber = buildHoleStdDevByNumber(holeStats);

  const roundPlayers = buildProjectedPlayers({
    players: leaderboardData.players,
    holeStatsByHoleNumber,
    timezone: leaderboardData.timezone,
    selectedStats,
    statSnapshot: statSnapshotResult.snapshot,
    statOverridesByPlayer,
    scoreOverridesByPlayer,
    projectionScope: 'round',
    currentRound: normalizedCurrentRound,
    totalRounds,
  });
  const roundScopeResult = attachWinProbabilities({
    players: roundPlayers,
    holeStdDevByNumber,
    tieResolutionMode: 'tie_split',
    seedInput: [
      tournamentId,
      normalizedCurrentRound,
      'round',
      totalRounds,
      roundsRemainingAfterCurrent,
      leaderboardData.tournamentStatus,
      leaderboardData.rounds?.length,
      leaderboardData.players?.length,
      leaderboardData.players?.[0]?.scoringData?.total,
      leaderboardData.players?.[0]?.scoringData?.thru,
      [...selectedStats].sort().join('|'),
      leaderboardData.timezone,
      roundPlayers.length,
    ].join('::'),
  });
  const tournamentPlayers = buildProjectedPlayers({
    players: leaderboardData.players,
    holeStatsByHoleNumber,
    timezone: leaderboardData.timezone,
    selectedStats,
    statSnapshot: statSnapshotResult.snapshot,
    statOverridesByPlayer,
    scoreOverridesByPlayer,
    projectionScope: 'tournament',
    currentRound: normalizedCurrentRound,
    totalRounds,
  });
  const tournamentScopeResult = attachWinProbabilities({
    players: tournamentPlayers,
    holeStdDevByNumber,
    tieResolutionMode: 'single_winner_sg_weighted',
    seedInput: [
      tournamentId,
      normalizedCurrentRound,
      'tournament',
      totalRounds,
      roundsRemainingAfterCurrent,
      leaderboardData.tournamentStatus,
      leaderboardData.rounds?.length,
      leaderboardData.players?.length,
      leaderboardData.players?.[0]?.scoringData?.total,
      leaderboardData.players?.[0]?.scoringData?.thru,
      [...selectedStats].sort().join('|'),
      leaderboardData.timezone,
      tournamentPlayers.length,
    ].join('::'),
  });
  const projectionScopes = {
    round: {
      key: 'round',
      label: 'Round Leader',
      description: 'Projects outcomes for the current round only.',
      players: roundScopeResult.players,
      winProbabilityModel: roundScopeResult.modelMeta,
    },
    tournament: {
      key: 'tournament',
      label: 'Tournament',
      description: 'Projects outcomes through the end of the tournament.',
      players: tournamentScopeResult.players,
      winProbabilityModel: tournamentScopeResult.modelMeta,
    },
  };

  return {
    tournamentId,
    tournamentName: courseContext.tournamentName,
    tournamentStatus: tournamentData?.tournamentStatus || leaderboardData.tournamentStatus || null,
    displayDate: tournamentData?.displayDate || null,
    roundDisplay: courseContext.roundDisplay,
    roundStatusDisplay: courseContext.roundStatusDisplay,
    currentRound: normalizedCurrentRound,
    totalRounds,
    roundsRemainingAfterCurrent,
    courseId,
    courseName: courseContext.courseName,
    coursePar: courseContext.coursePar,
    courseYardageDisplay: courseContext.courseYardageDisplay,
    courseYardage: courseContext.courseYardage,
    timezone: leaderboardData.timezone || null,
    playerCount: roundScopeResult.players.length,
    fetchedAt: new Date().toISOString(),
    sourceBaseUrl: resolvedUrls.normalizedBaseUrl,
    selectedStats,
    statDataSource: statSnapshotResult.source,
    statDataFetchedAt: statSnapshotResult.fetchedAt || statSnapshotResult.snapshot?.fetchedAt || null,
    statSources: statSnapshotResult.snapshot?.sourceStats || [],
    sgDataFile: statSnapshotResult.snapshot?.sgDataFile || null,
    statOverridePlayerCount: Object.keys(statOverridesByPlayer).length,
    scoreOverridePlayerCount: Object.keys(scoreOverridesByPlayer).length,
    winProbabilityModel: roundScopeResult.modelMeta,
    tournamentWinProbabilityModel: tournamentScopeResult.modelMeta,
    projectionScopes,
    defaultProjectionScope: 'round',
    tournamentProgress: {
      currentRound: normalizedCurrentRound,
      totalRounds,
      roundsRemainingAfterCurrent,
      tournamentStatus: tournamentData?.tournamentStatus || leaderboardData.tournamentStatus || null,
      roundDisplay: courseContext.roundDisplay || (Number.isFinite(normalizedCurrentRound) ? `R${normalizedCurrentRound}` : null),
      roundStatusDisplay: courseContext.roundStatusDisplay || null,
      displayDate: tournamentData?.displayDate || null,
    },
    holeStats,
    // Keep legacy field for backward compatibility (round scope).
    players: roundScopeResult.players,
    tournamentPlayers: tournamentScopeResult.players,
  };
}

module.exports = {
  buildRoundLeaderProjection,
};
