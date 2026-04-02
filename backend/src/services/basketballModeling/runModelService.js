const { loadResultsRows, loadStatsColumns, loadStatsRowsBySeasonAndTeam, normalizeTeamName } = require('./dataService');
const { applyResultsPoolFilters } = require('./filterService');
const { validateBasketballModelingConfig } = require('./configValidationService');
const { buildModelRows, buildFeatureVector } = require('./featureBuilderService');
const { trainRidgeModel, predictOne } = require('./ridgeTrainerService');
const { createHttpError } = require('./errors');
const { generateRunId, saveRunRecord, getRunRecord } = require('./runStoreService');

function roundMaybe(value, digits = 5) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function standardizeVector(values, standardization) {
  if (!standardization) return values;
  return values.map((value, index) => {
    const mean = standardization.means[index];
    const stdDev = standardization.stdDevs[index];
    return (value - mean) / stdDev;
  });
}

function denormalizeTargetIfNeeded(value, targetStandardization) {
  if (!targetStandardization) return value;
  return value * targetStandardization.stdDev + targetStandardization.mean;
}

function buildTopCoefficients(featureSpecs, coefficients, limit = 20) {
  const rows = featureSpecs.map((spec, index) => ({
    feature: spec.name,
    coefficient: coefficients[index],
    absCoefficient: Math.abs(coefficients[index]),
  }));

  return rows
    .sort((a, b) => b.absCoefficient - a.absCoefficient)
    .slice(0, limit)
    .map((row) => ({
      feature: row.feature,
      coefficient: roundMaybe(row.coefficient, 6),
    }));
}

function getAdvancedSettings(modelSettings = {}) {
  const advanced = modelSettings.advanced || {};
  const toNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    symmetricAugmentation: advanced.symmetricAugmentation !== false,
    targetCapEnabled: advanced.targetCapEnabled !== false,
    targetCapMin: toNumber(advanced.targetCapMin, -40),
    targetCapMax: toNumber(advanced.targetCapMax, 40),
    predictorNormalization: String(advanced.predictorNormalization || 'zscore_train').toLowerCase(),
    targetNormalization: String(advanced.targetNormalization || 'none').toLowerCase(),
  };
}

function applyAdvancedRowTransforms(modelRows, modelSettings = {}) {
  const advanced = getAdvancedSettings(modelSettings);
  const transformedRows = [];

  const applyTargetCap = (value) => {
    if (!advanced.targetCapEnabled) return value;
    if (value < advanced.targetCapMin) return advanced.targetCapMin;
    if (value > advanced.targetCapMax) return advanced.targetCapMax;
    return value;
  };

  for (const row of modelRows) {
    const cappedTarget = applyTargetCap(row.y);
    transformedRows.push({
      ...row,
      y: cappedTarget,
    });

    if (advanced.symmetricAugmentation && Array.isArray(row.reverseX)) {
      transformedRows.push({
        ...row,
        x: row.reverseX,
        y: applyTargetCap(-row.y),
      });
    }
  }

  return {
    rows: transformedRows,
    advanced,
  };
}

async function runBasketballModel(config = {}) {
  const statsColumnsData = await loadStatsColumns();
  const validation = validateBasketballModelingConfig(config, statsColumnsData.columns);
  if (!validation.ok) {
    throw createHttpError(400, `Invalid config: ${validation.errors.join(' ')}`);
  }

  const resultsData = await loadResultsRows();
  const statsRowsData = await loadStatsRowsBySeasonAndTeam();
  const filtered = applyResultsPoolFilters(resultsData.rows, config.poolFilters || {});
  const modelRowsPayload = buildModelRows(filtered.rows, statsRowsData.rowsByKey, config.featureConfig || {});
  const advancedTransformed = applyAdvancedRowTransforms(modelRowsPayload.rows, config.modelSettings || {});
  const training = trainRidgeModel(advancedTransformed.rows, config.modelSettings || {});

  const runId = generateRunId();
  const createdAt = new Date().toISOString();
  const warnings = [...validation.warnings, ...filtered.warnings, ...(resultsData.warnings || []), ...(statsRowsData.warnings || [])];

  const runRecord = {
    runId,
    createdAt,
    modelType: 'ridge',
    config,
    warnings: [...new Set(warnings)],
    featureCount: modelRowsPayload.featureSpecs.length,
    featureSpecs: modelRowsPayload.featureSpecs,
    diagnostics: modelRowsPayload.diagnostics,
    rowCounts: {
      filteredGames: filtered.rows.length,
      modelRows: advancedTransformed.rows.length,
      trainRows: training.split.trainCount,
      testRows: training.split.testCount,
    },
    metrics: training.metrics,
    artifact: {
      model: training.model,
      standardization: training.standardization,
      targetStandardization: training.targetStandardization,
      settings: training.settings,
      sourceInfo: {
        resultsDirectory: resultsData.sourceDirectory,
        statsDirectory: statsRowsData.sourceDirectory,
      },
    },
  };

  const summary = saveRunRecord(runRecord);
  return {
    ...summary,
    topCoefficients: buildTopCoefficients(runRecord.featureSpecs, runRecord.artifact.model.coefficients),
    diagnostics: {
      ...runRecord.diagnostics,
      rowsAfterAdvancedTransforms: runRecord.rowCounts.modelRows,
    },
  };
}

function buildRunDetails(runId) {
  const run = getRunRecord(runId);
  return {
    runId: run.runId,
    createdAt: run.createdAt,
    modelType: run.modelType,
    config: run.config,
    warnings: run.warnings,
    featureCount: run.featureCount,
    rowCounts: run.rowCounts,
    diagnostics: run.diagnostics,
    metrics: run.metrics,
    featureSpecs: run.featureSpecs,
    coefficients: {
      intercept: roundMaybe(run.artifact.model.intercept, 6),
      byFeature: run.featureSpecs.map((spec, index) => ({
        feature: spec.name,
        coefficient: roundMaybe(run.artifact.model.coefficients[index], 6),
      })),
    },
  };
}

function parseSeasonStartYear(input) {
  if (input === undefined || input === null || input === '') return null;
  const value = Number(input);
  return Number.isInteger(value) ? value : null;
}

async function predictMatchup({ runId, seasonStartYear, team1, team2 }) {
  const run = getRunRecord(runId);
  const statsRowsData = await loadStatsRowsBySeasonAndTeam();

  const season = parseSeasonStartYear(seasonStartYear);
  if (!season) {
    throw createHttpError(400, 'seasonStartYear is required and must be an integer.');
  }

  const normalizedTeam1 = normalizeTeamName(team1);
  const normalizedTeam2 = normalizeTeamName(team2);
  if (!normalizedTeam1 || !normalizedTeam2) {
    throw createHttpError(400, 'Both team1 and team2 are required.');
  }

  const team1Stats = statsRowsData.rowsByKey.get(`${season}:${normalizedTeam1}`);
  const team2Stats = statsRowsData.rowsByKey.get(`${season}:${normalizedTeam2}`);
  if (!team1Stats || !team2Stats) {
    throw createHttpError(404, `Could not find stats rows for one or both teams in season ${season}.`);
  }

  const forwardRaw = buildFeatureVector(team1Stats.values, team2Stats.values, run.featureSpecs);
  const reverseRaw = buildFeatureVector(team2Stats.values, team1Stats.values, run.featureSpecs);
  if (!forwardRaw || !reverseRaw) {
    throw createHttpError(400, 'Could not build feature vector for this matchup.');
  }

  const forwardModelSpace = predictOne(standardizeVector(forwardRaw, run.artifact.standardization), run.artifact.model);
  const reverseModelSpace = predictOne(standardizeVector(reverseRaw, run.artifact.standardization), run.artifact.model);
  const forward = denormalizeTargetIfNeeded(forwardModelSpace, run.artifact.targetStandardization);
  const reverse = denormalizeTargetIfNeeded(reverseModelSpace, run.artifact.targetStandardization);
  const symmetricMargin = (forward - reverse) / 2;

  return {
    runId,
    seasonStartYear: season,
    team1: team1Stats.team,
    team2: team2Stats.team,
    forwardPredictedDiff: roundMaybe(forward, 4),
    reversePredictedDiff: roundMaybe(reverse, 4),
    symmetricMargin: roundMaybe(symmetricMargin, 4),
    favoredTeam: symmetricMargin >= 0 ? team1Stats.team : team2Stats.team,
  };
}

module.exports = {
  runBasketballModel,
  buildRunDetails,
  predictMatchup,
};
