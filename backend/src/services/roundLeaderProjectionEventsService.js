const fs = require('fs/promises');
const path = require('path');

const SCHEDULE_URL = 'https://www.pgatour.com/schedule';
const NEXT_DATA_REGEX = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/;
const TOURNAMENT_ANCHOR_REGEX = /<a[^>]*href="([^"]*\/tournaments\/[^"]*?)"[^>]*>([\s\S]*?)<\/a>/gi;
const PGA_URL_SUFFIXES = new Set(['leaderboard', 'tourcast', 'course-stats']);
const EVENTS_FILE_PATH = path.resolve(__dirname, '../../data/round-leader-projection-events.json');

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugifyTournamentName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeTournamentBaseUrl(inputUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(inputUrl, SCHEDULE_URL);
  } catch (_error) {
    return null;
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return null;
  }

  if (!parsedUrl.hostname.includes('pgatour.com')) {
    return null;
  }

  const segments = parsedUrl.pathname.split('/').filter(Boolean);
  if (!segments.length || segments[0] !== 'tournaments') {
    return null;
  }

  const lastSegment = String(segments[segments.length - 1] || '').toLowerCase();
  if (PGA_URL_SUFFIXES.has(lastSegment)) {
    segments.pop();
  }

  if (!segments.length) {
    return null;
  }

  parsedUrl.search = '';
  parsedUrl.hash = '';
  parsedUrl.pathname = `/${segments.join('/')}/`;
  return parsedUrl.toString();
}

function parseNextDataFromHtml(html) {
  const match = html.match(NEXT_DATA_REGEX);
  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch (_error) {
    return null;
  }
}

function toEventId(url) {
  const match = String(url || '').match(/\/(R\d{7})\/?$/i);
  return match?.[1] || null;
}

function buildEventNameFromUrl(url) {
  const segments = String(url).split('/').filter(Boolean);
  const slug = segments[2] || 'Tournament';
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeEventRecord(rawEvent) {
  if (!rawEvent) return null;

  const normalizedUrl = normalizeTournamentBaseUrl(
    rawEvent.tournamentUrl ||
      rawEvent.url ||
      rawEvent.href ||
      rawEvent.path ||
      rawEvent.link ||
      rawEvent.tournamentLink
  );
  if (!normalizedUrl) return null;

  const eventId = toEventId(normalizedUrl) || rawEvent.id || normalizedUrl;
  const eventName =
    stripHtml(rawEvent.eventName || rawEvent.tournamentName || rawEvent.name || rawEvent.title) ||
    buildEventNameFromUrl(normalizedUrl);
  const status =
    stripHtml(rawEvent.roundStatusDisplay || rawEvent.roundStatus || rawEvent.status || rawEvent.state) || null;
  const roundLabel = stripHtml(rawEvent.roundDisplay || rawEvent.round || rawEvent.currentRoundLabel) || null;
  const displayDate = stripHtml(rawEvent.dateDisplay || rawEvent.date || rawEvent.dateRange || rawEvent.week) || null;
  const startDate = stripHtml(rawEvent.startDate || rawEvent.startDateIso || rawEvent.startDateDisplay) || null;

  return {
    id: String(eventId),
    name: eventName,
    tournamentUrl: normalizedUrl,
    status,
    roundLabel,
    displayDate,
    startDate,
  };
}

function collectEventsFromNextData(value, accumulator) {
  if (!value) return;

  if (Array.isArray(value)) {
    value.forEach((item) => collectEventsFromNextData(item, accumulator));
    return;
  }

  if (typeof value !== 'object') return;

  const hasTournamentUrl = Object.values(value).some(
    (candidate) => typeof candidate === 'string' && candidate.includes('/tournaments/')
  );
  if (hasTournamentUrl) {
    const normalized = normalizeEventRecord(value);
    if (normalized) {
      accumulator.push(normalized);
    }
  }

  Object.values(value).forEach((nestedValue) => collectEventsFromNextData(nestedValue, accumulator));
}

function collectEventsFromHtmlAnchors(html) {
  const events = [];
  let match = TOURNAMENT_ANCHOR_REGEX.exec(html);
  while (match) {
    const normalizedUrl = normalizeTournamentBaseUrl(match[1]);
    if (normalizedUrl) {
      events.push(
        normalizeEventRecord({
          tournamentUrl: normalizedUrl,
          name: stripHtml(match[2]),
        })
      );
    }
    match = TOURNAMENT_ANCHOR_REGEX.exec(html);
  }

  return events.filter(Boolean);
}

function buildScheduleTournamentUrl(row) {
  const year = String(row?.year || '').trim();
  const tournamentId = String(row?.tournamentId || '').trim();
  const slug = slugifyTournamentName(row?.name);
  if (!year || !tournamentId || !slug) return null;
  return `https://www.pgatour.com/tournaments/${year}/${slug}/${tournamentId}/`;
}

function collectEventsFromScheduleQuery(nextData) {
  const queries = nextData?.props?.pageProps?.dehydratedState?.queries;
  if (!Array.isArray(queries)) return [];

  const scheduleQuery = queries.find((query) => query?.queryKey?.[0] === 'schedule');
  const scheduleTournaments = scheduleQuery?.state?.data?.tournaments;
  if (!Array.isArray(scheduleTournaments)) return [];

  return scheduleTournaments
    .map((row) =>
      normalizeEventRecord({
        id: row?.tournamentId,
        name: row?.name,
        status: row?.status,
        dateDisplay: row?.displayDate,
        startDate: toScheduleStartDate(row?.year, row?.displayDate),
        tournamentUrl: normalizeTournamentBaseUrl(row?.tournamentSiteUrl)
          ? row?.tournamentSiteUrl
          : buildScheduleTournamentUrl(row),
      })
    )
    .filter(Boolean);
}

function dedupeAndSortEvents(events) {
  const dedupedByIdentity = new Map();
  const dedupedByUrl = new Set();

  events.forEach((event) => {
    if (!event?.tournamentUrl) return;
    if (dedupedByUrl.has(event.tournamentUrl)) return;
    dedupedByUrl.add(event.tournamentUrl);

    const identityKey = String(event.id || event.tournamentUrl);
    const current = dedupedByIdentity.get(identityKey);
    if (!current) {
      dedupedByIdentity.set(identityKey, event);
      return;
    }

    dedupedByIdentity.set(identityKey, choosePreferredEvent(current, event));
  });

  const deduped = Array.from(dedupedByIdentity.values());

  return deduped.sort((a, b) => {
    const aStart = parseStartDateMs(a.startDate);
    const bStart = parseStartDateMs(b.startDate);
    if (aStart !== null && bStart !== null) {
      if (aStart !== bStart) return aStart - bStart;
      return a.name.localeCompare(b.name);
    }
    if (aStart !== null) return -1;
    if (bStart !== null) return 1;
    return a.name.localeCompare(b.name);
  });
}

function choosePreferredEvent(left, right) {
  const leftScore = getEventQualityScore(left);
  const rightScore = getEventQualityScore(right);
  if (rightScore > leftScore) return right;
  return left;
}

function getEventQualityScore(event) {
  let score = 0;
  if (event?.startDate) score += 5;
  if (event?.displayDate) score += 3;
  if (event?.status) score += 2;
  if (event?.roundLabel) score += 1;
  if (event?.name) score += 1;
  return score;
}

function parseStartDateMs(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toScheduleStartDate(year, displayDate) {
  const cleanedYear = Number(String(year || '').trim());
  const cleanedDisplay = String(displayDate || '').trim();
  if (!Number.isFinite(cleanedYear) || !cleanedDisplay) return null;

  const monthMatch = cleanedDisplay.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})/i);
  if (!monthMatch) return null;

  const monthByAbbreviation = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };

  const month = monthByAbbreviation[String(monthMatch[1]).toLowerCase()];
  const day = Number(monthMatch[2]);
  if (!month || !Number.isFinite(day)) return null;

  const date = new Date(Date.UTC(cleanedYear, month - 1, day));
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

async function scrapeScheduleEvents() {
  const response = await fetch(SCHEDULE_URL, {
    headers: {
      'user-agent': 'BetLab/1.0 (+https://localhost)',
      accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    throw createHttpError(502, `Failed to fetch PGA TOUR schedule (${response.status}).`);
  }

  const html = await response.text();
  const nextData = parseNextDataFromHtml(html);
  const nextDataEvents = [];
  const scheduleQueryEvents = nextData ? collectEventsFromScheduleQuery(nextData) : [];

  if (nextData) {
    collectEventsFromNextData(nextData, nextDataEvents);
  }

  const anchorEvents = collectEventsFromHtmlAnchors(html);
  const events = dedupeAndSortEvents([...scheduleQueryEvents, ...nextDataEvents, ...anchorEvents]);

  if (!events.length) {
    throw createHttpError(502, 'No PGA TOUR schedule events were found.');
  }

  return events;
}

async function writeEventsFile(events) {
  await fs.mkdir(path.dirname(EVENTS_FILE_PATH), { recursive: true });
  const payload = {
    sourceUrl: SCHEDULE_URL,
    updatedAt: new Date().toISOString(),
    events,
  };
  await fs.writeFile(EVENTS_FILE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

async function readEventsFile() {
  try {
    const raw = await fs.readFile(EVENTS_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      sourceUrl: parsed.sourceUrl || SCHEDULE_URL,
      updatedAt: parsed.updatedAt || null,
      events: Array.isArray(parsed.events) ? parsed.events : [],
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        sourceUrl: SCHEDULE_URL,
        updatedAt: null,
        events: [],
      };
    }
    throw createHttpError(500, 'Failed to read saved PGA TOUR event list.');
  }
}

async function getRoundLeaderProjectionEvents() {
  const fileData = await readEventsFile();
  if (fileData.events.length) {
    return {
      ...fileData,
      source: 'cache',
    };
  }

  const scrapedEvents = await scrapeScheduleEvents();
  const saved = await writeEventsFile(scrapedEvents);
  return {
    ...saved,
    source: 'bootstrap-refresh',
  };
}

async function refreshRoundLeaderProjectionEvents() {
  const scrapedEvents = await scrapeScheduleEvents();
  const saved = await writeEventsFile(scrapedEvents);
  return {
    ...saved,
    source: 'refresh',
  };
}

module.exports = {
  getRoundLeaderProjectionEvents,
  refreshRoundLeaderProjectionEvents,
};
