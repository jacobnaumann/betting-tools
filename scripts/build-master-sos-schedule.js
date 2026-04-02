const fs = require('node:fs/promises');
const path = require('node:path');
const XLSX = require('xlsx');

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

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    sourceDir: path.resolve(
      process.cwd(),
      'multi-season-team-stats',
      'normalized-names-stats',
      'master-stats',
      'sos'
    ),
    outputCsvFile: '',
    outputXlsxFile: '',
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--source-dir' && next) {
      out.sourceDir = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (arg === '--output-csv-file' && next) {
      out.outputCsvFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (arg === '--output-xlsx-file' && next) {
      out.outputXlsxFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
  }

  return out;
}

async function run() {
  const config = parseArgs();
  const fileNames = (await fs.readdir(config.sourceDir))
    .filter((name) => /^NCAA_D1_Team_Stats_\d{4}-\d{2}-stats-sos\.csv$/.test(name))
    .sort();

  if (fileNames.length === 0) {
    throw new Error(`No season SOS CSV files found in ${config.sourceDir}`);
  }

  const firstSeason = fileNames[0].match(/NCAA_D1_Team_Stats_(\d{4}-\d{2})-stats-sos\.csv$/)[1];
  const lastSeason = fileNames[fileNames.length - 1].match(/NCAA_D1_Team_Stats_(\d{4}-\d{2})-stats-sos\.csv$/)[1];
  if (!config.outputCsvFile) {
    config.outputCsvFile = path.resolve(
      config.sourceDir,
      `NCAA_D1_Master_Schedule_SOS_${firstSeason}_to_${lastSeason}.csv`
    );
  }
  if (!config.outputXlsxFile) {
    config.outputXlsxFile = path.resolve(
      config.sourceDir,
      `NCAA_D1_Master_Schedule_SOS_${firstSeason}_to_${lastSeason}.xlsx`
    );
  }

  let header = [];
  const outputRows = [];
  for (const fileName of fileNames) {
    const fullPath = path.join(config.sourceDir, fileName);
    const raw = await fs.readFile(fullPath, 'utf8');
    const lines = raw.replace(/\uFEFF/g, '').trim().split(/\r?\n/);
    if (lines.length < 2) {
      throw new Error(`No data rows found in ${fullPath}`);
    }

    const fileHeader = parseCsvLine(lines[0]);
    if (header.length === 0) {
      header = fileHeader;
    } else if (header.join(',') !== fileHeader.join(',')) {
      throw new Error(`Header mismatch in ${fullPath}`);
    }

    for (const line of lines.slice(1)) {
      const cells = parseCsvLine(line);
      const row = {};
      for (let i = 0; i < header.length; i += 1) {
        row[header[i]] = cells[i] || '';
      }
      outputRows.push(row);
    }
  }

  const csvLines = [toCsvLine(header)];
  for (const row of outputRows) {
    csvLines.push(toCsvLine(header.map((column) => row[column])));
  }
  await fs.writeFile(config.outputCsvFile, `${csvLines.join('\n')}\n`, 'utf8');

  const worksheet = XLSX.utils.json_to_sheet(outputRows, { header });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'master_sos_stats');
  XLSX.writeFile(workbook, config.outputXlsxFile);

  console.log(`Season files merged: ${fileNames.length}`);
  console.log(`Rows written: ${outputRows.length}`);
  console.log(`CSV: ${config.outputCsvFile}`);
  console.log(`XLSX: ${config.outputXlsxFile}`);
}

run().catch((error) => {
  console.error('Failed to build master SOS schedule file:', error);
  process.exit(1);
});
