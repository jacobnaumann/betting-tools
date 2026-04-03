const fs = require('fs/promises');
const path = require('path');

const CACHE_FILE_PATH = path.resolve(__dirname, '../../data/round-leader-projection-stats-cache.json');
const MAX_CACHE_ENTRIES = 50;

function buildStatsCacheKey({ tournamentId, currentRound, selectedStats }) {
  const roundPart = Number.isFinite(Number(currentRound)) ? String(Number(currentRound)) : 'unknown-round';
  const statsPart = [...selectedStats].sort().join('|');
  return `${String(tournamentId)}::${roundPart}::${statsPart}`;
}

async function readCacheFile() {
  try {
    const raw = await fs.readFile(CACHE_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        entries: [],
      };
    }
    throw error;
  }
}

async function writeCacheFile(entries) {
  await fs.mkdir(path.dirname(CACHE_FILE_PATH), { recursive: true });
  const payload = {
    updatedAt: new Date().toISOString(),
    entries,
  };
  await fs.writeFile(CACHE_FILE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function getOrCreateRoundLeaderProjectionStatSnapshot({
  tournamentId,
  currentRound,
  selectedStats,
  scrapeSnapshot,
}) {
  const cacheKey = buildStatsCacheKey({
    tournamentId,
    currentRound,
    selectedStats,
  });

  const cache = await readCacheFile();
  const cacheEntry = cache.entries.find((entry) => entry?.cacheKey === cacheKey);
  if (cacheEntry?.snapshot) {
    return {
      snapshot: cacheEntry.snapshot,
      source: 'cache',
      cacheKey,
      fetchedAt: cacheEntry.fetchedAt || null,
    };
  }

  const snapshot = await scrapeSnapshot();
  const nextEntries = [
    {
      cacheKey,
      tournamentId: String(tournamentId),
      currentRound: Number.isFinite(Number(currentRound)) ? Number(currentRound) : null,
      selectedStats: [...selectedStats].sort(),
      fetchedAt: new Date().toISOString(),
      snapshot,
    },
    ...cache.entries.filter((entry) => entry?.cacheKey !== cacheKey),
  ].slice(0, MAX_CACHE_ENTRIES);

  await writeCacheFile(nextEntries);

  return {
    snapshot,
    source: 'fresh',
    cacheKey,
    fetchedAt: nextEntries[0]?.fetchedAt || null,
  };
}

module.exports = {
  getOrCreateRoundLeaderProjectionStatSnapshot,
};
