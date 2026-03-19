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

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    statsFile: path.resolve(process.cwd(), 'NCAA_D1_Team_Stats_2025-26-final.csv'),
    mapFile: path.resolve(process.cwd(), 'team-name-map-2025-26.csv'),
    outputFile: path.resolve(process.cwd(), 'NCAA_D1_Team_Stats_2025-26-results-names.csv'),
    reportFile: path.resolve(process.cwd(), 'NCAA_D1_Team_Stats_2025-26-results-names-validation.json'),
    allowReviewRows: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--stats-file' && next) {
      out.statsFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (arg === '--map-file' && next) {
      out.mapFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (arg === '--output-file' && next) {
      out.outputFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (arg === '--report-file' && next) {
      out.reportFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (arg === '--allow-review-rows') {
      out.allowReviewRows = true;
      continue;
    }
  }
  return out;
}

async function run() {
  const config = parseArgs();
  const stats = await readCsv(config.statsFile);
  const map = await readCsv(config.mapFile);

  const nameMap = new Map();
  const reviewRows = [];
  for (const row of map.rows) {
    if (!row.stats_team || !row.results_team) {
      continue;
    }
    if (row.needs_review === 'yes') {
      reviewRows.push(row);
    }
    if (nameMap.has(row.stats_team)) {
      throw new Error(`Duplicate stats_team in map file: ${row.stats_team}`);
    }
    nameMap.set(row.stats_team, row.results_team);
  }

  if (!config.allowReviewRows && reviewRows.length > 0) {
    throw new Error(
      `Map file contains ${reviewRows.length} rows marked needs_review=yes. Rebuild/clean map or run with --allow-review-rows.`
    );
  }

  const outputRows = [];
  const unmappedStatsTeams = [];
  const outputTeamSet = new Set();
  for (const row of stats.rows) {
    const mapped = nameMap.get(row.team);
    if (!mapped) {
      unmappedStatsTeams.push(row.team);
      continue;
    }
    const outRow = {
      ...row,
      team_original: row.team,
      team: mapped,
    };
    outputRows.push(outRow);
    outputTeamSet.add(mapped);
  }

  if (unmappedStatsTeams.length > 0) {
    throw new Error(`Unmapped stats teams: ${unmappedStatsTeams.slice(0, 8).join(', ')}`);
  }

  const outputHeaders = [
    ...stats.headers.filter((header) => header !== 'team'),
    'team_original',
    'team',
  ];

  const lines = [toCsvLine(outputHeaders)];
  for (const row of outputRows) {
    lines.push(toCsvLine(outputHeaders.map((header) => row[header])));
  }
  await fs.writeFile(config.outputFile, `${lines.join('\n')}\n`, 'utf8');

  const report = {
    statsRows: stats.rows.length,
    mappedRows: outputRows.length,
    uniqueOutputTeams: outputTeamSet.size,
    reviewRowsInMap: reviewRows.length,
    generatedAtUtc: new Date().toISOString(),
  };
  await fs.writeFile(config.reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`Wrote aligned stats CSV: ${config.outputFile}`);
  console.log(`Validation report: ${config.reportFile}`);
}

run().catch((error) => {
  console.error('Failed to apply team name map:', error);
  process.exit(1);
});
