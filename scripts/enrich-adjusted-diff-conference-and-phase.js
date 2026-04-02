const fs = require('node:fs/promises');
const path = require('node:path');
const xlsx = require('xlsx');

const SEASON_START_MIN = 2016;
const SEASON_START_MAX = 2025;
const CONFERENCE_SLUGS_2016_TO_2025 = [
  'acc',
  'america-east',
  'american',
  'atlantic-10',
  'atlantic-sun',
  'big-12',
  'big-east',
  'big-sky',
  'big-south',
  'big-ten',
  'big-west',
  'coastal',
  'cusa',
  'horizon',
  'ivy',
  'maac',
  'mac',
  'meac',
  'mvc',
  'mwc',
  'nec',
  'ovc',
  'pac-12',
  'patriot',
  'sec',
  'southern',
  'southland',
  'summit',
  'sun-belt',
  'swac',
  'wac',
  'wcc',
];

const TEAM_ALIASES = {
  'a and m corpus christi': 'texas a and m corpus christi',
  'alabama st': 'alabama state',
  'ark pine bluff': 'arkansas pine bluff',
  'arkansas st': 'arkansas state',
  'army west point': 'army',
  'ball st': 'ball state',
  'boise st': 'boise state',
  'boston u': 'boston university',
  'cal st fullerton': 'cal state fullerton',
  'central ark': 'central arkansas',
  'central conn st': 'central connecticut',
  'central mich': 'central michigan',
  'charleston so': 'charleston southern',
  'col of charleston': 'charleston',
  etsu: 'east tennessee state',
  'eastern ill': 'eastern illinois',
  'eastern ky': 'eastern kentucky',
  'eastern mich': 'eastern michigan',
  'eastern wash': 'eastern washington',
  fdu: 'fairleigh dickinson',
  fgcu: 'florida gulf coast',
  fiu: 'florida international',
  'fla atlantic': 'florida atlantic',
  'florida st': 'florida state',
  'ga southern': 'georgia southern',
  'illinois st': 'illinois state',
  'indiana st': 'indiana state',
  'iowa st': 'iowa state',
  'jackson st': 'jackson state',
  'jacksonville st': 'jacksonville state',
  'kansas st': 'kansas state',
  'kennesaw st': 'kennesaw state',
  'kent st': 'kent state',
  liu: 'long island university',
  'lmu ca': 'loyola marymount',
  lsu: 'louisiana state',
  'middle tenn': 'middle tennessee',
  'mississippi st': 'mississippi state',
  'missouri st': 'missouri state',
  'montana st': 'montana state',
  'morehead st': 'morehead state',
  'morgan st': 'morgan state',
  'mount st marys': 'mount st marys',
  'nc a and t': 'north carolina a and t',
  'nc central': 'north carolina central',
  'nc state': 'north carolina state',
  niu: 'northern illinois',
  'north ala': 'north alabama',
  'north dakota st': 'north dakota state',
  'northern ariz': 'northern arizona',
  'northern colo': 'northern colorado',
  'northern ky': 'northern kentucky',
  'northwestern st': 'northwestern state',
  'ohio st': 'ohio state',
  'oklahoma st': 'oklahoma state',
  'ole miss': 'mississippi',
  penn: 'pennsylvania',
  'penn st': 'penn state',
  'portland st': 'portland state',
  sfa: 'stephen f austin',
  siue: 'siu edwardsville',
  smu: 'southern methodist',
  'sacramento st': 'sacramento state',
  'saint francis': 'saint francis pa',
  'sam houston': 'sam houston state',
  'san diego st': 'san diego state',
  'san jose st': 'san jose state',
  'se louisiana': 'southeastern louisiana',
  'south carolina st': 'south carolina state',
  'south dakota st': 'south dakota state',
  'south fla': 'south florida',
  'southeast mo st': 'southeast missouri state',
  'southern ill': 'southern illinois',
  'southern ind': 'southern indiana',
  'southern miss': 'southern mississippi',
  'southern u': 'southern',
  'st bonaventure': 'saint bonaventure',
  'st johns': 'saint johns ny',
  'st josephs': 'saint josephs',
  'st marys ca': 'saint marys ca',
  'st peters': 'saint peters',
  'st thomas': 'saint thomas mn',
  'tarleton st': 'tarleton state',
  'tennessee st': 'tennessee state',
  'texas st': 'texas state',
  'the citadel': 'citadel',
  'ut arlington': 'texas arlington',
  'ut martin': 'tennessee martin',
  ualbany: 'albany',
  uconn: 'connecticut',
  uic: 'illinois chicago',
  uiw: 'incarnate word',
  ulm: 'louisiana monroe',
  umbc: 'maryland baltimore county',
  umes: 'maryland eastern shore',
  'umass lowell': 'massachusetts lowell',
  'unc asheville': 'north carolina asheville',
  'unc greensboro': 'north carolina greensboro',
  'unc wilmington': 'north carolina wilmington',
  uncw: 'north carolina wilmington',
  uni: 'northern iowa',
  unlv: 'nevada las vegas',
  'usc upstate': 'south carolina upstate',
  utep: 'texas el paso',
  utrgv: 'texas rio grande valley',
  utsa: 'texas san antonio',
  'utah st': 'utah state',
  vcu: 'virginia commonwealth',
  'west ga': 'west georgia',
  'western caro': 'western carolina',
  'western ill': 'western illinois',
  'western ky': 'western kentucky',
  'western mich': 'western michigan',
  'wichita st': 'wichita state',
  'wright st': 'wright state',
  'youngstown st': 'youngstown state',
};

const MANUAL_TEAM_CONFERENCE_OVERRIDES = [
  { team: 'App State', conference: 'sun-belt' },
  { team: 'Alcorn', conference: 'swac' },
  { team: 'CSU Bakersfield', conference: 'wac', fromEndYear: 2014, toEndYear: 2020 },
  { team: 'CSU Bakersfield', conference: 'big-west', fromEndYear: 2021, toEndYear: 2026 },
  { team: 'Central Conn. St.', conference: 'nec' },
  { team: 'Col. of Charleston', conference: 'coastal' },
  { team: 'UAlbany', conference: 'america-east' },
  { team: 'Bellarmine', conference: 'atlantic-sun' },
  { team: 'BYU', conference: 'wcc', fromEndYear: 2012, toEndYear: 2023 },
  { team: 'BYU', conference: 'big-12', fromEndYear: 2024, toEndYear: 2026 },
  { team: 'CSUN', conference: 'big-west' },
  { team: 'Le Moyne', conference: 'nec' },
  { team: 'Lindenwood', conference: 'ovc' },
  { team: 'Loyola Maryland', conference: 'patriot' },
  { team: 'Loyola Chicago', conference: 'mvc', fromEndYear: 2014, toEndYear: 2022 },
  { team: 'Loyola Chicago', conference: 'atlantic-10', fromEndYear: 2023, toEndYear: 2026 },
  { team: 'Merrimack', conference: 'nec', fromEndYear: 2020, toEndYear: 2024 },
  { team: 'Merrimack', conference: 'maac', fromEndYear: 2025, toEndYear: 2026 },
  { team: 'Mississippi Val', conference: 'swac' },
  { team: 'New Haven', conference: 'nec' },
  { team: 'Nicholls', conference: 'southland' },
  { team: 'Prairie View', conference: 'swac' },
  { team: 'Queens (NC)', conference: 'atlantic-sun' },
  { team: "Saint Mary's (CA)", conference: 'wcc' },
  { team: 'Seattle U', conference: 'wcc' },
  { team: 'SIUE', conference: 'ovc' },
  { team: 'Southeastern La.', conference: 'southland' },
  { team: 'Southern Ind.', conference: 'ovc', fromEndYear: 2023, toEndYear: 2026 },
  { team: 'St. Thomas (MN)', conference: 'summit', fromEndYear: 2022, toEndYear: 2026 },
  { team: 'Stonehill', conference: 'nec', fromEndYear: 2023, toEndYear: 2026 },
  { team: 'Tarleton', conference: 'wac', fromEndYear: 2021, toEndYear: 2026 },
  { team: 'TCU', conference: 'big-12' },
  { team: 'UC San Diego', conference: 'big-west', fromEndYear: 2021, toEndYear: 2026 },
  { team: 'Utah Tech', conference: 'wac', fromEndYear: 2021, toEndYear: 2026 },
  { team: 'VMI', conference: 'southern' },
  { team: 'West Ga.', conference: 'atlantic-sun', fromEndYear: 2025, toEndYear: 2026 },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    statsDir: path.resolve(process.cwd(), 'multi-season-team-stats/normalized-names-results'),
    xlsxDir: path.resolve(process.cwd(), 'NCAA Results/Raw results/adjusted-diff-excel-files'),
    reportFile: path.resolve(process.cwd(), 'output/adjusted-diff-conference-enrichment-report.json'),
    conferenceWorkbookFile: path.resolve(process.cwd(), 'output/team-conferences.xlsx'),
    conferenceCacheFile: path.resolve(process.cwd(), 'output/sports-reference-conference-membership-2016-2025.json'),
    refreshConferenceData: false,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--stats-dir' && next) {
      config.statsDir = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (arg === '--xlsx-dir' && next) {
      config.xlsxDir = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (arg === '--report-file' && next) {
      config.reportFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (arg === '--conference-workbook-file' && next) {
      config.conferenceWorkbookFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (arg === '--conference-cache-file' && next) {
      config.conferenceCacheFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (arg === '--refresh-conference-data') {
      config.refreshConferenceData = true;
      continue;
    }
    if (arg === '--dry-run') {
      config.dryRun = true;
      continue;
    }
  }

  return config;
}

function normalizeBase(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/'/g, '')
    .replace(/\./g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalVariants(name) {
  const base = normalizeBase(name);
  if (!base) {
    return [];
  }

  const variants = new Set([base]);
  const alias = TEAM_ALIASES[base];
  if (alias) {
    variants.add(normalizeBase(alias));
  }

  variants.add(base.replace(/\bsaint\b/g, 'st'));
  variants.add(base.replace(/\bst\b/g, 'saint'));
  variants.add(base.replace(/\bstate\b/g, 'st'));
  variants.add(base.replace(/\bst\b/g, 'state'));
  variants.add(base.replace(/\buniversity\b/g, ''));

  return [...variants].map((value) => value.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function parseCsvLine(line) {
  const output = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      output.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  output.push(current);
  return output;
}

function toCsvLine(values) {
  return values
    .map((value) => {
      if (value === null || value === undefined) return '';
      const text = String(value);
      if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    })
    .join(',');
}

function cleanCell(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\u00a0/g, ' ').trim();
}

function seasonPhaseFromMonth(value) {
  const month = Number(value);
  if ([10, 11, 12].includes(month)) return 'early';
  if ([1, 2].includes(month)) return 'mid';
  if ([3, 4].includes(month)) return 'late';
  return '';
}

function parseSeasonStartYearFromStatsFileName(fileName) {
  const match = String(fileName).match(/^NCAA_D1_Team_Stats_(\d{4})-\d{2}-results-names\.csv$/i);
  return match ? Number(match[1]) : null;
}

function parseSeasonStartYearFromXlsxFileName(fileName) {
  const match = String(fileName).match(/^ncaa-(\d{4})-\d{2}-adjusted-diff(?: - Copy)?\.xlsx$/i);
  return match ? Number(match[1]) : null;
}

function parseSeasonStartYearFromTeamMapFileName(fileName) {
  const match = String(fileName).match(/^team-name-map-(\d{4})-\d{2}\.csv$/i);
  return match ? Number(match[1]) : null;
}

function isOverrideInSeasonWindow(override, seasonStartYear) {
  const seasonEndYear = seasonStartYear + 1;
  if (Number.isInteger(override.fromEndYear) && seasonEndYear < override.fromEndYear) return false;
  if (Number.isInteger(override.toEndYear) && seasonEndYear > override.toEndYear) return false;
  return true;
}

function buildManualConferenceOverrideIndex() {
  const index = new Map();
  for (const override of MANUAL_TEAM_CONFERENCE_OVERRIDES) {
    const key = normalizeBase(override.team);
    if (!index.has(key)) {
      index.set(key, []);
    }
    index.get(key).push(override);
  }
  return index;
}

const MANUAL_CONFERENCE_OVERRIDE_INDEX = buildManualConferenceOverrideIndex();

function extractConferenceRowsFromWorkbook(workbookPath) {
  const workbook = xlsx.readFile(workbookPath);
  if (!workbook.SheetNames.length) {
    throw new Error(`Conference workbook has no sheets: ${workbookPath}`);
  }

  const rows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
    header: 1,
    raw: false,
    defval: '',
  });

  const sections = [];
  for (let i = 0; i < rows.length; i += 1) {
    const value = cleanCell(rows[i]?.[0]);
    if (!value || value.includes(',') || !CONFERENCE_SLUGS_2016_TO_2025.includes(value)) {
      continue;
    }
    sections.push({ slug: value, rowIndex: i });
  }
  if (!sections.length) {
    throw new Error(`Could not find conference sections in workbook: ${workbookPath}`);
  }

  return { rows, sections };
}

function parseConferenceMembershipFromWorkbook(workbookPath) {
  const { rows, sections } = extractConferenceRowsFromWorkbook(workbookPath);
  const membershipBySeason = new Map();
  const schoolVariantIndex = new Map();

  for (let seasonStart = SEASON_START_MIN; seasonStart <= SEASON_START_MAX; seasonStart += 1) {
    membershipBySeason.set(seasonStart, new Map());
  }

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex];
    const slug = section.slug;
    const start = section.rowIndex + 2;
    const endExclusive = sectionIndex + 1 < sections.length ? sections[sectionIndex + 1].rowIndex : rows.length;

    console.log(`Loading conference schools: ${slug}`);
    for (let rowIndex = start; rowIndex < endExclusive; rowIndex += 1) {
      const csvLine = cleanCell(rows[rowIndex]?.[0]);
      if (!csvLine) continue;

      const parsed = parseCsvLine(csvLine);
      const schoolName = cleanCell(parsed[1]);
      const fromYear = Number(cleanCell(parsed[2]));
      const toYear = Number(cleanCell(parsed[3]));
      if (!schoolName || !Number.isInteger(fromYear) || !Number.isInteger(toYear)) {
        continue;
      }

      for (const variant of canonicalVariants(schoolName)) {
        if (!schoolVariantIndex.has(variant)) {
          schoolVariantIndex.set(variant, new Set());
        }
        schoolVariantIndex.get(variant).add(schoolName);
      }

      for (let seasonStart = SEASON_START_MIN; seasonStart <= SEASON_START_MAX; seasonStart += 1) {
        const seasonEndYear = seasonStart + 1;
        if (seasonEndYear < fromYear || seasonEndYear > toYear) {
          continue;
        }
        const seasonMap = membershipBySeason.get(seasonStart);
        if (!seasonMap) continue;
        seasonMap.set(schoolName, slug);
      }
    }
  }

  return {
    membershipBySeason,
    schoolVariantIndex,
  };
}

function serializeConferenceData(conferenceData) {
  const membershipBySeason = {};
  for (const [seasonStart, map] of conferenceData.membershipBySeason.entries()) {
    membershipBySeason[String(seasonStart)] = Object.fromEntries(map.entries());
  }
  const schoolVariantIndex = {};
  for (const [variant, schools] of conferenceData.schoolVariantIndex.entries()) {
    schoolVariantIndex[variant] = [...schools];
  }
  return { membershipBySeason, schoolVariantIndex };
}

function deserializeConferenceData(raw) {
  const membershipBySeason = new Map();
  for (const [seasonStart, entries] of Object.entries(raw.membershipBySeason || {})) {
    membershipBySeason.set(Number(seasonStart), new Map(Object.entries(entries || {})));
  }
  const schoolVariantIndex = new Map();
  for (const [variant, schools] of Object.entries(raw.schoolVariantIndex || {})) {
    schoolVariantIndex.set(variant, new Set(Array.isArray(schools) ? schools : []));
  }
  return { membershipBySeason, schoolVariantIndex };
}

async function loadConferenceData(config) {
  try {
    console.log(`Loading conference workbook: ${config.conferenceWorkbookFile}`);
    return parseConferenceMembershipFromWorkbook(config.conferenceWorkbookFile);
  } catch (workbookError) {
    console.warn(`Conference workbook load failed (${workbookError.message}).`);
  }

  if (!config.refreshConferenceData) {
    try {
      console.log(`Loading cached conference data: ${config.conferenceCacheFile}`);
      const cachedRaw = await fs.readFile(config.conferenceCacheFile, 'utf8');
      const cached = JSON.parse(cachedRaw);
      return deserializeConferenceData(cached);
    } catch (_error) {
      // No cache found, fall through and scrape.
    }
  }

  throw new Error(
    `No conference data source available. Provide ${config.conferenceWorkbookFile} or a valid cached JSON file.`
  );
}

async function writeConferenceCacheFromWorkbook(config) {
  try {
    const data = parseConferenceMembershipFromWorkbook(config.conferenceWorkbookFile);
    const serialized = serializeConferenceData(data);
    await fs.writeFile(config.conferenceCacheFile, `${JSON.stringify(serialized, null, 2)}\n`, 'utf8');
  } catch (_error) {
    // cache writing is optional; ignore failures.
  }
}

async function run() {
  const config = parseArgs();
  console.log(`Starting enrichment (dryRun=${config.dryRun})`);
  const report = {
    generatedAtUtc: new Date().toISOString(),
    dryRun: config.dryRun,
    conferenceSource: config.conferenceWorkbookFile,
    statsFiles: [],
    resultsFiles: [],
    unresolvedStatsTeams: [],
  };

  const conferenceData = await loadConferenceData(config);
  await writeConferenceCacheFromWorkbook(config);
  const lookupFromStats = await enrichStatsFiles(config, conferenceData, report);
  const teamConferenceLookup = await buildResultsNameConferenceLookup(config, lookupFromStats);
  await enrichXlsxFiles(config, teamConferenceLookup, report);

  const uniqueUnresolved = new Map();
  for (const row of report.unresolvedStatsTeams) {
    const key = `${row.seasonStartYear}|${normalizeBase(row.team)}`;
    if (!uniqueUnresolved.has(key)) uniqueUnresolved.set(key, row);
  }
  report.unresolvedStatsTeams = [...uniqueUnresolved.values()].sort((a, b) => {
    if (a.seasonStartYear !== b.seasonStartYear) return a.seasonStartYear - b.seasonStartYear;
    return a.team.localeCompare(b.team);
  });

  await fs.writeFile(config.reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const statsRowsAssigned = report.statsFiles.reduce((sum, item) => sum + item.conferenceAssignedRows, 0);
  const resultRowsConferenceAssigned = report.resultsFiles.reduce((sum, item) => sum + item.isConferenceAssignedRows, 0);
  const resultRowsConferenceUnknown = report.resultsFiles.reduce((sum, item) => sum + item.isConferenceUnknownRows, 0);

  console.log(`Stats files processed: ${report.statsFiles.length}`);
  console.log(`Stats rows with conference set: ${statsRowsAssigned}`);
  console.log(`Results files processed: ${report.resultsFiles.length}`);
  console.log(`Results rows with is_conference set: ${resultRowsConferenceAssigned}`);
  console.log(`Results rows with unresolved conference pairing (set to is_conference=0): ${resultRowsConferenceUnknown}`);
  console.log(`Unresolved stats teams: ${report.unresolvedStatsTeams.length}`);
  console.log(`Report: ${config.reportFile}`);
}

run().catch((error) => {
  console.error('Failed to enrich adjusted-diff conference/phase columns:', error);
  process.exit(1);
});

function resolveConferenceSlugForTeam(teamName, seasonStartYear, conferenceData) {
  for (const variant of canonicalVariants(teamName)) {
    const overrides = MANUAL_CONFERENCE_OVERRIDE_INDEX.get(variant);
    if (!overrides || !overrides.length) continue;
    for (const override of overrides) {
      if (isOverrideInSeasonWindow(override, seasonStartYear)) {
        return override.conference;
      }
    }
  }

  const seasonMap = conferenceData.membershipBySeason.get(seasonStartYear);
  if (!seasonMap) return null;

  for (const variant of canonicalVariants(teamName)) {
    const schoolNames = conferenceData.schoolVariantIndex.get(variant);
    if (!schoolNames || !schoolNames.size) continue;
    for (const schoolName of schoolNames) {
      const slug = seasonMap.get(schoolName);
      if (slug) return slug;
    }
  }

  return null;
}

async function listFiles(targetDir, predicate) {
  const entries = await fs.readdir(targetDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => path.join(targetDir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

async function enrichStatsFiles(config, conferenceData, report) {
  const files = await listFiles(
    config.statsDir,
    (name) =>
      /^NCAA_D1_Team_Stats_\d{4}-\d{2}-results-names\.csv$/i.test(name) ||
      /^NCAA_D1_Team_Stats_\d{4}-\d{2}_to_\d{4}-\d{2}-results-names\.csv$/i.test(name)
  );

  const lookup = new Map();
  const unresolved = [];

  for (const filePath of files) {
    const fileName = path.basename(filePath);
    const seasonStartYear = parseSeasonStartYearFromStatsFileName(fileName);
    if (!Number.isInteger(seasonStartYear)) {
      continue;
    }

    const raw = await fs.readFile(filePath, 'utf8');
    const lines = raw.replace(/\uFEFF/g, '').trim().split(/\r?\n/);
    if (!lines.length) continue;

    const headers = parseCsvLine(lines[0]);
    const teamIdx = headers.indexOf('team');
    const conferenceIdxExisting = headers.indexOf('conference');
    if (teamIdx < 0) {
      continue;
    }

    const outHeaders = [...headers];
    const conferenceIdx =
      conferenceIdxExisting >= 0 ? conferenceIdxExisting : (outHeaders.push('conference'), outHeaders.length - 1);

    const outLines = [toCsvLine(outHeaders)];
    let fileAssigned = 0;

    for (let i = 1; i < lines.length; i += 1) {
      const cells = parseCsvLine(lines[i]);
      while (cells.length < outHeaders.length) cells.push('');

      const team = cleanCell(cells[teamIdx]);
      const conferenceSlug = resolveConferenceSlugForTeam(team, seasonStartYear, conferenceData);
      if (conferenceSlug) {
        cells[conferenceIdx] = conferenceSlug;
        fileAssigned += 1;
        lookup.set(`${seasonStartYear}|${normalizeBase(team)}`, conferenceSlug);
      } else if (team) {
        unresolved.push({ seasonStartYear, team, fileName });
      }

      outLines.push(toCsvLine(cells.slice(0, outHeaders.length)));
    }

    if (!config.dryRun) {
      await fs.writeFile(filePath, `${outLines.join('\n')}\n`, 'utf8');
    }

    report.statsFiles.push({
      fileName,
      rows: Math.max(lines.length - 1, 0),
      conferenceAssignedRows: fileAssigned,
    });
  }

  report.unresolvedStatsTeams = unresolved;
  return lookup;
}

async function buildResultsNameConferenceLookup(config, lookupFromStats) {
  const lookup = new Map(lookupFromStats);
  const teamMapFiles = await listFiles(config.statsDir, (name) => /^team-name-map-\d{4}-\d{2}\.csv$/i.test(name));

  for (const filePath of teamMapFiles) {
    const fileName = path.basename(filePath);
    const seasonStartYear = parseSeasonStartYearFromTeamMapFileName(fileName);
    if (!Number.isInteger(seasonStartYear)) continue;

    const raw = await fs.readFile(filePath, 'utf8');
    const lines = raw.replace(/\uFEFF/g, '').trim().split(/\r?\n/);
    if (lines.length < 2) continue;

    const headers = parseCsvLine(lines[0]);
    const statsTeamIdx = headers.indexOf('stats_team');
    const resultsTeamIdx = headers.indexOf('results_team');
    if (statsTeamIdx < 0 || resultsTeamIdx < 0) continue;

    for (let i = 1; i < lines.length; i += 1) {
      const cells = parseCsvLine(lines[i]);
      const statsTeam = cleanCell(cells[statsTeamIdx]);
      const resultsTeam = cleanCell(cells[resultsTeamIdx]);
      if (!statsTeam || !resultsTeam) continue;

      const conference = lookup.get(`${seasonStartYear}|${normalizeBase(statsTeam)}`);
      if (!conference) continue;
      lookup.set(`${seasonStartYear}|${normalizeBase(resultsTeam)}`, conference);
    }
  }

  return lookup;
}

function getHeaderIndex(headers, label) {
  return headers.findIndex((cell) => cleanCell(cell).toLowerCase() === label.toLowerCase());
}

function ensureColumn(headers, label) {
  const idx = getHeaderIndex(headers, label);
  if (idx >= 0) return idx;
  headers.push(label);
  return headers.length - 1;
}

async function enrichXlsxFiles(config, teamConferenceLookup, report) {
  const files = await listFiles(config.xlsxDir, (name) => /\.xlsx$/i.test(name));

  for (const filePath of files) {
    const fileName = path.basename(filePath);
    const seasonStartYear = parseSeasonStartYearFromXlsxFileName(fileName);
    if (!Number.isInteger(seasonStartYear)) {
      continue;
    }

    const workbook = xlsx.readFile(filePath);
    let fileSeasonPhaseAssigned = 0;
    let fileConferenceAssigned = 0;
    let fileConferenceUnknown = 0;

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: '' });
      if (!rows.length) continue;

      const header = Array.isArray(rows[0]) ? [...rows[0]] : [rows[0]];
      const teamIdx = getHeaderIndex(header, 'team');
      const oppIdx = getHeaderIndex(header, 'opponent');
      const monthIdx = getHeaderIndex(header, 'month');
      if (teamIdx < 0 || oppIdx < 0 || monthIdx < 0) {
        continue;
      }

      const isConferenceIdx = ensureColumn(header, 'is_conference');
      const seasonPhaseIdx = ensureColumn(header, 'season_phase');

      const outRows = [header];
      for (let i = 1; i < rows.length; i += 1) {
        const row = Array.isArray(rows[i]) ? [...rows[i]] : [rows[i]];
        while (row.length < header.length) row.push('');

        const team = cleanCell(row[teamIdx]);
        const opponent = cleanCell(row[oppIdx]);
        const month = cleanCell(row[monthIdx]);

        const teamConference = teamConferenceLookup.get(`${seasonStartYear}|${normalizeBase(team)}`) || null;
        const opponentConference = teamConferenceLookup.get(`${seasonStartYear}|${normalizeBase(opponent)}`) || null;

        if (teamConference && opponentConference) {
          row[isConferenceIdx] = teamConference === opponentConference ? 1 : 0;
          fileConferenceAssigned += 1;
        } else {
          // Treat unresolved pairings as non-conference by default.
          row[isConferenceIdx] = 0;
          fileConferenceUnknown += 1;
        }

        const seasonPhase = seasonPhaseFromMonth(month);
        row[seasonPhaseIdx] = seasonPhase;
        if (seasonPhase) fileSeasonPhaseAssigned += 1;

        outRows.push(row);
      }

      workbook.Sheets[sheetName] = xlsx.utils.aoa_to_sheet(outRows);
    }

    if (!config.dryRun) {
      xlsx.writeFile(workbook, filePath);
    }

    report.resultsFiles.push({
      fileName,
      seasonStartYear,
      seasonPhaseAssignedRows: fileSeasonPhaseAssigned,
      isConferenceAssignedRows: fileConferenceAssigned,
      isConferenceUnknownRows: fileConferenceUnknown,
    });
  }
}

