const fs = require('node:fs/promises');
const path = require('node:path');
const { load } = require('cheerio');
const XLSX = require('xlsx');

const TEAMRANKINGS_TEAM_URL_PREFIX = 'https://www.teamrankings.com/ncaa-basketball/team/';

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

function toAbsoluteUrl(urlLike) {
  if (!urlLike) {
    return '';
  }
  if (urlLike.startsWith('http')) {
    return urlLike;
  }
  return `https://www.teamrankings.com${urlLike}`;
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

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    teamsFile: path.resolve(process.cwd(), 'ncaa-teams.xlsx'),
    outputFile: '',
    startYear: 2025,
    limit: 0,
    maxRowsPerTeam: 0,
  };

  for (let i = 0; i < args.length; i += 1) {
    const current = args[i];
    const next = args[i + 1];
    if (current === '--teams-file' && next) {
      out.teamsFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (current === '--output-file' && next) {
      out.outputFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (current === '--start-year' && next) {
      out.startYear = Number(next);
      i += 1;
      continue;
    }
    if (current === '--limit' && next) {
      out.limit = Number(next);
      i += 1;
      continue;
    }
    if (current === '--max-rows-per-team' && next) {
      out.maxRowsPerTeam = Number(next);
      i += 1;
      continue;
    }
  }

  if (!out.outputFile) {
    const seasonLabel = `${out.startYear}_${out.startYear + 1}`;
    out.outputFile = path.resolve(process.cwd(), `NCAA_Hoops_Results_${seasonLabel}.csv`);
  }

  if (!Number.isInteger(out.startYear) || out.startYear < 2000) {
    throw new Error(`Invalid --start-year: ${out.startYear}`);
  }

  if (!Number.isInteger(out.limit) || out.limit < 0) {
    throw new Error(`Invalid --limit: ${out.limit}`);
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
  const seenUrls = new Set();
  if (rows.length > 0) {
    const headerKeys = Object.keys(rows[0]);
    const teamCol = headerKeys.find((key) => /team/i.test(key)) || headerKeys[0];
    const urlCol = headerKeys.find((key) => /(url|link|href)/i.test(key));

    if (teamCol && urlCol) {
      for (const row of rows) {
        const team = normalizeWhitespace(row[teamCol]);
        const url = normalizeWhitespace(row[urlCol]);
        if (!team || !url || !url.startsWith(TEAMRANKINGS_TEAM_URL_PREFIX)) {
          continue;
        }
        if (seenUrls.has(url)) {
          continue;
        }
        seenUrls.add(url);
        teams.push({ team, url });
      }
    }
  }

  if (teams.length === 0) {
    const linkCells = getWorkbookLinks(sheet);
    for (const entry of linkCells) {
      const team = normalizeWhitespace(entry.team);
      const url = normalizeWhitespace(entry.url);
      if (!team || !url || !url.startsWith(TEAMRANKINGS_TEAM_URL_PREFIX)) {
        continue;
      }
      if (seenUrls.has(url)) {
        continue;
      }
      seenUrls.add(url);
      teams.push({ team, url });
    }
  }

  if (teams.length === 0) {
    throw new Error(
      `No TeamRankings team links found in ${teamsFile}. Expected hyperlinks like ${TEAMRANKINGS_TEAM_URL_PREFIX}...`
    );
  }

  return teams;
}

function createD1Lookup(teams) {
  const set = new Set();
  for (const entry of teams) {
    set.add(normalizeTeamKey(entry.team));
    const slug = extractTeamSlug(entry.url);
    if (slug) {
      set.add(normalizeTeamKey(slug.replace(/-/g, ' ')));
    }
  }
  return set;
}

function locationToCode(locationText) {
  const value = normalizeWhitespace(locationText).toLowerCase();
  if (value === 'home') return 'H';
  if (value === 'away') return 'V';
  if (value === 'neutral') return 'N';
  return '';
}

function parseResultToScores(resultText) {
  const clean = normalizeWhitespace(resultText);
  const match = clean.match(/^([WL])\s+(\d+)\s*-\s*(\d+)$/i);
  if (!match) {
    return null;
  }
  const a = Number(match[2]);
  const b = Number(match[3]);
  // TeamRankings game-log Result is team-first regardless of W/L.
  const teamScore = a;
  const oppScore = b;
  return { teamScore, oppScore };
}

function parseDateParts(dateText, matchupHref, startYear) {
  const hrefDate = normalizeWhitespace(matchupHref).match(/-(\d{4})-(\d{2})-(\d{2})(?:$|[/?#])/);
  if (hrefDate) {
    return {
      year: Number(hrefDate[1]),
      month: Number(hrefDate[2]),
      day: Number(hrefDate[3]),
    };
  }

  const dateMatch = normalizeWhitespace(dateText).match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!dateMatch) {
    return null;
  }
  const month = Number(dateMatch[1]);
  const day = Number(dateMatch[2]);
  const year = month >= 11 ? startYear : startYear + 1;
  return { year, month, day };
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, maxAttempts = 4) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
          pragma: 'no-cache',
          'cache-control': 'no-cache',
        },
      });

      if (response.ok) {
        return response;
      }

      if (response.status === 403 || response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status} for ${url} (attempt ${attempt}/${maxAttempts})`);
        if (attempt < maxAttempts) {
          await sleep(attempt * 1200);
          continue;
        }
      } else {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxAttempts) {
        await sleep(attempt * 1200);
        continue;
      }
    }
  }

  throw lastError || new Error(`Failed to fetch ${url}`);
}

async function scrapeTeamRows(team, url) {
  const response = await fetchWithRetry(url);
  const html = await response.text();
  const $ = load(html);
  const tables = $('table').toArray();
  const targetTable = tables.find((table) => {
    const headers = $(table)
      .find('th')
      .toArray()
      .map((th) => normalizeWhitespace($(th).text()).toLowerCase());
    return (
      headers.includes('date') &&
      headers.includes('opponent') &&
      headers.includes('result') &&
      headers.includes('location')
    );
  });

  if (!targetTable) {
    throw new Error('Could not find results table with Date/Opponent/Result/Location headers.');
  }

  const headers = $(targetTable)
    .find('th')
    .toArray()
    .map((th) => normalizeWhitespace($(th).text()).toLowerCase());

  const dateIdx = headers.indexOf('date');
  const opponentIdx = headers.indexOf('opponent');
  const resultIdx = headers.indexOf('result');
  const locationIdx = headers.indexOf('location');

  if ([dateIdx, opponentIdx, resultIdx, locationIdx].some((idx) => idx < 0)) {
    throw new Error('Results table found, but one or more required columns are missing.');
  }

  const rowElements = $(targetTable).find('tbody tr').toArray();
  const rows = rowElements.map((row) => {
    const cells = $(row).find('td').toArray();
    const dateCell = cells[dateIdx];
    const opponentCell = cells[opponentIdx];
    const resultCell = cells[resultIdx];
    const locationCell = cells[locationIdx];

    const dateElement = dateCell ? $(dateCell) : null;
    const opponentElement = opponentCell ? $(opponentCell) : null;
    const resultElement = resultCell ? $(resultCell) : null;
    const locationElement = locationCell ? $(locationCell) : null;

    return {
      dateText: normalizeWhitespace(dateElement?.text() || ''),
      opponentText: normalizeWhitespace(opponentElement?.text() || ''),
      opponentHref: normalizeWhitespace(opponentElement?.find('a').attr('href') || ''),
      resultText: normalizeWhitespace(resultElement?.text() || ''),
      locationText: normalizeWhitespace(locationElement?.text() || ''),
      matchupHref: normalizeWhitespace(dateElement?.find('a').attr('href') || ''),
    };
  });

  return rows.map((row) => ({ ...row, team, teamUrl: url }));
}

function isInSeason(dateParts, startYear) {
  const seasonStart = Date.UTC(startYear, 10, 1);
  const seasonEnd = Date.UTC(startYear + 1, 3, 30, 23, 59, 59);
  const game = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day);
  return game >= seasonStart && game <= seasonEnd;
}

async function run() {
  const config = parseArgs();
  const teams = readTeamsFromWorkbook(config.teamsFile);
  const teamsToScrape = config.limit > 0 ? teams.slice(0, config.limit) : teams;
  const d1Lookup = createD1Lookup(teams);

  console.log(`Loaded ${teams.length} teams from workbook.`);
  console.log(`Scraping ${teamsToScrape.length} team pages...`);

  const outputRows = [];
  const errors = [];
  const unmatchedOpponents = new Map();
  const teamGameCounts = [];

  for (let i = 0; i < teamsToScrape.length; i += 1) {
    const { team, url } = teamsToScrape[i];
    console.log(`[${i + 1}/${teamsToScrape.length}] ${team}`);
    try {
      const scrapedRows = await scrapeTeamRows(team, url);
      let acceptedCount = 0;

      for (const row of scrapedRows) {
        if (config.maxRowsPerTeam > 0 && acceptedCount >= config.maxRowsPerTeam) {
          break;
        }

        const scores = parseResultToScores(row.resultText);
        if (!scores) {
          continue;
        }

        const dateParts = parseDateParts(row.dateText, row.matchupHref, config.startYear);
        if (!dateParts || !isInSeason(dateParts, config.startYear)) {
          continue;
        }

        const opponent = normalizeWhitespace(row.opponentText);
        if (!opponent) {
          continue;
        }

        const opponentHref = toAbsoluteUrl(row.opponentHref);
        const opponentSlug = extractTeamSlug(opponentHref);
        const hasD1OpponentLink = opponentHref.startsWith(TEAMRANKINGS_TEAM_URL_PREFIX);
        const normalizedOpponent = normalizeTeamKey(opponent);
        const normalizedSlug = normalizeTeamKey(opponentSlug.replace(/-/g, ' '));

        let d1 = 1;
        if (hasD1OpponentLink || d1Lookup.has(normalizedOpponent) || d1Lookup.has(normalizedSlug)) {
          d1 = 2;
        } else {
          const key = opponent;
          unmatchedOpponents.set(key, (unmatchedOpponents.get(key) || 0) + 1);
        }

        outputRows.push({
          year: dateParts.year,
          month: dateParts.month,
          day: dateParts.day,
          team,
          opponent,
          location: locationToCode(row.locationText),
          teamscore: scores.teamScore,
          oppscore: scores.oppScore,
          d1,
        });
        acceptedCount += 1;
      }

      teamGameCounts.push({ team, scrapedRows: scrapedRows.length, acceptedRows: acceptedCount, url });
    } catch (error) {
      errors.push({
        team,
        url,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    // Reduce chance of transient blocking from rapid sequential requests.
    await sleep(200);
  }

  outputRows.sort((a, b) => {
    if (a.team !== b.team) return a.team.localeCompare(b.team);
    if (a.year !== b.year) return a.year - b.year;
    if (a.month !== b.month) return a.month - b.month;
    return a.day - b.day;
  });

  const csvHeader = ['year', 'month', 'day', 'team', 'opponent', 'location', 'teamscore', 'oppscore', 'd1'];
  const csvLines = [toCsvLine(csvHeader)];
  for (const row of outputRows) {
    csvLines.push(
      toCsvLine([
        row.year,
        row.month,
        row.day,
        row.team,
        row.opponent,
        row.location,
        row.teamscore,
        row.oppscore,
        row.d1,
      ])
    );
  }

  const outputDir = path.dirname(config.outputFile);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(config.outputFile, `${csvLines.join('\n')}\n`, 'utf8');

  const reportBaseName = path.basename(config.outputFile, '.csv');
  const teamCountsPath = path.join(outputDir, `${reportBaseName}-team-game-counts.csv`);
  const errorsPath = path.join(outputDir, `${reportBaseName}-scrape-errors.json`);
  const unmatchedPath = path.join(outputDir, `${reportBaseName}-unmatched-opponents.csv`);

  const teamCountLines = [
    toCsvLine(['team', 'scrapedRows', 'acceptedRows', 'url']),
    ...teamGameCounts.map((entry) =>
      toCsvLine([entry.team, entry.scrapedRows, entry.acceptedRows, entry.url])
    ),
  ];
  await fs.writeFile(teamCountsPath, `${teamCountLines.join('\n')}\n`, 'utf8');
  await fs.writeFile(errorsPath, `${JSON.stringify(errors, null, 2)}\n`, 'utf8');

  const unmatchedLines = [toCsvLine(['opponent', 'count'])];
  for (const [opponent, count] of [...unmatchedOpponents.entries()].sort((a, b) => b[1] - a[1])) {
    unmatchedLines.push(toCsvLine([opponent, count]));
  }
  await fs.writeFile(unmatchedPath, `${unmatchedLines.join('\n')}\n`, 'utf8');

  console.log(`\nWrote ${outputRows.length} rows to ${config.outputFile}`);
  console.log(`Team counts: ${teamCountsPath}`);
  console.log(`Scrape errors: ${errorsPath} (${errors.length})`);
  console.log(`Unmatched opponents: ${unmatchedPath} (${unmatchedOpponents.size})`);
}

run().catch((error) => {
  console.error('Failed to build NCAA results CSV:', error);
  process.exit(1);
});
