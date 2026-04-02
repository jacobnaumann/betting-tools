const { createHttpError } = require('./errors');

const EPSILON = 1e-9;
const DEFAULT_STAT_TRANSFORMS = ['diff'];
const DEFAULT_CROSS_TRANSFORMS = ['cross_diff'];

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function toNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function makeStatFeatureName(stat, transform) {
  return `${stat}__${transform}`;
}

function makeCrossFeatureName(teamStat, opponentStat, transform) {
  return `${teamStat}__vs__${opponentStat}__${transform}`;
}

function toCrossTransformName(transform) {
  const normalized = String(transform || '').trim().toLowerCase();
  if (!normalized) return '';
  return normalized.startsWith('cross_') ? normalized : `cross_${normalized}`;
}

function buildFeatureSpecs(featureConfig = {}) {
  const statFeatureRules = Array.isArray(featureConfig.statFeatureRules) ? featureConfig.statFeatureRules : [];
  if (statFeatureRules.length) {
    const specs = [];

    for (const rule of statFeatureRules) {
      const statColumn = String(rule?.statColumn || '').trim();
      if (!statColumn) continue;

      const transformsRaw = toStringArray(rule.transforms).map((value) => value.toLowerCase());
      const transforms = transformsRaw.length ? transformsRaw : DEFAULT_STAT_TRANSFORMS;
      for (const transform of transforms) {
        specs.push({
          type: 'stat',
          statColumn,
          transform,
          name: makeStatFeatureName(statColumn, transform),
        });
      }

      if (rule.enableCrossPair) {
        const opponentStat = String(rule.crossPairStatColumn || '').trim();
        if (!opponentStat) continue;
        const crossTransformsRaw = toStringArray(rule.crossTransforms).map((value) => toCrossTransformName(value));
        const crossTransforms = crossTransformsRaw.length
          ? crossTransformsRaw
          : DEFAULT_CROSS_TRANSFORMS;

        for (const transform of crossTransforms) {
          specs.push({
            type: 'cross',
            teamStat: statColumn,
            opponentStat,
            transform,
            name: makeCrossFeatureName(statColumn, opponentStat, transform),
          });
        }
      }
    }

    return specs;
  }

  const selectedStatColumns = toStringArray(featureConfig.selectedStatColumns);
  const statTransformsRaw = toStringArray(featureConfig.statTransforms).map((value) => value.toLowerCase());
  const statTransforms = statTransformsRaw.length ? statTransformsRaw : DEFAULT_STAT_TRANSFORMS;
  const crossStatPairs = Array.isArray(featureConfig.crossStatPairs) ? featureConfig.crossStatPairs : [];

  const statSpecs = [];
  for (const statColumn of selectedStatColumns) {
    for (const transform of statTransforms) {
      statSpecs.push({
        type: 'stat',
        statColumn,
        transform,
        name: makeStatFeatureName(statColumn, transform),
      });
    }
  }

  const crossSpecs = [];
  for (const pair of crossStatPairs) {
    const teamStat = String(pair?.teamStat || '').trim();
    const opponentStat = String(pair?.opponentStat || '').trim();
    if (!teamStat || !opponentStat) continue;

    const transformsRaw = toStringArray(pair.transforms).map((value) => value.toLowerCase());
    const transforms = transformsRaw.length ? transformsRaw : DEFAULT_CROSS_TRANSFORMS;
    for (const transform of transforms) {
      crossSpecs.push({
        type: 'cross',
        teamStat,
        opponentStat,
        transform,
        name: makeCrossFeatureName(teamStat, opponentStat, transform),
      });
    }
  }

  return [...statSpecs, ...crossSpecs];
}

function computeStatTransform(teamValue, opponentValue, transform) {
  if (!Number.isFinite(teamValue) || !Number.isFinite(opponentValue)) return null;

  switch (transform) {
    case 'diff':
      return teamValue - opponentValue;
    case 'avg':
      return (teamValue + opponentValue) / 2;
    case 'ratio':
      return teamValue / (Math.abs(opponentValue) < EPSILON ? EPSILON : opponentValue);
    case 'interaction':
      return teamValue * opponentValue;
    default:
      return null;
  }
}

function computeCrossTransform(teamValue, opponentValue, transform) {
  if (!Number.isFinite(teamValue) || !Number.isFinite(opponentValue)) return null;

  switch (transform) {
    case 'cross_diff':
      return teamValue - opponentValue;
    case 'cross_avg':
      return (teamValue + opponentValue) / 2;
    case 'cross_ratio':
      return teamValue / (Math.abs(opponentValue) < EPSILON ? EPSILON : opponentValue);
    case 'cross_interaction':
      return teamValue * opponentValue;
    default:
      return null;
  }
}

function buildFeatureVector(teamStats, opponentStats, featureSpecs) {
  const values = [];

  for (const spec of featureSpecs) {
    if (spec.type === 'stat') {
      const teamValue = toNumberOrNull(teamStats[spec.statColumn]);
      const opponentValue = toNumberOrNull(opponentStats[spec.statColumn]);
      const transformed = computeStatTransform(teamValue, opponentValue, spec.transform);
      if (!Number.isFinite(transformed)) return null;
      values.push(transformed);
      continue;
    }

    const teamValue = toNumberOrNull(teamStats[spec.teamStat]);
    const opponentValue = toNumberOrNull(opponentStats[spec.opponentStat]);
    const transformed = computeCrossTransform(teamValue, opponentValue, spec.transform);
    if (!Number.isFinite(transformed)) return null;
    values.push(transformed);
  }

  return values;
}

function buildModelRows(resultsRows, statsRowsByKey, featureConfig = {}) {
  const featureSpecs = buildFeatureSpecs(featureConfig);
  if (!featureSpecs.length) {
    throw createHttpError(
      400,
      'No features selected. Add statFeatureRules or selectedStatColumns/statTransforms or crossStatPairs.'
    );
  }

  const rows = [];
  let droppedMissingStats = 0;
  let droppedInvalidFeatureValue = 0;

  for (const game of resultsRows) {
    const teamKey = `${game.seasonStartYear}:${game.normalizedTeam}`;
    const opponentKey = `${game.seasonStartYear}:${game.normalizedOpponent}`;
    const teamStatsRow = statsRowsByKey.get(teamKey);
    const opponentStatsRow = statsRowsByKey.get(opponentKey);

    if (!teamStatsRow || !opponentStatsRow) {
      droppedMissingStats += 1;
      continue;
    }

    const featureValues = buildFeatureVector(teamStatsRow.values, opponentStatsRow.values, featureSpecs);
    const reverseFeatureValues = buildFeatureVector(opponentStatsRow.values, teamStatsRow.values, featureSpecs);
    if (!featureValues || !reverseFeatureValues) {
      droppedInvalidFeatureValue += 1;
      continue;
    }

    rows.push({
      game,
      x: featureValues,
      reverseX: reverseFeatureValues,
      y: game.adjustedDiff,
    });
  }

  return {
    rows,
    featureSpecs,
    diagnostics: {
      attemptedRows: resultsRows.length,
      acceptedRows: rows.length,
      droppedMissingStats,
      droppedInvalidFeatureValue,
    },
  };
}

module.exports = {
  buildModelRows,
  buildFeatureSpecs,
  buildFeatureVector,
};
