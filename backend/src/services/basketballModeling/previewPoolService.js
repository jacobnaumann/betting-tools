const { loadResultsRows, loadStatsColumns } = require('./dataService');
const { applyResultsPoolFilters } = require('./filterService');

function buildCountMap(rows, keyBuilder) {
  const map = new Map();
  for (const row of rows) {
    const key = keyBuilder(row);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([key, count]) => ({ key, count }));
}

function buildSampleRows(rows, limit = 10) {
  return rows.slice(0, limit).map((row) => ({
    seasonStartYear: row.seasonStartYear,
    date: row.isoDate,
    team: row.team,
    opponent: row.opponent,
    location: row.location,
    adjustedDiff: row.adjustedDiff,
    isConference: row.isConference,
    seasonPhase: row.seasonPhase,
  }));
}

async function buildResultsPoolPreview(poolFilters = {}) {
  const resultsData = await loadResultsRows();
  const filtered = applyResultsPoolFilters(resultsData.rows, poolFilters);
  const statsColumnsData = await loadStatsColumns();

  return {
    totals: {
      allRows: resultsData.rows.length,
      matchedRows: filtered.rows.length,
    },
    breakdowns: {
      bySeasonStartYear: buildCountMap(filtered.rows, (row) => row.seasonStartYear),
      byLocation: buildCountMap(filtered.rows, (row) => row.location || 'unknown'),
      bySeasonPhase: buildCountMap(filtered.rows, (row) => row.seasonPhase || 'unknown'),
      byConferenceFlag: buildCountMap(filtered.rows, (row) => {
        if (row.isConference === true) return 'conference';
        if (row.isConference === false) return 'non_conference';
        return 'unknown';
      }),
    },
    sampleRows: buildSampleRows(filtered.rows),
    warnings: [...filtered.warnings, ...(resultsData.warnings || [])],
    dataSources: {
      resultsDirectory: resultsData.sourceDirectory,
      resultsFilesCount: resultsData.sourceFiles.length,
      statsDirectory: statsColumnsData.sourceDirectory,
      statsSourceFile: statsColumnsData.sourceFile,
      availableStatColumnsCount: statsColumnsData.columns.length,
    },
  };
}

async function getModelingMeta() {
  const statsColumnsData = await loadStatsColumns();
  const resultsData = await loadResultsRows();

  return {
    statsColumns: statsColumnsData.columns,
    statsColumnsCount: statsColumnsData.columns.length,
    resultsRowsCount: resultsData.rows.length,
    resultsFilesCount: resultsData.sourceFiles.length,
    supportedStatTransforms: ['diff', 'avg', 'ratio', 'interaction'],
    supportedCrossTransforms: ['cross_diff', 'cross_avg', 'cross_ratio', 'cross_interaction'],
    loadedAt: new Date().toISOString(),
  };
}

module.exports = {
  buildResultsPoolPreview,
  getModelingMeta,
};
