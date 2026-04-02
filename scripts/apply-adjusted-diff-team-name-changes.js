const fs = require('node:fs/promises');
const path = require('node:path');
const xlsx = require('xlsx');

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    changesFile: path.resolve(process.cwd(), 'output/team-name-changes.txt'),
    inputDir: path.resolve(
      process.cwd(),
      'NCAA Results/Raw results/adjusted-diff-excel-files'
    ),
    dryRun: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === '--changes-file' && next) {
      config.changesFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (arg === '--input-dir' && next) {
      config.inputDir = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (arg === '--dry-run') {
      config.dryRun = true;
      continue;
    }
  }

  return config;
}

function cleanCell(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).replace(/\u00a0/g, ' ').trim();
}

function parseChangesFile(rawText) {
  const renameMap = new Map();
  const removeSet = new Set();

  const lines = rawText.replace(/\uFEFF/g, '').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const match = /^(.*?)\s+-\s+(.*)$/.exec(trimmed);
    if (!match) {
      throw new Error(`Invalid change line format: "${line}"`);
    }

    const source = cleanCell(match[1]);
    let target = cleanCell(match[2]).replace(/\s+\(add to team map\)\s*$/i, '');

    if (!source || !target) {
      throw new Error(`Invalid change mapping: "${line}"`);
    }

    if (target.toLowerCase() === 'remove') {
      removeSet.add(source);
      continue;
    }

    if (renameMap.has(source) && renameMap.get(source) !== target) {
      throw new Error(`Conflicting rename mappings for "${source}"`);
    }
    renameMap.set(source, target);
  }

  return { renameMap, removeSet };
}

function getTargetColumnIndexes(headerRow, sampleRowLength) {
  if (!Array.isArray(headerRow)) {
    return [...Array(sampleRowLength).keys()];
  }

  const teamIdx = headerRow.findIndex(
    (cell) => cleanCell(cell).toLowerCase() === 'team'
  );
  const oppIdx = headerRow.findIndex(
    (cell) => cleanCell(cell).toLowerCase() === 'opponent'
  );

  const indexes = [teamIdx, oppIdx].filter((idx) => idx >= 0);
  if (indexes.length > 0) {
    return indexes;
  }

  return [...Array(sampleRowLength).keys()];
}

function processSheetRows(rows, renameMap, removeSet) {
  if (!rows.length) {
    return {
      outputRows: rows,
      removedRows: 0,
      renameHits: new Map(),
    };
  }

  const headerRow = rows[0];
  const firstDataRow = rows[1] || [];
  const targetIndexes = getTargetColumnIndexes(headerRow, firstDataRow.length);

  const outputRows = [headerRow];
  let removedRows = 0;
  const renameHits = new Map();

  for (let i = 1; i < rows.length; i += 1) {
    const row = Array.isArray(rows[i]) ? [...rows[i]] : [rows[i]];
    const candidateValues = targetIndexes.map((idx) => cleanCell(row[idx]));

    const shouldRemove = candidateValues.some((value) => removeSet.has(value));
    if (shouldRemove) {
      removedRows += 1;
      continue;
    }

    for (const idx of targetIndexes) {
      const current = cleanCell(row[idx]);
      const mapped = renameMap.get(current);
      if (!mapped) {
        continue;
      }
      row[idx] = mapped;
      renameHits.set(current, (renameHits.get(current) || 0) + 1);
    }

    outputRows.push(row);
  }

  return { outputRows, removedRows, renameHits };
}

async function listXlsxFiles(inputDir) {
  const entries = await fs.readdir(inputDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.xlsx'))
    .map((entry) => path.join(inputDir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

function mergeRenameHits(overall, perSheet) {
  for (const [name, count] of perSheet.entries()) {
    overall.set(name, (overall.get(name) || 0) + count);
  }
}

async function run() {
  const config = parseArgs();
  const rawChanges = await fs.readFile(config.changesFile, 'utf8');
  const { renameMap, removeSet } = parseChangesFile(rawChanges);
  const files = await listXlsxFiles(config.inputDir);

  if (!files.length) {
    throw new Error(`No .xlsx files found in ${config.inputDir}`);
  }

  const overallRenameHits = new Map();
  let overallRemovedRows = 0;
  let overallRowsTouched = 0;

  for (const filePath of files) {
    const workbook = xlsx.readFile(filePath);
    let fileRemovedRows = 0;
    const fileRenameHits = new Map();

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json(worksheet, {
        header: 1,
        raw: true,
        defval: '',
      });

      const { outputRows, removedRows, renameHits } = processSheetRows(
        rows,
        renameMap,
        removeSet
      );
      fileRemovedRows += removedRows;
      mergeRenameHits(fileRenameHits, renameHits);

      workbook.Sheets[sheetName] = xlsx.utils.aoa_to_sheet(outputRows);
    }

    const fileRenameTotal = [...fileRenameHits.values()].reduce((sum, n) => sum + n, 0);
    const fileTouched = fileRemovedRows + fileRenameTotal;
    overallRemovedRows += fileRemovedRows;
    overallRowsTouched += fileTouched;
    mergeRenameHits(overallRenameHits, fileRenameHits);

    if (!config.dryRun && fileTouched > 0) {
      xlsx.writeFile(workbook, filePath);
    }

    const relPath = path.relative(process.cwd(), filePath);
    console.log(
      `${config.dryRun ? '[dry-run] ' : ''}${relPath}: renamed=${fileRenameTotal}, removed=${fileRemovedRows}`
    );
  }

  console.log('');
  console.log(`Files processed: ${files.length}`);
  console.log(`Total rows renamed: ${[...overallRenameHits.values()].reduce((s, n) => s + n, 0)}`);
  console.log(`Total rows removed: ${overallRemovedRows}`);
  console.log(`Total rows touched: ${overallRowsTouched}`);
  console.log(`Unique names renamed: ${overallRenameHits.size}`);
}

run().catch((error) => {
  console.error('Failed to apply adjusted-diff team changes:', error);
  process.exit(1);
});
