const NEXT_DATA_REGEX = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/;
const GRAPHQL_CONFIG_REGEX =
  /"graphqlHostname":"([^"]+)","graphqlKey":"([^"]+)","graphqlWebSocket":"[^"]*"/;

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

function toScoreNumber(scoreRaw) {
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

function buildProjectedPlayers(players, holeStatsByHoleNumber, timezone) {
  return players
    .map((row) => {
      const playerName = row?.player?.displayName || 'Unknown Player';
      const scoringData = row?.scoringData || {};
      const scoreRaw = scoringData.total ?? '-';
      const scoreNumber = toScoreNumber(scoreRaw);
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

      const remainingScoreDelta = remainingHoles.reduce((accumulator, holeNumber) => {
        const holeStats = holeStatsByHoleNumber.get(holeNumber);
        if (!holeStats) return accumulator;
        return accumulator + holeStats.averageDiffFromPar;
      }, 0);

      const expectedFinalScoreNumber =
        scoreNumber === null ? null : roundTo(scoreNumber + remainingScoreDelta, 2);

      return {
        playerName,
        scoreRaw,
        scoreNumber,
        thruRaw,
        startedOnBackNine,
        playerState,
        currentHole,
        holesRemaining: remainingHoles.length,
        remainingHoles,
        teeTimeMs: Number.isFinite(teeTimeMs) ? teeTimeMs : null,
        teeTimeDisplay,
        currentScoreDisplay: isNotStarted && teeTimeDisplay ? teeTimeDisplay : scoreRaw,
        expectedFinalScoreNumber,
        expectedFinalScoreDisplay: toDisplayScore(expectedFinalScoreNumber),
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
  leaderboardUrl,
  tourcastUrl,
}) {
  const leaderboardHtml = await fetchText(leaderboardUrl);
  const leaderboardNextData = parseNextDataFromHtml(leaderboardHtml, 'leaderboard');
  const leaderboardData = getLeaderboardData(leaderboardNextData);

  const tournamentId = leaderboardData.tournamentId;
  const courseId = leaderboardData.players.find((row) => row?.scoringData?.courseId)?.scoringData?.courseId;

  if (!tournamentId || !courseId) {
    throw createHttpError(502, 'Missing tournamentId/courseId in leaderboard payload.');
  }

  const tourcastCandidates = [
    tourcastUrl,
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

  const { graphqlHostname, graphqlKey } = graphqlConfig;
  const holeStats = await fetchHoleStats({
    graphqlHostname,
    graphqlKey,
    tournamentId,
    courseId,
  });

  const holeStatsByHoleNumber = new Map(holeStats.map((hole) => [hole.holeNumber, hole]));
  const players = buildProjectedPlayers(leaderboardData.players, holeStatsByHoleNumber, leaderboardData.timezone);

  return {
    tournamentId,
    courseId,
    timezone: leaderboardData.timezone || null,
    playerCount: players.length,
    fetchedAt: new Date().toISOString(),
    holeStats,
    players,
  };
}

module.exports = {
  buildRoundLeaderProjection,
};
