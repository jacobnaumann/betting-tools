const { createHttpError } = require('./errors');
const { transpose, multiplyMatrixMatrix, multiplyMatrixVector, solveLinearSystem, dot } = require('./mathService');

function toNumberOrDefault(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffleInPlace(values, seed) {
  const random = seededRandom(seed);
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
}

function splitRows(modelRows, modelSettings = {}) {
  const splitMode = String(modelSettings.splitMode || 'chronological').toLowerCase();
  const trainRatio = toNumberOrDefault(modelSettings.trainRatio, 0.9);
  const seed = Math.trunc(toNumberOrDefault(modelSettings.seed, 42));
  const rows = [...modelRows];

  if (splitMode === 'random') {
    shuffleInPlace(rows, seed);
  } else {
    rows.sort((a, b) => {
      const left = `${a.game.isoDate || ''}-${a.game.team}-${a.game.opponent}`;
      const right = `${b.game.isoDate || ''}-${b.game.team}-${b.game.opponent}`;
      return left.localeCompare(right);
    });
  }

  const trainSize = Math.max(1, Math.min(rows.length - 1, Math.floor(rows.length * trainRatio)));
  return {
    trainRows: rows.slice(0, trainSize),
    testRows: rows.slice(trainSize),
    splitMode,
    trainRatio,
    seed,
  };
}

function computePredictorStandardization(rows) {
  if (!rows.length) throw new Error('Cannot compute standardization on empty rows.');
  const featureCount = rows[0].x.length;
  const means = new Array(featureCount).fill(0);
  const stdDevs = new Array(featureCount).fill(0);

  for (const row of rows) {
    for (let i = 0; i < featureCount; i += 1) {
      means[i] += row.x[i];
    }
  }
  for (let i = 0; i < featureCount; i += 1) {
    means[i] /= rows.length;
  }

  for (const row of rows) {
    for (let i = 0; i < featureCount; i += 1) {
      const diff = row.x[i] - means[i];
      stdDevs[i] += diff * diff;
    }
  }
  for (let i = 0; i < featureCount; i += 1) {
    const variance = stdDevs[i] / rows.length;
    stdDevs[i] = variance > 0 ? Math.sqrt(variance) : 1;
  }

  return {
    means,
    stdDevs,
  };
}

function normalizePredictorRows(rows, standardization) {
  return rows.map((row) => ({
    ...row,
    x: row.x.map((value, index) => (value - standardization.means[index]) / standardization.stdDevs[index]),
  }));
}

function computeTargetStandardization(rows) {
  if (!rows.length) throw new Error('Cannot compute target standardization on empty rows.');
  const mean = rows.reduce((sum, row) => sum + row.y, 0) / rows.length;
  const variance = rows.reduce((sum, row) => {
    const diff = row.y - mean;
    return sum + diff * diff;
  }, 0) / rows.length;
  const stdDev = variance > 0 ? Math.sqrt(variance) : 1;
  return {
    mean,
    stdDev,
  };
}

function normalizeTarget(value, targetStandardization) {
  if (!targetStandardization) return value;
  return (value - targetStandardization.mean) / targetStandardization.stdDev;
}

function denormalizeTarget(value, targetStandardization) {
  if (!targetStandardization) return value;
  return value * targetStandardization.stdDev + targetStandardization.mean;
}

function toDesignMatrix(rows) {
  return rows.map((row) => [1, ...row.x]);
}

function toTargetVector(rows) {
  return rows.map((row) => row.y);
}

function fitRidgeFromMatrix(designMatrix, targetVector, ridgeAlpha) {
  const xt = transpose(designMatrix);
  const xtx = multiplyMatrixMatrix(xt, designMatrix);
  const xty = multiplyMatrixVector(xt, targetVector);

  for (let i = 0; i < xtx.length; i += 1) {
    if (i === 0) continue; // keep intercept unregularized
    xtx[i][i] += ridgeAlpha;
  }

  const beta = solveLinearSystem(xtx, xty);
  return {
    intercept: beta[0],
    coefficients: beta.slice(1),
  };
}

function predictOne(featureVector, model) {
  return model.intercept + dot(featureVector, model.coefficients);
}

function evaluateRowsOnOriginalScale(rows, model, targetStandardization = null) {
  if (!rows.length) {
    return {
      count: 0,
      rmse: null,
      mae: null,
      r2: null,
      correlation: null,
    };
  }

  let sumAbsError = 0;
  let sumSqError = 0;
  let ySum = 0;
  let yPredSum = 0;
  let yy = 0;
  let pp = 0;
  let yp = 0;

  for (const row of rows) {
    const modelPrediction = predictOne(row.x, model);
    const prediction = denormalizeTarget(modelPrediction, targetStandardization);
    const error = prediction - row.y;
    sumAbsError += Math.abs(error);
    sumSqError += error * error;
    ySum += row.y;
    yPredSum += prediction;
    yy += row.y * row.y;
    pp += prediction * prediction;
    yp += row.y * prediction;
  }

  const n = rows.length;
  const meanY = ySum / n;
  let totalSq = 0;
  for (const row of rows) {
    const diff = row.y - meanY;
    totalSq += diff * diff;
  }

  const covariance = yp - (ySum * yPredSum) / n;
  const yVarTerm = yy - (ySum * ySum) / n;
  const pVarTerm = pp - (yPredSum * yPredSum) / n;
  const denominator = Math.sqrt(Math.max(0, yVarTerm) * Math.max(0, pVarTerm));
  const correlation = denominator > 0 ? covariance / denominator : null;

  return {
    count: n,
    rmse: Math.sqrt(sumSqError / n),
    mae: sumAbsError / n,
    r2: totalSq > 0 ? 1 - sumSqError / totalSq : null,
    correlation,
  };
}

function evaluateRowsAgainstConstant(rows, constantPrediction) {
  if (!rows.length) {
    return {
      count: 0,
      rmse: null,
      mae: null,
      r2: null,
      correlation: null,
    };
  }

  let sumAbsError = 0;
  let sumSqError = 0;
  let ySum = 0;
  let yPredSum = 0;
  let yy = 0;
  let pp = 0;
  let yp = 0;

  for (const row of rows) {
    const prediction = constantPrediction;
    const error = prediction - row.y;
    sumAbsError += Math.abs(error);
    sumSqError += error * error;
    ySum += row.y;
    yPredSum += prediction;
    yy += row.y * row.y;
    pp += prediction * prediction;
    yp += row.y * prediction;
  }

  const n = rows.length;
  const meanY = ySum / n;
  let totalSq = 0;
  for (const row of rows) {
    const diff = row.y - meanY;
    totalSq += diff * diff;
  }

  const covariance = yp - (ySum * yPredSum) / n;
  const yVarTerm = yy - (ySum * ySum) / n;
  const pVarTerm = pp - (yPredSum * yPredSum) / n;
  const denominator = Math.sqrt(Math.max(0, yVarTerm) * Math.max(0, pVarTerm));
  const correlation = denominator > 0 ? covariance / denominator : null;

  return {
    count: n,
    rmse: Math.sqrt(sumSqError / n),
    mae: sumAbsError / n,
    r2: totalSq > 0 ? 1 - sumSqError / totalSq : null,
    correlation,
  };
}

function getAdvancedSettings(modelSettings = {}) {
  const advanced = modelSettings.advanced || {};
  return {
    symmetricAugmentation: advanced.symmetricAugmentation !== false,
    targetCapEnabled: advanced.targetCapEnabled !== false,
    targetCapMin: toNumberOrDefault(advanced.targetCapMin, -40),
    targetCapMax: toNumberOrDefault(advanced.targetCapMax, 40),
    predictorNormalization: String(advanced.predictorNormalization || 'zscore_train').toLowerCase(),
    targetNormalization: String(advanced.targetNormalization || 'none').toLowerCase(),
  };
}

function maybeNormalizePredictors(rows, predictorNormalization) {
  if (predictorNormalization === 'none') {
    return {
      rows,
      standardization: null,
    };
  }
  const standardization = computePredictorStandardization(rows);
  return {
    rows: normalizePredictorRows(rows, standardization),
    standardization,
  };
}

function maybeNormalizeTargets(trainRows, testRows, targetNormalization) {
  if (targetNormalization !== 'zscore_train') {
    return {
      trainRows,
      testRows,
      targetStandardization: null,
    };
  }

  const targetStandardization = computeTargetStandardization(trainRows);
  const normalizeY = (rows) =>
    rows.map((row) => ({
      ...row,
      y: normalizeTarget(row.y, targetStandardization),
    }));

  return {
    trainRows: normalizeY(trainRows),
    testRows: normalizeY(testRows),
    targetStandardization,
  };
}

function evaluateCrossValidation(rows, modelSettings = {}) {
  const folds = Math.trunc(toNumberOrDefault(modelSettings.folds, 10));
  const seed = Math.trunc(toNumberOrDefault(modelSettings.seed, 42));
  const ridgeAlpha = toNumberOrDefault(modelSettings.ridgeAlpha, 0.25);
  const advanced = getAdvancedSettings(modelSettings);

  if (!Number.isInteger(folds) || folds < 2) return null;
  if (rows.length < folds) return null;

  const indices = Array.from({ length: rows.length }, (_, index) => index);
  shuffleInPlace(indices, seed);
  const foldSize = Math.floor(rows.length / folds);
  const metrics = [];

  for (let fold = 0; fold < folds; fold += 1) {
    const start = fold * foldSize;
    const end = fold === folds - 1 ? rows.length : start + foldSize;
    const testIndexSet = new Set(indices.slice(start, end));

    const trainRows = [];
    const testRows = [];
    for (let i = 0; i < rows.length; i += 1) {
      if (testIndexSet.has(i)) testRows.push(rows[i]);
      else trainRows.push(rows[i]);
    }

    if (!trainRows.length || !testRows.length) continue;

    const predictorPrepared = maybeNormalizePredictors(trainRows, advanced.predictorNormalization);
    const normalizedTrain = predictorPrepared.rows;
    let normalizedTest = testRows;
    if (predictorPrepared.standardization) {
      normalizedTest = normalizePredictorRows(testRows, predictorPrepared.standardization);
    }

    const targetPrepared = maybeNormalizeTargets(normalizedTrain, normalizedTest, advanced.targetNormalization);
    const trainForModel = targetPrepared.trainRows;
    const testForModel = targetPrepared.testRows;

    const model = fitRidgeFromMatrix(toDesignMatrix(trainForModel), toTargetVector(trainForModel), ridgeAlpha);
    const foldMetrics = evaluateRowsOnOriginalScale(testForModel, model, targetPrepared.targetStandardization);
    if (foldMetrics.count > 0) metrics.push(foldMetrics);
  }

  if (!metrics.length) return null;

  const average = (key) => metrics.reduce((sum, item) => sum + (item[key] || 0), 0) / metrics.length;
  return {
    folds: metrics.length,
    rmse: average('rmse'),
    mae: average('mae'),
    r2: average('r2'),
    correlation: average('correlation'),
  };
}

function trainRidgeModel(modelRows, modelSettings = {}) {
  if (!modelRows.length) {
    throw createHttpError(400, 'No model rows available after filtering and feature building.');
  }
  if (modelRows.length < 20) {
    throw createHttpError(400, `Not enough model rows (${modelRows.length}). Increase pool size before training.`);
  }

  const ridgeAlpha = toNumberOrDefault(modelSettings.ridgeAlpha, 0.25);
  const advanced = getAdvancedSettings(modelSettings);
  const split = splitRows(modelRows, modelSettings);
  if (!split.testRows.length) {
    throw createHttpError(400, 'Not enough rows to create a holdout test split.');
  }

  const predictorPrepared = maybeNormalizePredictors(split.trainRows, advanced.predictorNormalization);
  const normalizedTrainPredictors = predictorPrepared.rows;
  let normalizedTestPredictors = split.testRows;
  if (predictorPrepared.standardization) {
    normalizedTestPredictors = normalizePredictorRows(split.testRows, predictorPrepared.standardization);
  }

  const targetPrepared = maybeNormalizeTargets(
    normalizedTrainPredictors,
    normalizedTestPredictors,
    advanced.targetNormalization
  );

  const trainForModel = targetPrepared.trainRows;
  const testForModel = targetPrepared.testRows;

  const model = fitRidgeFromMatrix(toDesignMatrix(trainForModel), toTargetVector(trainForModel), ridgeAlpha);
  const trainMetrics = evaluateRowsOnOriginalScale(trainForModel, model, targetPrepared.targetStandardization);
  const testMetrics = evaluateRowsOnOriginalScale(testForModel, model, targetPrepared.targetStandardization);
  const trainMeanTarget = split.trainRows.reduce((sum, row) => sum + row.y, 0) / split.trainRows.length;
  const baselineZeroTest = evaluateRowsAgainstConstant(split.testRows, 0);
  const baselineTrainMeanTest = evaluateRowsAgainstConstant(split.testRows, trainMeanTarget);
  const crossValidation = evaluateCrossValidation(modelRows, modelSettings);

  return {
    model,
    metrics: {
      train: trainMetrics,
      test: testMetrics,
      baselines: {
        test: {
          zero: baselineZeroTest,
          trainMean: baselineTrainMeanTest,
          trainMeanValue: trainMeanTarget,
        },
      },
      crossValidation,
    },
    split: {
      mode: split.splitMode,
      trainRatio: split.trainRatio,
      seed: split.seed,
      trainCount: split.trainRows.length,
      testCount: split.testRows.length,
    },
    standardization: predictorPrepared.standardization,
    targetStandardization: targetPrepared.targetStandardization,
    settings: {
      ridgeAlpha,
      folds: modelSettings.folds,
      splitMode: split.splitMode,
      trainRatio: split.trainRatio,
      seed: split.seed,
      advanced,
    },
  };
}

module.exports = {
  trainRidgeModel,
  predictOne,
};
