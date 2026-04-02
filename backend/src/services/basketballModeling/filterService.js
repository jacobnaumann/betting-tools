function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function toNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function applyResultsPoolFilters(rows, poolFilters = {}) {
  const warnings = [];

  const seasonStartYearMin = toNumberOrNull(poolFilters.seasonStartYearMin);
  const seasonStartYearMax = toNumberOrNull(poolFilters.seasonStartYearMax);
  const dateFrom = String(poolFilters.dateFrom || '').trim() || null;
  const dateTo = String(poolFilters.dateTo || '').trim() || null;
  const seasonPhases = new Set(toStringArray(poolFilters.seasonPhases).map((phase) => phase.toLowerCase()));
  const locations = new Set(toStringArray(poolFilters.locations).map((location) => location.toUpperCase()));
  const conferenceMode = String(poolFilters.conferenceMode || 'any').trim().toLowerCase();

  if (!['any', 'conference', 'non_conference'].includes(conferenceMode)) {
    warnings.push(`Unknown conferenceMode "${conferenceMode}" ignored.`);
  }

  const filteredRows = rows.filter((row) => {
    if (seasonStartYearMin !== null && row.seasonStartYear < seasonStartYearMin) return false;
    if (seasonStartYearMax !== null && row.seasonStartYear > seasonStartYearMax) return false;

    if (dateFrom && row.isoDate && row.isoDate < dateFrom) return false;
    if (dateTo && row.isoDate && row.isoDate > dateTo) return false;

    if (locations.size && row.location && !locations.has(row.location)) return false;

    if (seasonPhases.size) {
      if (!row.seasonPhase) {
        warnings.push('season_phase is missing for some rows; those rows are excluded when seasonPhases filter is used.');
        return false;
      }
      if (!seasonPhases.has(row.seasonPhase)) return false;
    }

    if (conferenceMode === 'conference') {
      if (row.isConference === null) {
        warnings.push('is_conference is missing for some rows; those rows are excluded in conferenceMode filter.');
        return false;
      }
      return row.isConference === true;
    }

    if (conferenceMode === 'non_conference') {
      if (row.isConference === null) {
        warnings.push('is_conference is missing for some rows; those rows are excluded in conferenceMode filter.');
        return false;
      }
      return row.isConference === false;
    }

    return true;
  });

  return {
    rows: filteredRows,
    warnings: [...new Set(warnings)],
  };
}

module.exports = {
  applyResultsPoolFilters,
};
