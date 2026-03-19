const fs = require('node:fs/promises');
const path = require('node:path');
const { load } = require('cheerio');
const XLSX = require('xlsx');

const TEAMRANKINGS_BASE = 'https://www.teamrankings.com';
const TEAMRANKINGS_TEAM_URL_PREFIX = `${TEAMRANKINGS_BASE}/ncaa-basketball/team/`;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

const METRICS = [
  { key: 'offensive_efficiency', path: '/ncaa-basketball/stat/offensive-efficiency' },
  { key: 'defensive_efficiency', path: '/ncaa-basketball/stat/defensive-efficiency' },
  { key: 'effective_fg_pct', path: '/ncaa-basketball/stat/effective-field-goal-pct' },
  { key: 'opp_effective_fg_pct', path: '/ncaa-basketball/stat/opponent-effective-field-goal-pct' },
  { key: 'turnover_rate', path: '/ncaa-basketball/stat/turnover-pct' },
  { key: 'opp_turnover_rate', path: '/ncaa-basketball/stat/opponent-turnover-pct' },
  { key: 'offensive_rebound_rate', path: '/ncaa-basketball/stat/offensive-rebounding-pct' },
  { key: 'free_throw_rate', path: '/ncaa-basketball/stat/free-throw-rate' },
  { key: 'three_point_rate', path: '/ncaa-basketball/stat/three-point-rate' },
  {
    key: 'sos',
    path: '/ncaa-basketball/ranking/schedule-strength-by-other',
    valueColumn: 'rating',
  },
  { key: 'pace', path: '/ncaa-basketball/stat/possessions-per-game' },
];

const PER_100_METRICS = new Set(['offensive_efficiency', 'defensive_efficiency']);

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTeamKey(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function seasonLabel(startYear) {
  const endShort = String(startYear + 1).slice(-2);
  return `${startYear}-${endShort}`;
}

function defaultStartYearFromToday() {
  const today = new Date();
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  return month >= 10 ? year : year - 1;
}

function parseInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function toAbsoluteUrl(urlLike) {
  if (!urlLike) {
    return '';
  }
  if (/^https?:\/\//i.test(urlLike)) {
    return urlLike;
  }
  return `${TEAMRANKINGS_BASE}${urlLike}`;
}

function extractTeamSlug(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  } catch {
    return '';
  }
}

function toCsvLine(values) {
  return values
    .map((value) => {
      if (value === null || value === undefined) {
        return '';
      }
      const stringValue = String(value);
      if (/[",\n]/.test(stringValue)) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    })
    .join(',');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const derivedStartYear = defaultStartYearFromToday();
  const out = {
    teamsFile: path.resolve(process.cwd(), 'ncaa-teams.xlsx'),
    outputFile: '',
    reportFile: '',
    startYear: derivedStartYear,
    asOfDate: '',
    requestDelayMs: 2600,
    maxAttempts: 6,
    timeoutMs: 25000,
    limitTeams: 0,
  };

  for (let i = 0; i < args.length; i += 1) {
    const current = args[i];
    const next = args[i + 1];
    const maybeValue = (flag) => {
      if (current === flag && next) {
        i += 1;
        return next;
      }
      if (current.startsWith(`${flag}=`)) {
        return current.slice(flag.length + 1);
      }
      return null;
    };

    const teamsFileValue = maybeValue('--teams-file');
    if (teamsFileValue) {
      out.teamsFile = path.resolve(process.cwd(), teamsFileValue);
      continue;
    }

    const outputFileValue = maybeValue('--output-file');
    if (outputFileValue) {
      out.outputFile = path.resolve(process.cwd(), outputFileValue);
      continue;
    }

    const reportFileValue = maybeValue('--report-file');
    if (reportFileValue) {
      out.reportFile = path.resolve(process.cwd(), reportFileValue);
      continue;
    }

    const startYearValue = maybeValue('--start-year');
    if (startYearValue) {
      out.startYear = parseInteger(startYearValue, out.startYear);
      continue;
    }

    const asOfDateValue = maybeValue('--as-of-date');
    if (asOfDateValue) {
      out.asOfDate = normalizeWhitespace(asOfDateValue);
      continue;
    }

    const requestDelayValue = maybeValue('--request-delay-ms');
    if (requestDelayValue) {
      out.requestDelayMs = parseInteger(requestDelayValue, out.requestDelayMs);
      continue;
    }

    const maxAttemptsValue = maybeValue('--max-attempts');
    if (maxAttemptsValue) {
      out.maxAttempts = parseInteger(maxAttemptsValue, out.maxAttempts);
      continue;
    }

    const timeoutMsValue = maybeValue('--timeout-ms');
    if (timeoutMsValue) {
      out.timeoutMs = parseInteger(timeoutMsValue, out.timeoutMs);
      continue;
    }

    const limitTeamsValue = maybeValue('--limit-teams');
    if (limitTeamsValue) {
      out.limitTeams = parseInteger(limitTeamsValue, out.limitTeams);
      continue;
    }

    // npm can sometimes pass a bare positional value (for example "2025") after script args.
    if (/^\d{4}$/.test(current)) {
      out.startYear = parseInteger(current, out.startYear);
      continue;
    }
  }

  if (!Number.isInteger(out.startYear) || out.startYear < 2000) {
    throw new Error(`Invalid --start-year: ${out.startYear}`);
  }
  if (!Number.isInteger(out.requestDelayMs) || out.requestDelayMs < 500) {
    throw new Error(`Invalid --request-delay-ms: ${out.requestDelayMs}`);
  }
  if (!Number.isInteger(out.maxAttempts) || out.maxAttempts < 1) {
    throw new Error(`Invalid --max-attempts: ${out.maxAttempts}`);
  }
  if (!Number.isInteger(out.timeoutMs) || out.timeoutMs < 2000) {
    throw new Error(`Invalid --timeout-ms: ${out.timeoutMs}`);
  }

  const label = seasonLabel(out.startYear);
  if (!out.outputFile) {
    out.outputFile = path.resolve(process.cwd(), `NCAA_D1_Team_Stats_${label}.csv`);
  }
  if (!out.reportFile) {
    out.reportFile = path.resolve(process.cwd(), `NCAA_D1_Team_Stats_${label}-validation.json`);
  }
  if (!out.asOfDate) {
    out.asOfDate = `${out.startYear + 1}-04-15`;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.asOfDate)) {
    throw new Error(`Invalid --as-of-date format: ${out.asOfDate}. Expected YYYY-MM-DD.`);
  }

  return out;
}

function getWorkbookLinks(sheet) {
  const links = [];
  const ref = sheet['!ref'];
  if (!ref) {
    return links;
  }
  const range = XLSX.utils.decode_range(ref);
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const addr = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = sheet[addr];
      if (!cell || !cell.l || !cell.l.Target) {
        continue;
      }
      links.push({
        row,
        col,
        team: normalizeWhitespace(cell.v),
        url: normalizeWhitespace(cell.l.Target),
      });
    }
  }
  return links;
}

function readTeamsFromWorkbook(teamsFile) {
  const workbook = XLSX.readFile(teamsFile);
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  const teams = [];
  const seenSlugs = new Set();

  if (rows.length > 0) {
    const headerKeys = Object.keys(rows[0]);
    const teamCol = headerKeys.find((key) => /team/i.test(key)) || headerKeys[0];
    const urlCol = headerKeys.find((key) => /(url|link|href)/i.test(key));

    if (teamCol && urlCol) {
      for (const row of rows) {
        const team = normalizeWhitespace(row[teamCol]);
        const url = normalizeWhitespace(row[urlCol]);
        const slug = extractTeamSlug(url);
        if (!team || !slug || !url.startsWith(TEAMRANKINGS_TEAM_URL_PREFIX)) {
          continue;
        }
        if (seenSlugs.has(slug)) {
          continue;
        }
        seenSlugs.add(slug);
        teams.push({ team, url, slug });
      }
    }
  }

  if (teams.length === 0) {
    const linkCells = getWorkbookLinks(sheet);
    for (const entry of linkCells) {
      const team = normalizeWhitespace(entry.team);
      const url = normalizeWhitespace(entry.url);
      const slug = extractTeamSlug(url);
      if (!team || !slug || !url.startsWith(TEAMRANKINGS_TEAM_URL_PREFIX)) {
        continue;
      }
      if (seenSlugs.has(slug)) {
        continue;
      }
      seenSlugs.add(slug);
      teams.push({ team, url, slug });
    }
  }

  if (teams.length === 0) {
    throw new Error(
      `No TeamRankings team links found in ${teamsFile}. Expected hyperlinks like ${TEAMRANKINGS_TEAM_URL_PREFIX}...`
    );
  }

  return teams;
}

function parseRetryAfterMs(response) {
  const header = response.headers.get('retry-after');
  if (!header) {
    return null;
  }
  const numericSeconds = Number(header);
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
    return Math.round(numericSeconds * 1000);
  }
  const retryDate = Date.parse(header);
  if (Number.isNaN(retryDate)) {
    return null;
  }
  const delay = retryDate - Date.now();
  return delay > 0 ? delay : 0;
}

function maybeRateLimitedBody(html) {
  const text = normalizeWhitespace(html).toLowerCase();
  return (
    text.includes('too many requests') ||
    text.includes('rate limit') ||
    text.includes('access denied') ||
    text.includes('temporarily blocked')
  );
}

async function fetchHtmlWithRetry(url, config) {
  let lastError = null;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
          pragma: 'no-cache',
          'cache-control': 'no-cache',
        },
      });

      const html = await response.text();
      if (response.ok && !maybeRateLimitedBody(html)) {
        return html;
      }

      const retryAfterMs = parseRetryAfterMs(response);
      const baseBackoff = Math.min(22000, 1200 * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * 700);
      const waitMs = Math.max(baseBackoff + jitter, retryAfterMs || 0);
      lastError = new Error(
        `HTTP ${response.status} for ${url} (attempt ${attempt}/${config.maxAttempts})`
      );
      if (attempt < config.maxAttempts) {
        await sleep(waitMs);
        continue;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < config.maxAttempts) {
        const baseBackoff = Math.min(22000, 1200 * 2 ** (attempt - 1));
        const jitter = Math.floor(Math.random() * 700);
        await sleep(baseBackoff + jitter);
        continue;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error(`Failed to fetch ${url}`);
}

function getSeasonColumnIndex(headers, startYear) {
  const seasonColumnText = String(startYear);
  const exactIndex = headers.findIndex((header) => header === seasonColumnText);
  if (exactIndex >= 0) {
    return exactIndex;
  }

  // Fallback: first 4-digit numeric season column if expected year is absent.
  const firstNumericSeason = headers.findIndex((header) => /^\d{4}$/.test(header));
  return firstNumericSeason;
}

function parseNumericValue(valueText) {
  const normalized = normalizeWhitespace(valueText).replace(/[%,$]/g, '');
  if (!normalized) {
    return null;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function transformMetricValue(metricKey, value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (PER_100_METRICS.has(metricKey)) {
    // TeamRankings efficiency is points per possession; convert to per-100 possessions.
    return Math.round(value * 100000) / 1000;
  }
  return value;
}

function parseMetricRows(html, metric, startYear) {
  const $ = load(html);
  const table = $('table').first();
  if (!table || table.length === 0) {
    throw new Error(`No table found for metric "${metric.key}".`);
  }

  const headers = table
    .find('th')
    .toArray()
    .map((th) => normalizeWhitespace($(th).text()));
  const teamIdx = headers.findIndex((h) => h.toLowerCase() === 'team');
  const seasonIdx = getSeasonColumnIndex(headers, startYear);
  const valueColumnName = normalizeWhitespace(metric.valueColumn || '').toLowerCase();
  const valueIdx =
    valueColumnName.length > 0 ? headers.findIndex((h) => h.toLowerCase() === valueColumnName) : seasonIdx;
  if (teamIdx < 0 || valueIdx < 0) {
    throw new Error(
      `Could not locate Team/season columns for metric "${metric.key}". Headers: ${headers.join(', ')}`
    );
  }

  const rows = [];
  table.find('tbody tr').each((_, row) => {
    const cells = $(row).find('td').toArray();
    const teamCell = cells[teamIdx];
    const valueCell = cells[valueIdx];
    if (!teamCell || !valueCell) {
      return;
    }

    const teamEl = $(teamCell);
    const teamName = normalizeWhitespace(teamEl.text());
    const href = normalizeWhitespace(teamEl.find('a').attr('href') || '');
    const teamUrl = toAbsoluteUrl(href);
    const slug = extractTeamSlug(teamUrl);
    const value = parseNumericValue($(valueCell).text());
    if (!teamName || !slug || value === null) {
      return;
    }
    rows.push({ teamName, teamUrl, slug, value });
  });

  return rows;
}

async function scrapeMetric(metric, config) {
  const url = `${TEAMRANKINGS_BASE}${metric.path}?date=${encodeURIComponent(config.asOfDate)}`;
  const html = await fetchHtmlWithRetry(url, config);
  const rows = parseMetricRows(html, metric, config.startYear);
  return { url, rows };
}

function buildRowsByTeam(teams, metricsData, limitTeams = 0) {
  const rowsBySlug = new Map();
  const unresolvedMetricTeams = {};

  for (const metric of METRICS) {
    unresolvedMetricTeams[metric.key] = [];
  }

  const teamsBase = limitTeams > 0 ? teams.slice(0, limitTeams) : teams;
  for (const team of teamsBase) {
    rowsBySlug.set(team.slug, {
      season: seasonLabel(metricsData.startYear),
      start_year: metricsData.startYear,
      team: team.team,
      team_slug: team.slug,
      offensive_efficiency: null,
      defensive_efficiency: null,
      effective_fg_pct: null,
      opp_effective_fg_pct: null,
      turnover_rate: null,
      opp_turnover_rate: null,
      offensive_rebound_rate: null,
      free_throw_rate: null,
      three_point_rate: null,
      sos: null,
      pace: null,
      source: 'teamrankings',
      source_as_of_date: metricsData.asOfDate,
      scraped_at_utc: new Date().toISOString(),
    });
  }

  for (const metric of METRICS) {
    const metricRows = metricsData.byMetric.get(metric.key) || [];
    for (const metricRow of metricRows) {
      const existing = rowsBySlug.get(metricRow.slug);
      if (!existing) {
        unresolvedMetricTeams[metric.key].push(metricRow.slug);
        continue;
      }
      existing[metric.key] = transformMetricValue(metric.key, metricRow.value);
    }
  }

  return { rowsBySlug, unresolvedMetricTeams };
}

function countMissingByMetric(rows) {
  const output = {};
  for (const metric of METRICS) {
    output[metric.key] = 0;
  }
  for (const row of rows) {
    for (const metric of METRICS) {
      if (row[metric.key] === null || row[metric.key] === undefined || Number.isNaN(row[metric.key])) {
        output[metric.key] += 1;
      }
    }
  }
  return output;
}

async function run() {
  const config = parseArgs();
  const teams = readTeamsFromWorkbook(config.teamsFile);
  console.log(`Loaded ${teams.length} D1 teams from workbook.`);
  console.log(
    `Scraping ${METRICS.length} TeamRankings stat pages with ${config.requestDelayMs}ms request delay (as-of ${config.asOfDate}).`
  );

  const byMetric = new Map();
  const metricCoverage = {};
  const metricUrls = {};
  const errors = [];

  for (let i = 0; i < METRICS.length; i += 1) {
    const metric = METRICS[i];
    console.log(`[${i + 1}/${METRICS.length}] ${metric.key}`);
    try {
      const result = await scrapeMetric(metric, config);
      byMetric.set(metric.key, result.rows);
      metricCoverage[metric.key] = result.rows.length;
      metricUrls[metric.key] = result.url;
    } catch (error) {
      byMetric.set(metric.key, []);
      metricCoverage[metric.key] = 0;
      metricUrls[metric.key] = `${TEAMRANKINGS_BASE}${metric.path}`;
      errors.push({
        metric: metric.key,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (i < METRICS.length - 1) {
      // TeamRankings can rate-limit bursty traffic, so we keep spacing conservative.
      const jitter = Math.floor(Math.random() * 450);
      await sleep(config.requestDelayMs + jitter);
    }
  }

  const { rowsBySlug, unresolvedMetricTeams } = buildRowsByTeam(teams, {
    startYear: config.startYear,
    asOfDate: config.asOfDate,
    byMetric,
  }, config.limitTeams);

  const outputRows = [...rowsBySlug.values()].sort((a, b) => a.team.localeCompare(b.team));
  const csvColumns = [
    'season',
    'start_year',
    'team',
    'team_slug',
    'offensive_efficiency',
    'defensive_efficiency',
    'effective_fg_pct',
    'opp_effective_fg_pct',
    'turnover_rate',
    'opp_turnover_rate',
    'offensive_rebound_rate',
    'free_throw_rate',
    'three_point_rate',
    'sos',
    'pace',
    'source',
    'source_as_of_date',
    'scraped_at_utc',
  ];

  const csvLines = [toCsvLine(csvColumns)];
  for (const row of outputRows) {
    csvLines.push(toCsvLine(csvColumns.map((column) => row[column])));
  }

  const outputDir = path.dirname(config.outputFile);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(config.outputFile, `${csvLines.join('\n')}\n`, 'utf8');

  const missingByMetric = countMissingByMetric(outputRows);
  const missingAnyMetricCount = outputRows.filter((row) =>
    METRICS.some((metric) => row[metric.key] === null || row[metric.key] === undefined || Number.isNaN(row[metric.key]))
  ).length;

  const report = {
    season: seasonLabel(config.startYear),
    startYear: config.startYear,
    asOfDate: config.asOfDate,
    expectedTeams: config.limitTeams > 0 ? Math.min(config.limitTeams, teams.length) : teams.length,
    rowsWritten: outputRows.length,
    source: 'teamrankings',
    metricUrls,
    metricCoverage,
    missingByMetric,
    teamsMissingAtLeastOneMetric: missingAnyMetricCount,
    unresolvedMetricTeamSlugs: unresolvedMetricTeams,
    scrapeErrors: errors,
    generatedAtUtc: new Date().toISOString(),
  };
  await fs.writeFile(config.reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`\nWrote ${outputRows.length} rows to ${config.outputFile}`);
  console.log(`Validation report: ${config.reportFile}`);
  console.log(`Metric scrape errors: ${errors.length}`);
}

run().catch((error) => {
  console.error('Failed to build NCAA D1 team stats dataset:', error);
  process.exit(1);
});
