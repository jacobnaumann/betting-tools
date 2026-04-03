const NEXT_DATA_REGEX = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/;

const STAT_KEY_CONFIG = {
  par3_scoring_avg: {
    key: 'par3_scoring_avg',
    label: 'Par 3 Scoring Average',
    statId: '142',
    url: 'https://www.pgatour.com/stats/detail/142',
    group: 'par',
  },
  par4_scoring_avg: {
    key: 'par4_scoring_avg',
    label: 'Par 4 Scoring Average',
    statId: '143',
    url: 'https://www.pgatour.com/stats/detail/143',
    group: 'par',
  },
  par5_scoring_avg: {
    key: 'par5_scoring_avg',
    label: 'Par 5 Scoring Average',
    statId: '144',
    url: 'https://www.pgatour.com/stats/detail/144',
    group: 'par',
  },
  sg_total: {
    key: 'sg_total',
    label: 'SG: Total',
    statId: '02675',
    url: 'https://www.pgatour.com/stats/detail/02675',
    group: 'sg',
  },
  sg_t2g: {
    key: 'sg_t2g',
    label: 'SG: Tee-to-Green',
    statId: '02674',
    url: 'https://www.pgatour.com/stats/detail/02674',
    group: 'sg',
  },
  sg_ott: {
    key: 'sg_ott',
    label: 'SG: Off-the-Tee',
    statId: '02567',
    url: 'https://www.pgatour.com/stats/detail/02567',
    group: 'sg',
  },
  sg_app: {
    key: 'sg_app',
    label: 'SG: Approach',
    statId: '02568',
    url: 'https://www.pgatour.com/stats/detail/02568',
    group: 'sg',
  },
  sg_arg: {
    key: 'sg_arg',
    label: 'SG: Around-the-Green',
    statId: '02569',
    url: 'https://www.pgatour.com/stats/detail/02569',
    group: 'sg',
  },
  sg_putt: {
    key: 'sg_putt',
    label: 'SG: Putting',
    statId: '02564',
    url: 'https://www.pgatour.com/stats/detail/02564',
    group: 'sg',
  },
};

const DEFAULT_SELECTED_STATS = ['course_hole_model', 'par3_scoring_avg', 'par4_scoring_avg', 'par5_scoring_avg'];
const SG_STAT_KEYS = ['sg_total', 'sg_t2g', 'sg_ott', 'sg_app', 'sg_arg', 'sg_putt'];

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizePlayerName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/\./g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeStatSelection(selectedStatsInput) {
  const selectedStats = Array.isArray(selectedStatsInput) ? selectedStatsInput : DEFAULT_SELECTED_STATS;
  const unique = Array.from(new Set(selectedStats.map((value) => String(value || '').trim()).filter(Boolean)));
  if (!unique.length) {
    throw createHttpError(400, 'At least one stat must be selected.');
  }

  const allowed = new Set(['course_hole_model', ...Object.keys(STAT_KEY_CONFIG)]);
  const invalid = unique.filter((value) => !allowed.has(value));
  if (invalid.length) {
    throw createHttpError(400, `Unsupported selectedStats values: ${invalid.join(', ')}`);
  }

  const hasSgTotal = unique.includes('sg_total');
  const otherSgStats = unique.filter((value) => value !== 'sg_total' && SG_STAT_KEYS.includes(value));
  if (hasSgTotal && otherSgStats.length) {
    throw createHttpError(400, 'sg_total cannot be selected with other SG stats.');
  }

  return unique;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'BetLab/1.0 (+https://localhost)',
      accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    throw createHttpError(502, `Failed to fetch stat source (${response.status}): ${url}`);
  }

  return response.text();
}

function parseNextDataFromHtml(html, sourceLabel) {
  const match = String(html || '').match(NEXT_DATA_REGEX);
  if (!match) {
    throw createHttpError(502, `Could not locate __NEXT_DATA__ for ${sourceLabel}.`);
  }

  try {
    return JSON.parse(match[1]);
  } catch (_error) {
    throw createHttpError(502, `Failed to parse stat payload for ${sourceLabel}.`);
  }
}

function toNumberOrNull(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const cleaned = String(value || '')
    .replace(/,/g, '')
    .replace(/\+/g, '')
    .trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickStatDetailsQuery(queries, statId) {
  const candidates = queries.filter(
    (query) => query?.queryKey?.[0] === 'statDetails' && String(query?.queryKey?.[1]?.statId || '') === String(statId)
  );
  if (!candidates.length) return null;

  const withEventQuery = candidates.find((query) => query?.queryKey?.[1]?.eventQuery?.tournamentId);
  if (withEventQuery?.state?.data) return withEventQuery;

  const withYear = candidates.find((query) => Number.isFinite(Number(query?.queryKey?.[1]?.year)));
  if (withYear?.state?.data) return withYear;

  return candidates.find((query) => query?.state?.data) || null;
}

function extractRowsFromStatPage(nextData, statId) {
  const queries = nextData?.props?.pageProps?.dehydratedState?.queries;
  if (!Array.isArray(queries)) {
    throw createHttpError(502, `Unexpected stat payload shape for stat ${statId}.`);
  }

  const statDetailsQuery = pickStatDetailsQuery(queries, statId);
  const rows = statDetailsQuery?.state?.data?.rows;
  if (!Array.isArray(rows)) {
    throw createHttpError(502, `Stat payload missing rows for stat ${statId}.`);
  }
  return rows;
}

function extractPrimaryStatValue(row) {
  const stats = Array.isArray(row?.stats) ? row.stats : [];
  if (!stats.length) return null;

  const averageCandidate =
    stats.find((stat) => String(stat?.statName || '').trim().toLowerCase() === 'avg') ||
    stats.find((stat) => String(stat?.statName || '').trim().toLowerCase() === 'average') ||
    stats[0];

  return toNumberOrNull(averageCandidate?.statValue);
}

function buildPlayerStatMap(rows) {
  const byPlayer = {};

  rows.forEach((row) => {
    const normalizedName = normalizePlayerName(row?.playerName);
    if (!normalizedName) return;
    const value = extractPrimaryStatValue(row);
    if (!Number.isFinite(value)) return;
    byPlayer[normalizedName] = value;
  });

  return byPlayer;
}

function computeFieldMean(playerValues) {
  const values = Object.values(playerValues).filter((value) => Number.isFinite(value));
  if (!values.length) return 0;
  const total = values.reduce((accumulator, value) => accumulator + value, 0);
  return total / values.length;
}

async function scrapeRoundLeaderProjectionStats(selectedStats) {
  const statKeys = selectedStats.filter((key) => key !== 'course_hole_model');
  if (!statKeys.length) {
    return {
      byStatKey: {},
      fieldMeans: {},
      sourceStats: [],
      fetchedAt: new Date().toISOString(),
    };
  }

  const byStatKey = {};
  const fieldMeans = {};
  const sourceStats = [];

  for (const statKey of statKeys) {
    const config = STAT_KEY_CONFIG[statKey];
    if (!config) continue;

    const html = await fetchText(config.url);
    const nextData = parseNextDataFromHtml(html, config.label);
    const rows = extractRowsFromStatPage(nextData, config.statId);
    const playerMap = buildPlayerStatMap(rows);

    byStatKey[statKey] = playerMap;
    fieldMeans[statKey] = computeFieldMean(playerMap);
    sourceStats.push({
      key: statKey,
      label: config.label,
      statId: config.statId,
      url: config.url,
    });
  }

  return {
    byStatKey,
    fieldMeans,
    sourceStats,
    fetchedAt: new Date().toISOString(),
  };
}

function getStatConfigByKey(statKey) {
  return STAT_KEY_CONFIG[statKey] || null;
}

module.exports = {
  DEFAULT_SELECTED_STATS,
  SG_STAT_KEYS,
  getStatConfigByKey,
  normalizePlayerName,
  normalizeStatSelection,
  scrapeRoundLeaderProjectionStats,
};
