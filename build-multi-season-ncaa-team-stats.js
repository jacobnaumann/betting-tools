const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function seasonLabel(startYear) {
  const endShort = String(startYear + 1).slice(-2);
  return `${startYear}-${endShort}`;
}

function defaultCurrentSeasonStartYear() {
  const today = new Date();
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  return month >= 10 ? year : year - 1;
}

function parseInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const currentStartYear = defaultCurrentSeasonStartYear();
  const out = {
    seasonsBack: 8,
    endStartYear: currentStartYear,
    requestDelayMs: 2600,
    outputDir: path.resolve(process.cwd(), 'multi-season-team-stats'),
    combinedFile: '',
    combinedReportFile: '',
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--seasons-back' && next) {
      out.seasonsBack = parseInteger(next, out.seasonsBack);
      i += 1;
      continue;
    }
    if (arg === '--end-start-year' && next) {
      out.endStartYear = parseInteger(next, out.endStartYear);
      i += 1;
      continue;
    }
    if (arg === '--request-delay-ms' && next) {
      out.requestDelayMs = parseInteger(next, out.requestDelayMs);
      i += 1;
      continue;
    }
    if (arg === '--output-dir' && next) {
      out.outputDir = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (arg === '--combined-file' && next) {
      out.combinedFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (arg === '--combined-report-file' && next) {
      out.combinedReportFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
  }

  if (!Number.isInteger(out.seasonsBack) || out.seasonsBack < 1) {
    throw new Error(`Invalid --seasons-back: ${out.seasonsBack}`);
  }
  if (!Number.isInteger(out.endStartYear) || out.endStartYear < 2000) {
    throw new Error(`Invalid --end-start-year: ${out.endStartYear}`);
  }
  if (!Number.isInteger(out.requestDelayMs) || out.requestDelayMs < 500) {
    throw new Error(`Invalid --request-delay-ms: ${out.requestDelayMs}`);
  }

  const firstStartYear = out.endStartYear - out.seasonsBack + 1;
  if (!out.combinedFile) {
    out.combinedFile = path.resolve(
      out.outputDir,
      `NCAA_D1_Team_Stats_${seasonLabel(firstStartYear)}_to_${seasonLabel(out.endStartYear)}.csv`
    );
  }
  if (!out.combinedReportFile) {
    out.combinedReportFile = path.resolve(
      out.outputDir,
      `NCAA_D1_Team_Stats_${seasonLabel(firstStartYear)}_to_${seasonLabel(out.endStartYear)}-report.json`
    );
  }

  return out;
}

function runNodeScript(scriptPath, args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    stdio: 'inherit',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Script failed: ${path.basename(scriptPath)} (exit ${result.status})`);
  }
}

async function run() {
  const config = parseArgs();
  await fs.mkdir(config.outputDir, { recursive: true });

  const startYears = [];
  for (let year = config.endStartYear - config.seasonsBack + 1; year <= config.endStartYear; year += 1) {
    startYears.push(year);
  }

  const seasonOutputs = [];
  for (const startYear of startYears) {
    const label = seasonLabel(startYear);
    const outCsv = path.resolve(config.outputDir, `NCAA_D1_Team_Stats_${label}.csv`);
    const outReport = path.resolve(config.outputDir, `NCAA_D1_Team_Stats_${label}-validation.json`);

    console.log(`\n=== Building season ${label} ===`);
    runNodeScript(path.resolve(process.cwd(), 'scrape-teamrankings-ncaa-team-stats.js'), [
      `--start-year=${startYear}`,
      `--request-delay-ms=${config.requestDelayMs}`,
      `--output-file=${outCsv}`,
      `--report-file=${outReport}`,
    ]);
    seasonOutputs.push({ startYear, label, outCsv, outReport });
  }

  let combinedHeader = '';
  const combinedRows = [];
  for (const season of seasonOutputs) {
    const raw = await fs.readFile(season.outCsv, 'utf8');
    const lines = raw.trim().split(/\r?\n/);
    if (lines.length < 2) {
      throw new Error(`No data rows found in ${season.outCsv}`);
    }
    if (!combinedHeader) {
      combinedHeader = lines[0];
    } else if (combinedHeader !== lines[0]) {
      throw new Error(`Header mismatch in ${season.outCsv}`);
    }
    combinedRows.push(...lines.slice(1));
  }

  await fs.writeFile(config.combinedFile, `${combinedHeader}\n${combinedRows.join('\n')}\n`, 'utf8');

  const report = {
    seasonsBuilt: seasonOutputs.map((s) => s.label),
    seasonCount: seasonOutputs.length,
    rowsWritten: combinedRows.length,
    combinedFile: config.combinedFile,
    generatedAtUtc: new Date().toISOString(),
  };
  await fs.writeFile(config.combinedReportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`\nWrote combined dataset: ${config.combinedFile}`);
  console.log(`Wrote combined report: ${config.combinedReportFile}`);
}

run().catch((error) => {
  console.error('Failed to build multi-season team stats dataset:', error);
  process.exit(1);
});
