const fs = require('node:fs/promises');
const path = require('node:path');

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
      if (value === null || value === undefined) {
        return '';
      }
      const text = String(value);
      if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    })
    .join(',');
}

async function readCsv(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const lines = raw.replace(/\uFEFF/g, '').trim().split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row = {};
    for (let i = 0; i < headers.length; i += 1) {
      row[headers[i]] = cells[i] || '';
    }
    return row;
  });
  return { headers, rows };
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

const RESULT_ALIASES = {
  'a and m corpus christi': 'texas a and m corpus christi',
  'alabama st': 'alabama state',
  'app state': 'app state',
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
  'iu indy': 'iu indy',
  'jackson st': 'jackson state',
  'jacksonville st': 'jacksonville state',
  'kansas st': 'kansas state',
  'kennesaw st': 'kennesaw state',
  'kent st': 'kent state',
  liu: 'long island',
  'lmu ca': 'loyola marymount',
  'lamar university': 'lamar',
  lsu: 'louisiana state',
  'middle tenn': 'middle tennessee',
  'mississippi st': 'mississippi state',
  'mississippi val': 'mississippi valley state',
  'missouri st': 'missouri state',
  'montana st': 'montana state',
  'morehead st': 'morehead state',
  'morgan st': 'morgan state',
  'mount st marys': 'mount st marys',
  'nc a and t': 'north carolina a and t',
  'nc central': 'north carolina central',
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
  'penn st': 'penn state',
  'portland st': 'portland state',
  sfa: 'stephen f austin',
  siue: 'siu edwardsville',
  smu: 'southern methodist',
  'sacramento st': 'sacramento state',
  'san diego st': 'san diego state',
  'san jose st': 'san jose state',
  'south carolina st': 'south carolina state',
  'south dakota st': 'south dakota state',
  'south fla': 'south florida',
  'southeast mo st': 'southeast missouri state',
  'southeastern la': 'southeastern louisiana',
  'southern ill': 'southern illinois',
  'southern ind': 'southern indiana',
  'southern miss': 'southern mississippi',
  'southern u': 'southern',
  'southern california': 'usc',
  'st bonaventure': 'saint bonaventure',
  'st johns ny': 'saint johns',
  'st thomas mn': 'saint thomas',
  'st peters': 'saint peters',
  'st josephs': 'saint josephs',
  'st marys ca': 'saint marys',
  'tarleton st': 'tarleton state',
  'tennessee st': 'tennessee state',
  'texas st': 'texas state',
  'the citadel': 'citadel',
  'ut arlington': 'texas arlington',
  'ut martin': 'tenn martin',
  utep: 'texas el paso',
  utrgv: 'ut rio grande valley',
  utsa: 'texas san antonio',
  'utah st': 'utah state',
  'miami fl': 'miami',
  'miami oh': 'miami ohio',
  uconn: 'connecticut',
  ualbany: 'albany',
  uic: 'illinois chicago',
  uiw: 'incarnate word',
  ulm: 'ul monroe',
  umbc: 'umbc',
  umes: 'maryland eastern shore',
  'umass lowell': 'massachusetts lowell',
  'unc asheville': 'north carolina asheville',
  'unc greensboro': 'north carolina greensboro',
  uncw: 'unc wilmington',
  uni: 'northern iowa',
  unlv: 'unlv',
  'usc upstate': 'south carolina upstate',
  'queens nc': 'queens',
  'seattle u': 'seattle',
  vcu: 'vcu',
  'west ga': 'west georgia',
  'western caro': 'western carolina',
  'western ill': 'western illinois',
  'western ky': 'western kentucky',
  'western mich': 'western michigan',
  'wichita st': 'wichita state',
  'william and mary': 'william mary',
  'wright st': 'wright state',
  'youngstown st': 'youngstown state',
  csun: 'cal state northridge',
  'csu bakersfield': 'cal state bakersfield',
  'n c a and t': 'north carolina a and t',
};

function canonicalizeResultTokenStyle(value) {
  return normalizeBase(value)
    .replace(/\bsaint\b/g, 'st')
    .replace(/\bstate\b/g, 'st');
}

function canonicalizeResultVariants(name) {
  const base = canonicalizeResultTokenStyle(name);
  const variants = new Set([base]);
  const alias = RESULT_ALIASES[base];
  if (alias) {
    variants.add(canonicalizeResultTokenStyle(alias));
  }
  variants.add(base.replace(/\bst\b/g, 'state'));
  variants.add(base.replace(/\bst\b/g, 'saint'));
  return [...variants].filter(Boolean);
}

function canonicalizeStatsName(name) {
  return normalizeBase(name)
    .replace(/\bsaint\b/g, 'st')
    .replace(/\bstate\b/g, 'st')
    .replace(/\band\b/g, 'and');
}

function tokenize(value) {
  return canonicalizeStatsName(value).split(' ').filter(Boolean);
}

function buildStatsPrefixIndex(statsRows) {
  const index = new Map();
  for (const row of statsRows) {
    const canonical = canonicalizeStatsName(row.team);
    const canonicalVariants = new Set([canonical]);
    canonicalVariants.add(canonical.replace(/\bst\b/g, 'state'));
    canonicalVariants.add(canonical.replace(/\bst\b/g, 'saint'));

    for (const variant of canonicalVariants) {
      const tokens = variant.split(' ').filter(Boolean);
      for (let i = 1; i <= tokens.length; i += 1) {
        const key = tokens.slice(0, i).join(' ');
        if (!index.has(key)) {
          index.set(key, []);
        }
        index.get(key).push(row);
      }
    }
  }
  return index;
}

function diceCoefficient(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bgA = new Map();
  const bgB = new Map();
  for (let i = 0; i < a.length - 1; i += 1) {
    const pair = a.slice(i, i + 2);
    bgA.set(pair, (bgA.get(pair) || 0) + 1);
  }
  for (let i = 0; i < b.length - 1; i += 1) {
    const pair = b.slice(i, i + 2);
    bgB.set(pair, (bgB.get(pair) || 0) + 1);
  }
  let overlap = 0;
  for (const [pair, countA] of bgA.entries()) {
    const countB = bgB.get(pair) || 0;
    overlap += Math.min(countA, countB);
  }
  const sizeA = Math.max(0, a.length - 1);
  const sizeB = Math.max(0, b.length - 1);
  if (sizeA + sizeB === 0) return 0;
  return (2 * overlap) / (sizeA + sizeB);
}

function tokenJaccard(a, b) {
  const aTokens = new Set(a.split(' ').filter(Boolean));
  const bTokens = new Set(b.split(' ').filter(Boolean));
  if (aTokens.size === 0 && bTokens.size === 0) return 1;
  let intersect = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      intersect += 1;
    }
  }
  const union = aTokens.size + bTokens.size - intersect;
  return union > 0 ? intersect / union : 0;
}

function chooseBestFallback(resultCanonical, statsRows, usedStatsTeams) {
  let best = null;
  for (const row of statsRows) {
    if (usedStatsTeams.has(row.team)) {
      continue;
    }
    const statCanonical = canonicalizeStatsName(row.team);
    const dice = diceCoefficient(resultCanonical, statCanonical);
    const jaccard = tokenJaccard(resultCanonical, statCanonical);
    const score = dice * 0.7 + jaccard * 0.3;
    if (!best || score > best.score) {
      best = { row, score, method: 'fallback_fuzzy' };
    }
  }
  return best;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    statsFile: path.resolve(process.cwd(), 'NCAA_D1_Team_Stats_2025-26-final.csv'),
    resultsFile: path.resolve(process.cwd(), 'FINAL-RESULTS-2026-BY-DATE.csv'),
    outputFile: path.resolve(process.cwd(), 'team-name-map-2025-26.csv'),
    reviewFile: path.resolve(process.cwd(), 'team-name-map-2025-26-review-needed.csv'),
    minConfidence: 0.84,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--stats-file' && next) {
      out.statsFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (arg === '--results-file' && next) {
      out.resultsFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (arg === '--output-file' && next) {
      out.outputFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (arg === '--review-file' && next) {
      out.reviewFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (arg === '--min-confidence' && next) {
      out.minConfidence = Number(next);
      i += 1;
      continue;
    }
  }
  return out;
}

async function run() {
  const config = parseArgs();
  const stats = await readCsv(config.statsFile);
  const results = await readCsv(config.resultsFile);

  const resultNameSet = new Set();
  for (const row of results.rows) {
    resultNameSet.add(row.team);
    resultNameSet.add(row.opponent);
  }
  const resultNames = [...resultNameSet].sort((a, b) => a.localeCompare(b));

  const statsByTeam = new Map(stats.rows.map((row) => [row.team, row]));
  const prefixIndex = buildStatsPrefixIndex(stats.rows);
  const usedStatsTeams = new Set();
  const mappings = [];
  const reviewRows = [];

  const resultCandidates = resultNames.map((resultName) => {
    const canonicalVariants = canonicalizeResultVariants(resultName);
    const candidates = new Map();
    for (const canonical of canonicalVariants) {
      const rows = prefixIndex.get(canonical) || [];
      for (const row of rows) {
        candidates.set(row.team, row);
      }
    }
    return { resultName, canonical: canonicalVariants[0], canonicalVariants, candidates: [...candidates.values()] };
  });

  // Phase 1: assign one-candidate direct matches first.
  for (const entry of resultCandidates.filter((item) => item.candidates.length === 1)) {
    const row = entry.candidates[0];
    if (!row || usedStatsTeams.has(row.team)) {
      continue;
    }
    usedStatsTeams.add(row.team);
    mappings.push({
      results_team: entry.resultName,
      stats_team: row.team,
      team_slug: row.team_slug,
      method: 'prefix_exact',
      confidence: 1,
      needs_review: 'no',
    });
  }

  // Phase 2: assign multi-candidate direct matches (longer canonical names first).
  const multiEntries = resultCandidates
    .filter((item) => item.candidates.length > 1)
    .sort((a, b) => b.canonical.split(' ').length - a.canonical.split(' ').length);

  for (const entry of multiEntries) {
    if (mappings.some((mapped) => mapped.results_team === entry.resultName)) {
      continue;
    }
    const ranked = entry.candidates
      .filter((row) => !usedStatsTeams.has(row.team))
      .map((row) => {
        const statCanonical = canonicalizeStatsName(row.team);
        const statTokens = statCanonical.split(' ').filter(Boolean).length;
        const resultTokens = entry.canonical.split(' ').filter(Boolean).length;
        const tokenGap = statTokens - resultTokens;
        const score = 0.95 - Math.max(0, tokenGap) * 0.01;
        return { row, score, method: 'prefix_multi_bestfit' };
      })
      .sort((a, b) => b.score - a.score);

    if (ranked.length === 0) {
      continue;
    }
    const best = ranked[0];
    usedStatsTeams.add(best.row.team);
    mappings.push({
      results_team: entry.resultName,
      stats_team: best.row.team,
      team_slug: best.row.team_slug,
      method: best.method,
      confidence: Number(best.score.toFixed(4)),
      needs_review: best.score < config.minConfidence ? 'yes' : 'no',
    });
  }

  // Phase 3: fuzzy fallback only for still-unmapped result names.
  for (const entry of resultCandidates) {
    if (mappings.some((mapped) => mapped.results_team === entry.resultName)) {
      continue;
    }
    const best = chooseBestFallback(entry.canonical, stats.rows, usedStatsTeams);
    if (!best || !best.row) {
      reviewRows.push({
        results_team: entry.resultName,
        stats_team: '',
        team_slug: '',
        method: 'unmatched',
        confidence: 0,
      });
      continue;
    }
    usedStatsTeams.add(best.row.team);
    mappings.push({
      results_team: entry.resultName,
      stats_team: best.row.team,
      team_slug: best.row.team_slug,
      method: best.method,
      confidence: Number(best.score.toFixed(4)),
      needs_review: best.score < config.minConfidence ? 'yes' : 'no',
    });
  }

  // Inverse view (stats -> results) is easier for downstream replacement in stats CSV.
  const mappingsByStats = mappings
    .map((row) => ({
      stats_team: row.stats_team,
      team_slug: row.team_slug,
      results_team: row.results_team,
      method: row.method,
      confidence: row.confidence,
      needs_review: row.needs_review,
    }))
    .sort((a, b) => a.stats_team.localeCompare(b.stats_team));

  const assignedStats = new Set(mappingsByStats.map((row) => row.stats_team));
  for (const statsTeam of statsByTeam.keys()) {
    if (!assignedStats.has(statsTeam)) {
      reviewRows.push({
        results_team: '',
        stats_team: statsTeam,
        team_slug: statsByTeam.get(statsTeam).team_slug,
        method: 'unassigned_stats_team',
        confidence: 0,
      });
    }
  }

  for (const row of mappingsByStats) {
    if (row.needs_review === 'yes') {
      reviewRows.push({
        results_team: row.results_team,
        stats_team: row.stats_team,
        team_slug: row.team_slug,
        method: row.method,
        confidence: row.confidence,
      });
    }
  }

  const mappingHeader = ['stats_team', 'team_slug', 'results_team', 'method', 'confidence', 'needs_review'];
  const mappingLines = [toCsvLine(mappingHeader)];
  for (const row of mappingsByStats) {
    mappingLines.push(
      toCsvLine([
        row.stats_team,
        row.team_slug,
        row.results_team,
        row.method,
        row.confidence,
        row.needs_review,
      ])
    );
  }

  const reviewHeader = ['results_team', 'stats_team', 'team_slug', 'method', 'confidence'];
  const reviewLines = [toCsvLine(reviewHeader)];
  for (const row of reviewRows) {
    reviewLines.push(
      toCsvLine([row.results_team, row.stats_team, row.team_slug, row.method, row.confidence])
    );
  }

  await fs.writeFile(config.outputFile, `${mappingLines.join('\n')}\n`, 'utf8');
  await fs.writeFile(config.reviewFile, `${reviewLines.join('\n')}\n`, 'utf8');

  const reviewCount = reviewRows.length;
  console.log(`Mapped result names: ${mappings.length}`);
  console.log(`Output map: ${config.outputFile}`);
  console.log(`Review rows: ${reviewCount} (${config.reviewFile})`);
}

run().catch((error) => {
  console.error('Failed to build team name map:', error);
  process.exit(1);
});
