const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { parse } = require('csv-parse/sync');

const NEXT_DATA_REGEX = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/;
const DATA_DIRECTORY = path.resolve(__dirname, '../../data');
const STROKES_GAINED_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}-strokes-gained\.csv$/i;
const RECENT_FORM_FILE_PATTERN = /^dg_group_trending_table-.*\.csv$/i;
const SG_DATA_PARSER_VERSION = 'sg-parser-v2-missing-sentinel';
const RECENT_FORM_DATA_PARSER_VERSION = 'recent-form-parser-v1';
const SG_PLAYER_NAME_COLUMN = 'player_name';
const RECENT_FORM_PLAYER_NAME_COLUMN = 'player_name';
const RECENT_FORM_STAT_KEY = 'recent_form_l20';
const SG_CSV_COLUMN_BY_STAT_KEY = {
  sg_total: 'sg_total_pred',
  sg_ott: 'sg_ott_pred',
  sg_app: 'sg_app_pred',
  sg_arg: 'sg_arg_pred',
  sg_putt: 'sg_putt_pred',
};
const DG_SKILL_RATING_COLUMN_BY_STAT_KEY = {
  sg_total: 'total_true',
  sg_t2g: 't2g_true',
  sg_ott: 'ott_true',
  sg_app: 'app_true',
  sg_arg: 'arg_true',
  sg_putt: 'putt_true',
};
const SG_UPLOAD_SCHEMAS = [
  {
    key: 'betlab_sg_predictions',
    label: 'BetLab SG predictions',
    requiredColumns: [SG_PLAYER_NAME_COLUMN, 'sg_total_pred', 'sg_ott_pred', 'sg_app_pred', 'sg_arg_pred', 'sg_putt_pred'],
  },
  {
    key: 'datagolf_skill_ratings',
    label: 'DataGolf skill ratings',
    requiredColumns: [SG_PLAYER_NAME_COLUMN, 'total_true', 'ott_true', 'app_true', 'arg_true', 'putt_true'],
  },
];
const RECENT_FORM_COLUMN_BY_STAT_KEY = {
  [RECENT_FORM_STAT_KEY]: 'vs_baseline_l20',
};
const RECENT_FORM_UPLOAD_SCHEMAS = [
  {
    key: 'datagolf_group_trending',
    label: 'DataGolf group trending',
    requiredColumns: [RECENT_FORM_PLAYER_NAME_COLUMN, 'true_sg_l20', 'vs_baseline_l20'],
  },
];

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
  [RECENT_FORM_STAT_KEY]: {
    key: RECENT_FORM_STAT_KEY,
    label: 'Recent Form L20',
    group: 'recent_form',
  },
};

const DEFAULT_SELECTED_STATS = ['course_hole_model', 'par3_scoring_avg', 'par4_scoring_avg', 'par5_scoring_avg'];
const SG_STAT_KEYS = ['sg_total', 'sg_t2g', 'sg_ott', 'sg_app', 'sg_arg', 'sg_putt'];
const SG_T2G_COMPONENT_KEYS = ['sg_ott', 'sg_app', 'sg_arg'];
const RECENT_FORM_STAT_KEYS = [RECENT_FORM_STAT_KEY];
const DEFAULT_UPLOADED_SG_FILENAME = 'uploaded-strokes-gained.csv';
const DEFAULT_UPLOADED_RECENT_FORM_FILENAME = 'uploaded-recent-form.csv';

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizePlayerName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ß]/g, 'ss')
    .replace(/[øØ]/g, 'o')
    .replace(/[ðÐ]/g, 'd')
    .replace(/[þÞ]/g, 'th')
    .replace(/[łŁ]/g, 'l')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[œŒ]/g, 'oe')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/\./g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildNameSignature(name) {
  const normalizedName = normalizePlayerName(name);
  const tokens = normalizedName.split(' ').filter(Boolean);
  const sortedTokens = [...tokens].sort();
  const tokenKey = sortedTokens.join(' ');
  const initialsSignature = sortedTokens.map((token) => token[0] || '').join('');
  return {
    normalizedName,
    tokenKey,
    tokenCount: sortedTokens.length,
    initialsSignature,
  };
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
  const hasSgT2g = unique.includes('sg_t2g');
  const overlappingT2gStats = unique.filter((value) => SG_T2G_COMPONENT_KEYS.includes(value));
  if (hasSgT2g && overlappingT2gStats.length) {
    throw createHttpError(400, 'sg_t2g cannot be selected with SG OTT, APP, or ARG.');
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

function toSgNumberOrNull(value) {
  const parsed = toNumberOrNull(value);
  if (!Number.isFinite(parsed)) return null;
  // DataGolf skill rating exports use -9999 as a missing-value sentinel.
  if (parsed <= -999) return null;
  return parsed;
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

async function readCsvFile(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return parseCsvContent(content, path.basename(filePath));
}

function parseCsvContent(content, sourceLabel) {
  try {
    return parse(content, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (_error) {
    throw createHttpError(400, `Failed to parse CSV: ${sourceLabel}.`);
  }
}

function parseCsvHeaderColumns(content, sourceLabel) {
  try {
    const rows = parse(content, {
      bom: true,
      columns: false,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      to_line: 1,
    });
    const firstRow = Array.isArray(rows?.[0]) ? rows[0] : [];
    return firstRow.map((columnName) => String(columnName || '').trim()).filter(Boolean);
  } catch (_error) {
    throw createHttpError(400, `Failed to parse CSV header: ${sourceLabel}.`);
  }
}

function normalizeCsvColumnName(columnName) {
  return String(columnName || '').trim().toLowerCase();
}

function buildNormalizedColumnSet(columns) {
  const normalizedColumns = Array.isArray(columns) ? columns : [];
  return new Set(normalizedColumns.map((columnName) => normalizeCsvColumnName(columnName)).filter(Boolean));
}

function resolveSgUploadSchema(headerColumns) {
  const normalizedColumns = buildNormalizedColumnSet(headerColumns);
  return SG_UPLOAD_SCHEMAS.find((schema) =>
    schema.requiredColumns.every((columnName) => normalizedColumns.has(normalizeCsvColumnName(columnName)))
  ) || null;
}

function resolveRecentFormUploadSchema(headerColumns) {
  const normalizedColumns = buildNormalizedColumnSet(headerColumns);
  return RECENT_FORM_UPLOAD_SCHEMAS.find((schema) =>
    schema.requiredColumns.every((columnName) => normalizedColumns.has(normalizeCsvColumnName(columnName)))
  ) || null;
}

function getAcceptedSgSchemaDescription() {
  return SG_UPLOAD_SCHEMAS.map((schema) => `${schema.label}: ${schema.requiredColumns.join(', ')}`).join(' OR ');
}

function getAcceptedRecentFormSchemaDescription() {
  return RECENT_FORM_UPLOAD_SCHEMAS.map((schema) => `${schema.label}: ${schema.requiredColumns.join(', ')}`).join(' OR ');
}

function getRowValueByColumn(row, columnName) {
  if (!row || typeof row !== 'object' || !columnName) return undefined;
  if (Object.prototype.hasOwnProperty.call(row, columnName)) return row[columnName];
  const normalizedTarget = normalizeCsvColumnName(columnName);
  const matchingKey = Object.keys(row).find((key) => normalizeCsvColumnName(key) === normalizedTarget);
  return matchingKey ? row[matchingKey] : undefined;
}

function getRecentFormStatValueFromRow(row, statKey) {
  const columnName = RECENT_FORM_COLUMN_BY_STAT_KEY[statKey];
  return toNumberOrNull(getRowValueByColumn(row, columnName));
}

function validateSgCsvContent(fileName, content) {
  const headerColumns = parseCsvHeaderColumns(content, fileName);
  const uploadSchema = resolveSgUploadSchema(headerColumns);
  if (!uploadSchema) {
    throw createHttpError(
      400,
      `SG CSV must match a supported structure. Accepted columns are: ${getAcceptedSgSchemaDescription()}.`
    );
  }

  const rows = parseCsvContent(content, fileName);
  if (!rows.length) {
    throw createHttpError(400, 'SG CSV must include at least one data row.');
  }

  let playerRowCount = 0;
  let usableSgRowCount = 0;
  rows.forEach((row) => {
    const playerName = String(getRowValueByColumn(row, SG_PLAYER_NAME_COLUMN) || row?.playerName || '').trim();
    if (!playerName) return;
    playerRowCount += 1;
    const hasSgValue = Number.isFinite(getSgStatValueFromRow(row, 'sg_total'));
    if (hasSgValue) {
      usableSgRowCount += 1;
    }
  });

  if (!playerRowCount) {
    throw createHttpError(400, 'SG CSV must include at least one row with a player_name value.');
  }
  if (!usableSgRowCount) {
    throw createHttpError(400, 'SG CSV must include at least one row with a valid SG total value.');
  }

  return {
    rows,
    rowCount: rows.length,
    playerRowCount,
    usableSgRowCount,
    headerColumns,
    schemaKey: uploadSchema.key,
    schemaLabel: uploadSchema.label,
    requiredColumns: uploadSchema.requiredColumns,
    acceptedSchemas: SG_UPLOAD_SCHEMAS.map((schema) => ({
      key: schema.key,
      label: schema.label,
      requiredColumns: schema.requiredColumns,
    })),
  };
}

function validateRecentFormCsvContent(fileName, content) {
  const headerColumns = parseCsvHeaderColumns(content, fileName);
  const uploadSchema = resolveRecentFormUploadSchema(headerColumns);
  if (!uploadSchema) {
    throw createHttpError(
      400,
      `Recent Form CSV must match a supported structure. Accepted columns are: ${getAcceptedRecentFormSchemaDescription()}.`
    );
  }

  const rows = parseCsvContent(content, fileName);
  if (!rows.length) {
    throw createHttpError(400, 'Recent Form CSV must include at least one data row.');
  }

  let playerRowCount = 0;
  let usableRecentFormRowCount = 0;
  rows.forEach((row) => {
    const playerName = String(getRowValueByColumn(row, RECENT_FORM_PLAYER_NAME_COLUMN) || row?.playerName || '').trim();
    if (!playerName) return;
    playerRowCount += 1;
    const recentFormValue = getRecentFormStatValueFromRow(row, RECENT_FORM_STAT_KEY);
    if (Number.isFinite(recentFormValue)) {
      usableRecentFormRowCount += 1;
    }
  });

  if (!playerRowCount) {
    throw createHttpError(400, 'Recent Form CSV must include at least one row with a player_name value.');
  }
  if (!usableRecentFormRowCount) {
    throw createHttpError(400, 'Recent Form CSV must include at least one row with a valid vs_baseline_l20 value.');
  }

  return {
    rows,
    rowCount: rows.length,
    playerRowCount,
    usableRecentFormRowCount,
    headerColumns,
    schemaKey: uploadSchema.key,
    schemaLabel: uploadSchema.label,
    requiredColumns: uploadSchema.requiredColumns,
    acceptedSchemas: RECENT_FORM_UPLOAD_SCHEMAS.map((schema) => ({
      key: schema.key,
      label: schema.label,
      requiredColumns: schema.requiredColumns,
    })),
  };
}

function normalizeUploadedSgCsv(uploadedSgCsvInput) {
  if (uploadedSgCsvInput === undefined || uploadedSgCsvInput === null) {
    return null;
  }
  if (typeof uploadedSgCsvInput !== 'object' || Array.isArray(uploadedSgCsvInput)) {
    throw createHttpError(400, 'uploadedSgCsv must be an object with fileName and content.');
  }

  const content = typeof uploadedSgCsvInput.content === 'string' ? uploadedSgCsvInput.content : '';
  if (!content.trim()) {
    throw createHttpError(400, 'Uploaded SG CSV is empty.');
  }

  const rawFileName = typeof uploadedSgCsvInput.fileName === 'string' ? uploadedSgCsvInput.fileName.trim() : '';
  const fileName = path.basename(rawFileName || DEFAULT_UPLOADED_SG_FILENAME);
  return {
    fileName,
    content,
  };
}

function normalizeUploadedRecentFormCsv(uploadedRecentFormCsvInput) {
  if (uploadedRecentFormCsvInput === undefined || uploadedRecentFormCsvInput === null) {
    return null;
  }
  if (typeof uploadedRecentFormCsvInput !== 'object' || Array.isArray(uploadedRecentFormCsvInput)) {
    throw createHttpError(400, 'uploadedRecentFormCsv must be an object with fileName and content.');
  }

  const content = typeof uploadedRecentFormCsvInput.content === 'string' ? uploadedRecentFormCsvInput.content : '';
  if (!content.trim()) {
    throw createHttpError(400, 'Uploaded Recent Form CSV is empty.');
  }

  const rawFileName =
    typeof uploadedRecentFormCsvInput.fileName === 'string' ? uploadedRecentFormCsvInput.fileName.trim() : '';
  const fileName = path.basename(rawFileName || DEFAULT_UPLOADED_RECENT_FORM_FILENAME);
  return {
    fileName,
    content,
  };
}

function buildUploadedSgVersionKey({ fileName, content }) {
  const contentSize = Buffer.byteLength(content, 'utf8');
  const contentHash = createHash('sha1').update(content).digest('hex').slice(0, 12);
  return `${SG_DATA_PARSER_VERSION}:uploaded:${fileName}:${contentSize}:${contentHash}`;
}

function buildUploadedRecentFormVersionKey({ fileName, content }) {
  const contentSize = Buffer.byteLength(content, 'utf8');
  const contentHash = createHash('sha1').update(content).digest('hex').slice(0, 12);
  return `${RECENT_FORM_DATA_PARSER_VERSION}:uploaded:${fileName}:${contentSize}:${contentHash}`;
}

function buildSgDatasetFromRows(rows, metadata) {
  const { filePath = null, fileName, versionKey, source = 'local_csv' } = metadata || {};
  const players = [];

  rows.forEach((row) => {
    const sourceName = String(getRowValueByColumn(row, SG_PLAYER_NAME_COLUMN) || row?.playerName || '').trim();
    if (!sourceName) return;
    const signature = buildNameSignature(sourceName);
    if (!signature.normalizedName) return;

    const values = {};
    SG_STAT_KEYS.forEach((statKey) => {
      values[statKey] = getSgStatValueFromRow(row, statKey);
    });

    players.push({
      sourceName,
      ...signature,
      values,
    });
  });

  return {
    filePath,
    fileName,
    versionKey,
    source,
    players,
  };
}

function buildRecentFormDatasetFromRows(rows, metadata) {
  const { filePath = null, fileName, versionKey, source = 'local_csv' } = metadata || {};
  const players = [];

  rows.forEach((row) => {
    const sourceName = String(getRowValueByColumn(row, RECENT_FORM_PLAYER_NAME_COLUMN) || row?.playerName || '').trim();
    if (!sourceName) return;
    const signature = buildNameSignature(sourceName);
    if (!signature.normalizedName) return;

    const values = {};
    RECENT_FORM_STAT_KEYS.forEach((statKey) => {
      values[statKey] = getRecentFormStatValueFromRow(row, statKey);
    });

    players.push({
      sourceName,
      ...signature,
      values,
      trueSgL20: toNumberOrNull(getRowValueByColumn(row, 'true_sg_l20')),
    });
  });

  return {
    filePath,
    fileName,
    versionKey,
    source,
    players,
  };
}

async function resolveDefaultSgDataset() {
  const filePath = await resolveLatestStrokesGainedFilePath();
  const rows = await readCsvFile(filePath);
  const fileStats = await fs.stat(filePath);
  const fileName = path.basename(filePath);
  const versionKey = `${fileName}:${fileStats.size}:${Math.trunc(fileStats.mtimeMs)}`;
  return buildSgDatasetFromRows(rows, {
    filePath,
    fileName,
    versionKey,
    source: 'local_csv',
  });
}

async function resolveDefaultRecentFormDataset() {
  const filePath = await resolveLatestRecentFormFilePath();
  if (!filePath) {
    return buildRecentFormDatasetFromRows([], {
      fileName: null,
      versionKey: `${RECENT_FORM_DATA_PARSER_VERSION}:none`,
      source: 'missing_default_csv',
    });
  }

  const rows = await readCsvFile(filePath);
  const fileStats = await fs.stat(filePath);
  const fileName = path.basename(filePath);
  const versionKey = `${RECENT_FORM_DATA_PARSER_VERSION}:${fileName}:${fileStats.size}:${Math.trunc(fileStats.mtimeMs)}`;
  return buildRecentFormDatasetFromRows(rows, {
    filePath,
    fileName,
    versionKey,
    source: 'local_csv',
  });
}

function resolveUploadedSgDataset(uploadedSgCsvInput) {
  const uploadedSgCsv = normalizeUploadedSgCsv(uploadedSgCsvInput);
  if (!uploadedSgCsv) return null;

  const validation = validateSgCsvContent(uploadedSgCsv.fileName, uploadedSgCsv.content);
  const rows = validation.rows;
  return buildSgDatasetFromRows(rows, {
    fileName: uploadedSgCsv.fileName,
    versionKey: buildUploadedSgVersionKey(uploadedSgCsv),
    source: 'uploaded_csv',
  });
}

function resolveUploadedRecentFormDataset(uploadedRecentFormCsvInput) {
  const uploadedRecentFormCsv = normalizeUploadedRecentFormCsv(uploadedRecentFormCsvInput);
  if (!uploadedRecentFormCsv) return null;

  const validation = validateRecentFormCsvContent(uploadedRecentFormCsv.fileName, uploadedRecentFormCsv.content);
  const rows = validation.rows;
  return buildRecentFormDatasetFromRows(rows, {
    fileName: uploadedRecentFormCsv.fileName,
    versionKey: buildUploadedRecentFormVersionKey(uploadedRecentFormCsv),
    source: 'uploaded_csv',
  });
}

async function resolveSgDataset(uploadedSgCsvInput) {
  const uploadedDataset = resolveUploadedSgDataset(uploadedSgCsvInput);
  if (uploadedDataset) return uploadedDataset;
  return resolveDefaultSgDataset();
}

async function resolveRecentFormDataset(uploadedRecentFormCsvInput) {
  const uploadedDataset = resolveUploadedRecentFormDataset(uploadedRecentFormCsvInput);
  if (uploadedDataset) return uploadedDataset;
  return resolveDefaultRecentFormDataset();
}

async function resolveLatestStrokesGainedFilePath() {
  let directoryEntries;
  try {
    directoryEntries = await fs.readdir(DATA_DIRECTORY, { withFileTypes: true });
  } catch (_error) {
    throw createHttpError(500, `Could not read SG data directory: ${DATA_DIRECTORY}`);
  }

  const fileNames = directoryEntries
    .filter((entry) => entry.isFile() && STROKES_GAINED_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (!fileNames.length) {
    throw createHttpError(
      500,
      `No SG source CSV found in ${DATA_DIRECTORY}. Expected filename pattern YYYY-MM-DD-strokes-gained.csv.`
    );
  }

  return path.join(DATA_DIRECTORY, fileNames[fileNames.length - 1]);
}

async function resolveLatestRecentFormFilePath() {
  let directoryEntries;
  try {
    directoryEntries = await fs.readdir(DATA_DIRECTORY, { withFileTypes: true });
  } catch (_error) {
    throw createHttpError(500, `Could not read Recent Form data directory: ${DATA_DIRECTORY}`);
  }

  const fileNames = directoryEntries
    .filter((entry) => entry.isFile() && RECENT_FORM_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (!fileNames.length) {
    return null;
  }

  return path.join(DATA_DIRECTORY, fileNames[fileNames.length - 1]);
}

async function getRoundLeaderProjectionSgDataVersionKey(uploadedSgCsvInput) {
  const uploadedSgCsv = normalizeUploadedSgCsv(uploadedSgCsvInput);
  if (uploadedSgCsv) {
    return buildUploadedSgVersionKey(uploadedSgCsv);
  }

  const filePath = await resolveLatestStrokesGainedFilePath();
  const stats = await fs.stat(filePath);
  return `${SG_DATA_PARSER_VERSION}:${path.basename(filePath)}:${stats.size}:${Math.trunc(stats.mtimeMs)}`;
}

async function getRoundLeaderProjectionRecentFormDataVersionKey(uploadedRecentFormCsvInput) {
  const uploadedRecentFormCsv = normalizeUploadedRecentFormCsv(uploadedRecentFormCsvInput);
  if (uploadedRecentFormCsv) {
    return buildUploadedRecentFormVersionKey(uploadedRecentFormCsv);
  }

  const filePath = await resolveLatestRecentFormFilePath();
  if (!filePath) {
    return `${RECENT_FORM_DATA_PARSER_VERSION}:none`;
  }
  const stats = await fs.stat(filePath);
  return `${RECENT_FORM_DATA_PARSER_VERSION}:${path.basename(filePath)}:${stats.size}:${Math.trunc(stats.mtimeMs)}`;
}

function getSgColumnForStatKey(statKey) {
  if (statKey === 'sg_t2g') return 'sg_t2g_pred|t2g_true|derived:sg_ott_pred+sg_app_pred+sg_arg_pred|derived:ott_true+app_true+arg_true';
  return [SG_CSV_COLUMN_BY_STAT_KEY[statKey], DG_SKILL_RATING_COLUMN_BY_STAT_KEY[statKey]].filter(Boolean).join('|') || null;
}

function getSgStatValueFromRow(row, statKey) {
  if (statKey === 'sg_t2g') {
    const direct = toSgNumberOrNull(getRowValueByColumn(row, 'sg_t2g_pred') ?? getRowValueByColumn(row, 't2g_true'));
    if (Number.isFinite(direct)) return direct;
    const sgOffTheTee = toSgNumberOrNull(getRowValueByColumn(row, 'sg_ott_pred') ?? getRowValueByColumn(row, 'ott_true'));
    const sgApproach = toSgNumberOrNull(getRowValueByColumn(row, 'sg_app_pred') ?? getRowValueByColumn(row, 'app_true'));
    const sgAroundGreen = toSgNumberOrNull(getRowValueByColumn(row, 'sg_arg_pred') ?? getRowValueByColumn(row, 'arg_true'));
    if ([sgOffTheTee, sgApproach, sgAroundGreen].every((value) => Number.isFinite(value))) {
      return sgOffTheTee + sgApproach + sgAroundGreen;
    }
    return null;
  }

  const primaryColumn = SG_CSV_COLUMN_BY_STAT_KEY[statKey];
  const dgColumn = DG_SKILL_RATING_COLUMN_BY_STAT_KEY[statKey];
  return toSgNumberOrNull(getRowValueByColumn(row, primaryColumn) ?? getRowValueByColumn(row, dgColumn));
}

async function loadStrokesGainedRowsFromCsv(uploadedSgCsvInput) {
  return resolveSgDataset(uploadedSgCsvInput);
}

function buildPlayerStatMapFromSgDataset(sgDataset, statKey) {
  const byPlayer = {};
  sgDataset.players.forEach((player) => {
    const value = Number(player?.values?.[statKey]);
    if (!Number.isFinite(value)) return;
    byPlayer[player.normalizedName] = value;
  });
  return byPlayer;
}

function buildPlayerStatMapFromRecentFormDataset(recentFormDataset, statKey) {
  const byPlayer = {};
  recentFormDataset.players.forEach((player) => {
    const value = Number(player?.values?.[statKey]);
    if (!Number.isFinite(value)) return;
    byPlayer[player.normalizedName] = value;
  });
  return byPlayer;
}

function computeFieldMean(playerValues) {
  const values = Object.values(playerValues).filter((value) => Number.isFinite(value));
  if (!values.length) return 0;
  const total = values.reduce((accumulator, value) => accumulator + value, 0);
  return total / values.length;
}

async function scrapeRoundLeaderProjectionStats(selectedStats, options = {}) {
  const { uploadedSgCsv, uploadedRecentFormCsv } = options;
  const statKeys = selectedStats.filter((key) => key !== 'course_hole_model');
  if (!statKeys.length) {
    return {
      byStatKey: {},
      fieldMeans: {},
      sourceStats: [],
      sgNameRows: [],
      recentFormNameRows: [],
      sgDataFile: null,
      recentFormDataFile: null,
      fetchedAt: new Date().toISOString(),
    };
  }

  const byStatKey = {};
  const fieldMeans = {};
  const sourceStats = [];
  let sgDataset = null;
  let recentFormDataset = null;

  for (const statKey of statKeys) {
    const config = STAT_KEY_CONFIG[statKey];
    if (!config) continue;

    if (config.group === 'sg') {
      if (!sgDataset) {
        sgDataset = await loadStrokesGainedRowsFromCsv(uploadedSgCsv);
      }

      const playerMap = buildPlayerStatMapFromSgDataset(sgDataset, statKey);
      byStatKey[statKey] = playerMap;
      fieldMeans[statKey] = computeFieldMean(playerMap);
      sourceStats.push({
        key: statKey,
        label: config.label,
        source: sgDataset.source || 'local_csv',
        fileName: sgDataset.fileName,
        column: getSgColumnForStatKey(statKey),
      });
      continue;
    }

    if (config.group === 'recent_form') {
      if (!recentFormDataset) {
        recentFormDataset = await resolveRecentFormDataset(uploadedRecentFormCsv);
      }

      const playerMap = buildPlayerStatMapFromRecentFormDataset(recentFormDataset, statKey);
      byStatKey[statKey] = playerMap;
      fieldMeans[statKey] = computeFieldMean(playerMap);
      sourceStats.push({
        key: statKey,
        label: config.label,
        source: recentFormDataset.source || 'local_csv',
        fileName: recentFormDataset.fileName,
        column: RECENT_FORM_COLUMN_BY_STAT_KEY[statKey],
      });
      continue;
    }

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
      source: 'pga_fetch',
    });
  }

  return {
    byStatKey,
    fieldMeans,
    sourceStats,
    sgNameRows: sgDataset
      ? sgDataset.players.map((player) => ({
          sourceName: player.sourceName,
          normalizedName: player.normalizedName,
          tokenKey: player.tokenKey,
          tokenCount: player.tokenCount,
          initialsSignature: player.initialsSignature,
        }))
      : [],
    recentFormNameRows: recentFormDataset
      ? recentFormDataset.players.map((player) => ({
          sourceName: player.sourceName,
          normalizedName: player.normalizedName,
          tokenKey: player.tokenKey,
          tokenCount: player.tokenCount,
          initialsSignature: player.initialsSignature,
          trueSgL20: Number.isFinite(player.trueSgL20) ? player.trueSgL20 : null,
        }))
      : [],
    sgDataFile: sgDataset
      ? {
          fileName: sgDataset.fileName,
          versionKey: sgDataset.versionKey,
          source: sgDataset.source || 'local_csv',
        }
      : null,
    recentFormDataFile: recentFormDataset
      ? {
          fileName: recentFormDataset.fileName,
          versionKey: recentFormDataset.versionKey,
          source: recentFormDataset.source || 'local_csv',
        }
      : null,
    fetchedAt: new Date().toISOString(),
  };
}

function validateUploadedSgCsv(uploadedSgCsvInput) {
  const uploadedSgCsv = normalizeUploadedSgCsv(uploadedSgCsvInput);
  if (!uploadedSgCsv) {
    throw createHttpError(400, 'uploadedSgCsv is required.');
  }

  const validation = validateSgCsvContent(uploadedSgCsv.fileName, uploadedSgCsv.content);
  return {
    fileName: uploadedSgCsv.fileName,
    rowCount: validation.rowCount,
    playerRowCount: validation.playerRowCount,
    usableSgRowCount: validation.usableSgRowCount,
    schemaKey: validation.schemaKey,
    schemaLabel: validation.schemaLabel,
    requiredColumns: validation.requiredColumns,
    acceptedSchemas: validation.acceptedSchemas,
  };
}

function validateUploadedRecentFormCsv(uploadedRecentFormCsvInput) {
  const uploadedRecentFormCsv = normalizeUploadedRecentFormCsv(uploadedRecentFormCsvInput);
  if (!uploadedRecentFormCsv) {
    throw createHttpError(400, 'uploadedRecentFormCsv is required.');
  }

  const validation = validateRecentFormCsvContent(uploadedRecentFormCsv.fileName, uploadedRecentFormCsv.content);
  return {
    fileName: uploadedRecentFormCsv.fileName,
    rowCount: validation.rowCount,
    playerRowCount: validation.playerRowCount,
    usableRecentFormRowCount: validation.usableRecentFormRowCount,
    schemaKey: validation.schemaKey,
    schemaLabel: validation.schemaLabel,
    requiredColumns: validation.requiredColumns,
    acceptedSchemas: validation.acceptedSchemas,
  };
}

function getStatConfigByKey(statKey) {
  return STAT_KEY_CONFIG[statKey] || null;
}

module.exports = {
  DEFAULT_SELECTED_STATS,
  RECENT_FORM_STAT_KEYS,
  SG_STAT_KEYS,
  getRoundLeaderProjectionRecentFormDataVersionKey,
  getRoundLeaderProjectionSgDataVersionKey,
  getStatConfigByKey,
  normalizePlayerName,
  normalizeStatSelection,
  scrapeRoundLeaderProjectionStats,
  validateUploadedRecentFormCsv,
  validateUploadedSgCsv,
};
