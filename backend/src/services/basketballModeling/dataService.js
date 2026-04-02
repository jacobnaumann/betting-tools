const fs = require('node:fs/promises');
const path = require('node:path');
const { parse } = require('csv-parse/sync');
const { createHttpError } = require('./errors');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DEFAULT_RESULTS_DIR = path.join(PROJECT_ROOT, 'NCAA Results', 'Raw results');
const DEFAULT_STATS_DIR = path.join(PROJECT_ROOT, 'multi-season-team-stats', 'normalized-names-results');

const RESULTS_FILE_REGEX = /^ncaa-\d{4}-\d{2}-adjusted-diff\.csv$/i;
const RESULTS_MASTER_FILE_REGEX = /^ncaa-master-results-\d{4}-\d{4}\.csv$/i;
const STATS_FILE_REGEX = /^NCAA_D1_Team_Stats_\d{4}-\d{2}-results-names\.csv$/i;
const STATS_MASTER_FILE_REGEX = /^ncaa-master-stats-\d{4}-\d{4}\.csv$/i;

let resultsCache = null;
let statsColumnsCache = null;
let statsRowsCache = null;

function normalizeTeamName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/['.]/g, '')
    .replace(/&/g, 'and')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildIsoDateFromRow(row) {
  const year = Number(row.year);
  const month = Number(row.month);
  const day = Number(row.day);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function normalizeLocation(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'N' || normalized === 'H' || normalized === 'V') return normalized;
  return null;
}

function normalizeBooleanLike(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (['1', 'true', 't', 'yes', 'y'].includes(normalized)) return true;
  if (['0', 'false', 'f', 'no', 'n'].includes(normalized)) return false;
  return null;
}

function normalizeSeasonPhase(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
}

function parseSeasonStartYearFromResultsFile(fileName) {
  const match = String(fileName).match(/^ncaa-(\d{4})-\d{2}-adjusted-diff\.csv$/i);
  if (!match) return null;
  return Number(match[1]);
}

function parseSeasonStartYearFromStatsFile(fileName) {
  const match = String(fileName).match(/^NCAA_D1_Team_Stats_(\d{4})-\d{2}-results-names\.csv$/i);
  if (!match) return null;
  return Number(match[1]);
}

function deriveSeasonStartYearFromRow(year, month) {
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  if (month >= 10) return year;
  return year - 1;
}

async function readCsvFile(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return parse(content, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });
}

async function listFilesSafe(targetDir, matcherRegexes) {
  let entries;
  try {
    entries = await fs.readdir(targetDir, { withFileTypes: true });
  } catch (_error) {
    throw createHttpError(500, `Could not read directory: ${targetDir}`);
  }

  const regexes = Array.isArray(matcherRegexes) ? matcherRegexes : [matcherRegexes];
  const matches = (name) => regexes.some((regex) => regex.test(name));

  return entries
    .filter((entry) => entry.isFile() && matches(entry.name))
    .map((entry) => path.join(targetDir, entry.name))
    .sort();
}

async function buildFileSignature(filePaths) {
  const parts = [];
  for (const filePath of filePaths) {
    const stats = await fs.stat(filePath);
    parts.push(`${path.basename(filePath)}:${stats.size}:${stats.mtimeMs}`);
  }
  return parts.join('|');
}

function toResultRow(rawRow, sourceFile, seasonStartYear) {
  const isoDate = buildIsoDateFromRow(rawRow);
  const year = Number(rawRow.year);
  const month = toNumberOrNull(rawRow.month);
  const adjustedDiff = toNumberOrNull(rawRow.adjust_diff);
  const adjustedDiffAlt = toNumberOrNull(rawRow.adjusted_diff);
  const team = String(rawRow.team || '').trim();
  const opponent = String(rawRow.opponent || '').trim();
  const location = normalizeLocation(rawRow.location);
  const normalizedSeasonStartYear = Number.isInteger(seasonStartYear)
    ? seasonStartYear
    : deriveSeasonStartYearFromRow(year, month);
  const targetValue = adjustedDiff !== null ? adjustedDiff : adjustedDiffAlt;

  if (!Number.isInteger(year) || !Number.isInteger(normalizedSeasonStartYear) || !team || !opponent || targetValue === null) {
    return null;
  }

  return {
    seasonStartYear: normalizedSeasonStartYear,
    year,
    month,
    day: toNumberOrNull(rawRow.day),
    isoDate,
    team,
    opponent,
    normalizedTeam: normalizeTeamName(team),
    normalizedOpponent: normalizeTeamName(opponent),
    location,
    adjustedDiff: targetValue,
    isConference: normalizeBooleanLike(rawRow.is_conference),
    seasonPhase: normalizeSeasonPhase(rawRow.season_phase),
    sourceFile,
  };
}

async function loadResultsRows() {
  const resultsDir = process.env.BASKETBALL_MODEL_RESULTS_DIR || DEFAULT_RESULTS_DIR;
  const csvFiles = await listFilesSafe(resultsDir, [RESULTS_FILE_REGEX, RESULTS_MASTER_FILE_REGEX]);
  if (!csvFiles.length) {
    throw createHttpError(500, `No adjusted-diff results CSV files found in: ${resultsDir}`);
  }
  const cacheSignature = await buildFileSignature(csvFiles);
  if (
    resultsCache &&
    resultsCache.sourceDirectory === resultsDir &&
    resultsCache.cacheSignature === cacheSignature
  ) {
    return resultsCache;
  }

  const rows = [];
  const files = [];
  const warnings = [];

  for (const filePath of csvFiles) {
    const parsed = await readCsvFile(filePath);
    const fileName = path.basename(filePath);
    files.push(fileName);
    const seasonStartYear = parseSeasonStartYearFromResultsFile(fileName);

    if (
      parsed.length &&
      !Object.prototype.hasOwnProperty.call(parsed[0], 'adjust_diff') &&
      !Object.prototype.hasOwnProperty.call(parsed[0], 'adjusted_diff')
    ) {
      warnings.push(`Skipped ${fileName}: missing adjust_diff/adjusted_diff column.`);
      continue;
    }

    let acceptedForFile = 0;
    for (const rawRow of parsed) {
      const normalized = toResultRow(rawRow, fileName, seasonStartYear);
      if (normalized) {
        rows.push(normalized);
        acceptedForFile += 1;
      }
    }

    if (parsed.length && acceptedForFile === 0) {
      warnings.push(`Skipped ${fileName}: no valid rows after normalization.`);
    }
  }

  resultsCache = {
    loadedAt: new Date().toISOString(),
    sourceDirectory: resultsDir,
    cacheSignature,
    sourceFiles: files,
    warnings,
    rows,
  };
  return resultsCache;
}

function isStatColumn(name) {
  const lower = String(name).toLowerCase();
  const disallowed = new Set([
    'season',
    'start_year',
    'team_slug',
    'source',
    'source_as_of_date',
    'scraped_at_utc',
    'team_original',
    'team',
  ]);
  if (disallowed.has(lower)) return false;
  return true;
}

function uniquePreservingOrder(values) {
  const seen = new Set();
  const unique = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

async function loadStatsColumns() {
  const statsDir = process.env.BASKETBALL_MODEL_STATS_DIR || DEFAULT_STATS_DIR;
  const csvFiles = await listFilesSafe(statsDir, [STATS_FILE_REGEX, STATS_MASTER_FILE_REGEX]);
  if (!csvFiles.length) {
    throw createHttpError(500, `No stats CSV files found in: ${statsDir}`);
  }
  const cacheSignature = await buildFileSignature(csvFiles);
  if (
    statsColumnsCache &&
    statsColumnsCache.sourceDirectory === statsDir &&
    statsColumnsCache.cacheSignature === cacheSignature
  ) {
    return statsColumnsCache;
  }

  const statsFile = csvFiles[csvFiles.length - 1];
  const content = await fs.readFile(statsFile, 'utf8');
  const [headerLine = ''] = content.split(/\r?\n/, 1);
  const header = headerLine.replace(/^\uFEFF/, '');
  const columns = header
    .split(',')
    .map((column) => column.trim())
    .filter(Boolean)
    .filter(isStatColumn);
  const uniqueColumns = uniquePreservingOrder(columns);

  statsColumnsCache = {
    loadedAt: new Date().toISOString(),
    sourceDirectory: statsDir,
    cacheSignature,
    sourceFile: path.basename(statsFile),
    columns: uniqueColumns,
  };

  return statsColumnsCache;
}

function toStatsRow(rawRow, sourceFile, sourceSeasonStartYear, columns) {
  const seasonStartYear = Number(rawRow.start_year);
  const normalizedSeasonStartYear = Number.isInteger(seasonStartYear) ? seasonStartYear : sourceSeasonStartYear;
  const team = String(rawRow.team || '').trim();
  const normalizedTeam = normalizeTeamName(team);

  if (!Number.isInteger(normalizedSeasonStartYear) || !normalizedTeam) {
    return null;
  }

  const values = {};
  for (const column of columns) {
    values[column] = toNumberOrNull(rawRow[column]);
  }

  return {
    seasonStartYear: normalizedSeasonStartYear,
    team,
    normalizedTeam,
    values,
    sourceFile,
  };
}

async function loadStatsRowsBySeasonAndTeam() {
  const statsDir = process.env.BASKETBALL_MODEL_STATS_DIR || DEFAULT_STATS_DIR;
  const csvFiles = await listFilesSafe(statsDir, [STATS_FILE_REGEX, STATS_MASTER_FILE_REGEX]);
  if (!csvFiles.length) {
    throw createHttpError(500, `No stats CSV files found in: ${statsDir}`);
  }
  const cacheSignature = await buildFileSignature(csvFiles);
  if (
    statsRowsCache &&
    statsRowsCache.sourceDirectory === statsDir &&
    statsRowsCache.cacheSignature === cacheSignature
  ) {
    return statsRowsCache;
  }

  const statsColumnsData = await loadStatsColumns();
  const rowsByKey = new Map();
  const warnings = [];
  const sourceFiles = [];

  for (const filePath of csvFiles) {
    const fileName = path.basename(filePath);
    sourceFiles.push(fileName);

    const parsed = await readCsvFile(filePath);
    const seasonStartYear = parseSeasonStartYearFromStatsFile(fileName);

    for (const rawRow of parsed) {
      const statsRow = toStatsRow(rawRow, fileName, seasonStartYear, statsColumnsData.columns);
      if (!statsRow) continue;
      const key = `${statsRow.seasonStartYear}:${statsRow.normalizedTeam}`;
      rowsByKey.set(key, statsRow);
    }
  }

  statsRowsCache = {
    loadedAt: new Date().toISOString(),
    sourceDirectory: statsDir,
    cacheSignature,
    sourceFiles,
    warnings,
    rowsByKey,
    columns: statsColumnsData.columns,
  };
  return statsRowsCache;
}

module.exports = {
  loadResultsRows,
  loadStatsColumns,
  loadStatsRowsBySeasonAndTeam,
  normalizeTeamName,
};
