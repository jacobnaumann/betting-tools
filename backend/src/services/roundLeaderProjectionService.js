const NEXT_DATA_REGEX = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/;
const GRAPHQL_CONFIG_REGEX =
  /"graphqlHostname":"([^"]+)","graphqlKey":"([^"]+)","graphqlWebSocket":"[^"]*"/;
const PGA_URL_SUFFIXES = new Set(['leaderboard', 'tourcast', 'course-stats']);
const {
  DEFAULT_SELECTED_STATS,
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
  if (scoreRaw === '-') return null;
  if (scoreRaw === 'E') return 0;
  const parsed = Number(scoreRaw);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDisplayScore(scoreNumber) {
  if (scoreNumber === null) return '-';
  if (scoreNumber > 0) return `+${scoreNumber}`;
  if (scoreNumber === 0) return 'E';
  return String(scoreNumber);
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

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
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

function buildProjectedPlayers({
  players,
  holeStatsByHoleNumber,
  timezone,
  selectedStats,
  statSnapshot,
}) {
  const selectedStatSet = new Set(selectedStats);
  const statMaps = statSnapshot?.byStatKey || {};
  const fieldMeans = statSnapshot?.fieldMeans || {};

  return players
    .map((row) => {
      const playerName = row?.player?.displayName || 'Unknown Player';
      const normalizedPlayerName = normalizePlayerName(playerName);
      const scoringData = row?.scoringData || {};
      const scoreRaw = scoringData.total ?? '-';
      const scoreNumber = toScoreNumber(scoreRaw);
      const roundScoreRaw = scoringData.score ?? '-';
      const roundScoreNumber = toScoreNumber(roundScoreRaw);
      const thruRaw = scoringData.thru ?? '-';
      const startedOnBackNine = Boolean(scoringData.backNine) || String(thruRaw).includes('*');
      const teeOrder = buildTeeOrder(startedOnBackNine);
      const completedHoles = parseCompletedHoles(thruRaw, scoringData.thruSort);
      const playerState = scoringData.playerState || '';
      const teeTimeMs = Number(scoringData.teeTime);
      const teeTimeDisplay = formatTeeTime(teeTimeMs, timezone);
      const isNotStarted = playerState === 'NOT_STARTED';

      const remainingHoles =
        completedHoles === null ? [] : teeOrder.slice(Math.min(completedHoles, teeOrder.length));
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
      const parToStatKeyMap = {
        3: 'par3_scoring_avg',
        4: 'par4_scoring_avg',
        5: 'par5_scoring_avg',
      };
      [3, 4, 5].forEach((parType) => {
        const statKey = parToStatKeyMap[parType];
        if (!selectedStatSet.has(statKey)) return;
        const playerValue = Number(statMaps?.[statKey]?.[normalizedPlayerName]);
        const fieldMean = Number(fieldMeans?.[statKey]);
        const safePlayerValue = Number.isFinite(playerValue) ? playerValue : Number.isFinite(fieldMean) ? fieldMean : 0;
        const safeFieldMean = Number.isFinite(fieldMean) ? fieldMean : 0;
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
      const sgAdjustments = {
        sg_total: 0,
        sg_t2g: 0,
        sg_ott: 0,
        sg_app: 0,
        sg_arg: 0,
        sg_putt: 0,
      };
      Object.keys(sgAdjustments).forEach((statKey) => {
        if (!selectedStatSet.has(statKey)) return;
        const playerValue = Number(statMaps?.[statKey]?.[normalizedPlayerName]);
        const fieldMean = Number(fieldMeans?.[statKey]);
        const safePlayerValue = Number.isFinite(playerValue) ? playerValue : Number.isFinite(fieldMean) ? fieldMean : 0;
        const safeFieldMean = Number.isFinite(fieldMean) ? fieldMean : 0;
        const perHoleDelta = (safePlayerValue - safeFieldMean) / 18;
        sgPerHoleDeltas[statKey] = perHoleDelta;
        sgAdjustments[statKey] = perHoleDelta * holesRemaining;
      });

      const holeBreakdown = remainingHoles.map((holeNumber) => {
        const holeStats = holeStatsByHoleNumber.get(holeNumber);
        const par = Number(holeStats?.par);
        const base = selectedStatSet.has('course_hole_model') ? Number(holeStats?.averageDiffFromPar) || 0 : 0;
        const parAdjustment = parDeltasByType[par] || 0;
        const sgAdjustment = Object.entries(sgPerHoleDeltas).reduce((accumulator, [statKey, value]) => {
          if (!selectedStatSet.has(statKey)) return accumulator;
          return accumulator + value;
        }, 0);
        const total = base + parAdjustment + sgAdjustment;
        return {
          holeNumber,
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

      const expectedFinalScoreNumber =
        scoreNumber === null ? null : roundTo(scoreNumber + totalAdjustment, 2);

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
        remainingHoles,
        remainingParCounts,
        teeTimeMs: Number.isFinite(teeTimeMs) ? teeTimeMs : null,
        teeTimeDisplay,
        currentScoreDisplay: isNotStarted && teeTimeDisplay ? teeTimeDisplay : scoreRaw,
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
}) {
  const selectedStats = normalizeStatSelection(selectedStatsInput);
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

  if (!graphqlConfig) {
    throw createHttpError(502, 'Failed to resolve Tourcast GraphQL endpoint from provided URLs.');
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

  const { graphqlHostname, graphqlKey } = graphqlConfig;
  const baseHoleStats = await fetchHoleStats({
    graphqlHostname,
    graphqlKey,
    tournamentId,
    courseId,
  });

  const holeStatsByHoleNumber = new Map(baseHoleStats.map((hole) => [hole.holeNumber, hole]));
  const holeStats = enrichHoleStats(baseHoleStats, courseContext.holeStatsByHoleNumber);
  const statSnapshotResult = await getOrCreateRoundLeaderProjectionStatSnapshot({
    tournamentId,
    currentRound: courseContext.currentRound,
    selectedStats,
    scrapeSnapshot: async () => scrapeRoundLeaderProjectionStats(selectedStats),
  });
  const players = buildProjectedPlayers({
    players: leaderboardData.players,
    holeStatsByHoleNumber,
    timezone: leaderboardData.timezone,
    selectedStats,
    statSnapshot: statSnapshotResult.snapshot,
  });

  return {
    tournamentId,
    tournamentName: courseContext.tournamentName,
    roundDisplay: courseContext.roundDisplay,
    roundStatusDisplay: courseContext.roundStatusDisplay,
    courseId,
    courseName: courseContext.courseName,
    coursePar: courseContext.coursePar,
    courseYardageDisplay: courseContext.courseYardageDisplay,
    courseYardage: courseContext.courseYardage,
    timezone: leaderboardData.timezone || null,
    playerCount: players.length,
    fetchedAt: new Date().toISOString(),
    sourceBaseUrl: resolvedUrls.normalizedBaseUrl,
    selectedStats,
    statDataSource: statSnapshotResult.source,
    statDataFetchedAt: statSnapshotResult.fetchedAt || statSnapshotResult.snapshot?.fetchedAt || null,
    statSources: statSnapshotResult.snapshot?.sourceStats || [],
    holeStats,
    players,
  };
}

module.exports = {
  buildRoundLeaderProjection,
};
