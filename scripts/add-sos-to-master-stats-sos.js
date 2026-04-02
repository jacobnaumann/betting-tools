const fs = require('node:fs/promises');
const path = require('node:path');
const { load } = require('cheerio');

const TEAMRANKINGS_BASE = 'https://www.teamrankings.com';
const SOS_PATH = '/ncaa-basketball/ranking/schedule-strength-by-other';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTeamSlug(url) {
  try {
    const parsed = new URL(url, TEAMRANKINGS_BASE);
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  } catch {
    return '';
  }
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

function seasonAsOfDate(startYear) {
  return `${startYear + 1}-04-15`;
}

async function fetchSosBySlug(startYear) {
  const asOfDate = seasonAsOfDate(startYear);
  const url = `${TEAMRANKINGS_BASE}${SOS_PATH}?date=${encodeURIComponent(asOfDate)}`;
  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      pragma: 'no-cache',
      'cache-control': 'no-cache',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed SOS fetch for ${startYear}: HTTP ${response.status}`);
  }
  const html = await response.text();
  const $ = load(html);
  const table = $('table').first();
  if (!table.length) {
    throw new Error(`No ranking table found for ${startYear}`);
  }

  const headers = table
    .find('th')
    .toArray()
    .map((th) => normalizeWhitespace($(th).text()).toLowerCase());
  const teamIdx = headers.findIndex((h) => h === 'team');
  const ratingIdx = headers.findIndex((h) => h === 'rating');
  if (teamIdx < 0 || ratingIdx < 0) {
    throw new Error(`Could not find Team/Rating columns for ${startYear}.`);
  }

  const bySlug = new Map();
  table.find('tbody tr').each((_, tr) => {
    const cells = $(tr).find('td').toArray();
    if (!cells[teamIdx] || !cells[ratingIdx]) {
      return;
    }
    const teamCell = $(cells[teamIdx]);
    const href = normalizeWhitespace(teamCell.find('a').attr('href') || '');
    const slug = extractTeamSlug(href);
    const ratingText = normalizeWhitespace($(cells[ratingIdx]).text()).replace(/,/g, '');
    const rating = Number(ratingText);
    if (!slug || !Number.isFinite(rating)) {
      return;
    }
    bySlug.set(slug, rating);
  });

  return bySlug;
}

async function run() {
  const baseDir = path.resolve(
    process.cwd(),
    'multi-season-team-stats',
    'normalized-names-stats',
    'master-stats',
    'sos'
  );
  const fileNames = (await fs.readdir(baseDir))
    .filter((name) => /^NCAA_D1_Team_Stats_\d{4}-\d{2}-stats-sos\.csv$/.test(name))
    .sort();

  if (fileNames.length === 0) {
    throw new Error(`No season CSVs found in ${baseDir}`);
  }

  for (const fileName of fileNames) {
    const fullPath = path.join(baseDir, fileName);
    const startYearMatch = fileName.match(/NCAA_D1_Team_Stats_(\d{4})-\d{2}-stats-sos\.csv$/);
    if (!startYearMatch) {
      continue;
    }
    const startYear = Number(startYearMatch[1]);
    const sosBySlug = await fetchSosBySlug(startYear);

    const raw = await fs.readFile(fullPath, 'utf8');
    const lines = raw.replace(/\uFEFF/g, '').trim().split(/\r?\n/);
    const headers = parseCsvLine(lines[0]);
    const rows = lines.slice(1).map(parseCsvLine);

    const slugIdx = headers.indexOf('team_slug');
    const paceIdx = headers.indexOf('pace');
    const sourceIdx = headers.indexOf('source');
    if (slugIdx < 0) {
      throw new Error(`team_slug column not found in ${fileName}`);
    }

    let outHeaders = [...headers];
    let sosIdx = outHeaders.indexOf('sos');
    if (sosIdx < 0) {
      const insertIdx =
        paceIdx >= 0 && sourceIdx > paceIdx ? sourceIdx : sourceIdx >= 0 ? sourceIdx : outHeaders.length;
      outHeaders.splice(insertIdx, 0, 'sos');
      sosIdx = insertIdx;
    }

    const outLines = [toCsvLine(outHeaders)];
    let missingCount = 0;
    for (const row of rows) {
      const outRow = [...row];
      while (outRow.length < headers.length) {
        outRow.push('');
      }

      const slug = normalizeWhitespace(outRow[slugIdx]);
      const sos = sosBySlug.get(slug);
      const sosText = Number.isFinite(sos) ? String(sos) : '';
      if (!sosText) {
        missingCount += 1;
      }

      if (headers.indexOf('sos') >= 0) {
        outRow[sosIdx] = sosText;
      } else {
        outRow.splice(sosIdx, 0, sosText);
      }

      outLines.push(toCsvLine(outRow));
    }

    await fs.writeFile(fullPath, `${outLines.join('\n')}\n`, 'utf8');
    console.log(`${fileName}: rows=${rows.length}, sos_missing=${missingCount}`);
  }
}

run().catch((error) => {
  console.error('Failed to add SOS to master stats files:', error);
  process.exit(1);
});
