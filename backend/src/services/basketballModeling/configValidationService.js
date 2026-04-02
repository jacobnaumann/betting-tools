function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function toNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validatePoolFilters(poolFilters = {}) {
  const errors = [];
  const warnings = [];

  const seasonStartYearMin = toNumberOrNull(poolFilters.seasonStartYearMin);
  const seasonStartYearMax = toNumberOrNull(poolFilters.seasonStartYearMax);

  if (poolFilters.seasonStartYearMin !== undefined && !Number.isInteger(seasonStartYearMin)) {
    errors.push('poolFilters.seasonStartYearMin must be an integer.');
  }
  if (poolFilters.seasonStartYearMax !== undefined && !Number.isInteger(seasonStartYearMax)) {
    errors.push('poolFilters.seasonStartYearMax must be an integer.');
  }
  if (
    Number.isInteger(seasonStartYearMin) &&
    Number.isInteger(seasonStartYearMax) &&
    seasonStartYearMin > seasonStartYearMax
  ) {
    errors.push('poolFilters.seasonStartYearMin cannot be greater than seasonStartYearMax.');
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (poolFilters.dateFrom && !dateRegex.test(String(poolFilters.dateFrom))) {
    errors.push('poolFilters.dateFrom must use YYYY-MM-DD format.');
  }
  if (poolFilters.dateTo && !dateRegex.test(String(poolFilters.dateTo))) {
    errors.push('poolFilters.dateTo must use YYYY-MM-DD format.');
  }
  if (poolFilters.dateFrom && poolFilters.dateTo && String(poolFilters.dateFrom) > String(poolFilters.dateTo)) {
    errors.push('poolFilters.dateFrom cannot be after poolFilters.dateTo.');
  }

  const conferenceMode = String(poolFilters.conferenceMode || 'any').toLowerCase();
  if (!['any', 'conference', 'non_conference'].includes(conferenceMode)) {
    errors.push('poolFilters.conferenceMode must be one of: any, conference, non_conference.');
  }

  const locations = toStringArray(poolFilters.locations).map((location) => location.toUpperCase());
  if (locations.length) {
    const invalid = locations.filter((location) => !['H', 'N', 'V'].includes(location));
    if (invalid.length) {
      errors.push(`poolFilters.locations contains unsupported values: ${invalid.join(', ')}.`);
    }
  }

  return {
    errors,
    warnings,
  };
}

function validateFeatureConfig(featureConfig = {}, availableStatColumns = []) {
  const errors = [];
  const warnings = [];
  const available = new Set(availableStatColumns);
  const allowedTransforms = new Set(['diff', 'avg', 'ratio', 'interaction']);
  const allowedCrossTransforms = new Set(['cross_diff', 'cross_avg', 'cross_ratio', 'cross_interaction']);

  const statFeatureRules = Array.isArray(featureConfig.statFeatureRules) ? featureConfig.statFeatureRules : [];
  if (statFeatureRules.length) {
    for (let i = 0; i < statFeatureRules.length; i += 1) {
      const rule = statFeatureRules[i] || {};
      const statColumn = String(rule.statColumn || '').trim();
      const transforms = toStringArray(rule.transforms).map((value) => value.toLowerCase());
      const enableCrossPair = Boolean(rule.enableCrossPair);
      const crossPairStatColumn = String(rule.crossPairStatColumn || '').trim();
      const crossTransformsRaw = toStringArray(rule.crossTransforms).map((value) => value.toLowerCase());

      if (!statColumn) {
        errors.push(`featureConfig.statFeatureRules[${i}].statColumn is required.`);
        continue;
      }

      if (!available.has(statColumn)) {
        errors.push(`featureConfig.statFeatureRules[${i}].statColumn is unknown: ${statColumn}.`);
      }

      if (!transforms.length) {
        errors.push(`featureConfig.statFeatureRules[${i}].transforms cannot be empty.`);
      }

      const invalidTransforms = transforms.filter((value) => !allowedTransforms.has(value));
      if (invalidTransforms.length) {
        errors.push(
          `featureConfig.statFeatureRules[${i}].transforms contains unsupported values: ${invalidTransforms.join(', ')}.`
        );
      }

      if (enableCrossPair) {
        if (!crossPairStatColumn) {
          errors.push(`featureConfig.statFeatureRules[${i}].crossPairStatColumn is required when enableCrossPair is true.`);
        } else if (!available.has(crossPairStatColumn)) {
          errors.push(
            `featureConfig.statFeatureRules[${i}].crossPairStatColumn is unknown: ${crossPairStatColumn}.`
          );
        }

        const crossTransforms = crossTransformsRaw.map((value) =>
          value.startsWith('cross_') ? value : `cross_${value}`
        );
        const invalidCrossTransforms = crossTransforms.filter((value) => !allowedCrossTransforms.has(value));
        if (invalidCrossTransforms.length) {
          errors.push(
            `featureConfig.statFeatureRules[${i}].crossTransforms contains unsupported values: ${invalidCrossTransforms.join(
              ', '
            )}.`
          );
        }
      }
    }
  }

  const selectedStatColumns = toStringArray(featureConfig.selectedStatColumns);
  if (featureConfig.selectedStatColumns !== undefined && !selectedStatColumns.length && !statFeatureRules.length) {
    errors.push('featureConfig.selectedStatColumns cannot be empty when provided.');
  }

  if (selectedStatColumns.length) {
    const invalid = selectedStatColumns.filter((column) => !available.has(column));
    if (invalid.length) {
      errors.push(`featureConfig.selectedStatColumns has unknown columns: ${invalid.slice(0, 10).join(', ')}.`);
    }
  }

  const statTransforms = toStringArray(featureConfig.statTransforms).map((value) => value.toLowerCase());
  if (featureConfig.statTransforms !== undefined && !statTransforms.length && !statFeatureRules.length) {
    errors.push('featureConfig.statTransforms cannot be empty when provided.');
  }

  const invalidTransforms = statTransforms.filter((value) => !allowedTransforms.has(value));
  if (invalidTransforms.length) {
    errors.push(`featureConfig.statTransforms contains unsupported values: ${invalidTransforms.join(', ')}.`);
  }

  const crossPairs = Array.isArray(featureConfig.crossStatPairs) ? featureConfig.crossStatPairs : [];

  for (let i = 0; i < crossPairs.length; i += 1) {
    const pair = crossPairs[i] || {};
    const teamStat = String(pair.teamStat || '').trim();
    const opponentStat = String(pair.opponentStat || '').trim();

    if (!teamStat || !opponentStat) {
      errors.push(`featureConfig.crossStatPairs[${i}] must include teamStat and opponentStat.`);
      continue;
    }

    if (!available.has(teamStat)) {
      errors.push(`featureConfig.crossStatPairs[${i}].teamStat is unknown: ${teamStat}.`);
    }
    if (!available.has(opponentStat)) {
      errors.push(`featureConfig.crossStatPairs[${i}].opponentStat is unknown: ${opponentStat}.`);
    }

    const transforms = toStringArray(pair.transforms).map((value) => value.toLowerCase());
    const invalid = transforms.filter((value) => !allowedCrossTransforms.has(value));
    if (invalid.length) {
      errors.push(
        `featureConfig.crossStatPairs[${i}].transforms contains unsupported values: ${invalid.join(', ')}.`
      );
    }
  }

  const hasCrossPairs = crossPairs.length > 0;
  const hasFeatureRules = statFeatureRules.length > 0;
  if (!hasFeatureRules && !selectedStatColumns.length && !hasCrossPairs) {
    errors.push(
      'featureConfig must include at least one statFeatureRules entry, selectedStatColumns entry, or crossStatPairs entry.'
    );
  }

  return {
    errors,
    warnings,
  };
}

function validateModelSettings(modelSettings = {}) {
  const errors = [];
  const warnings = [];

  const ridgeAlpha = toNumberOrNull(modelSettings.ridgeAlpha);
  const folds = toNumberOrNull(modelSettings.folds);
  const trainRatio = toNumberOrNull(modelSettings.trainRatio);
  const splitMode = String(modelSettings.splitMode || 'chronological').toLowerCase();

  if (modelSettings.ridgeAlpha !== undefined && (ridgeAlpha === null || ridgeAlpha < 0)) {
    errors.push('modelSettings.ridgeAlpha must be a non-negative number.');
  }

  if (modelSettings.folds !== undefined && (!Number.isInteger(folds) || folds < 2 || folds > 20)) {
    errors.push('modelSettings.folds must be an integer between 2 and 20.');
  }

  if (modelSettings.trainRatio !== undefined && (trainRatio === null || trainRatio <= 0 || trainRatio >= 1)) {
    errors.push('modelSettings.trainRatio must be greater than 0 and less than 1.');
  }

  if (!['chronological', 'random'].includes(splitMode)) {
    errors.push('modelSettings.splitMode must be one of: chronological, random.');
  }

  if (folds !== null && trainRatio !== null) {
    warnings.push('Both folds and trainRatio are set; training endpoint should define precedence.');
  }

  const advanced = modelSettings.advanced || {};
  const predictorNormalization = String(advanced.predictorNormalization || 'zscore_train').toLowerCase();
  if (!['zscore_train', 'none'].includes(predictorNormalization)) {
    errors.push('modelSettings.advanced.predictorNormalization must be one of: zscore_train, none.');
  }

  const targetNormalization = String(advanced.targetNormalization || 'none').toLowerCase();
  if (!['none', 'zscore_train'].includes(targetNormalization)) {
    errors.push('modelSettings.advanced.targetNormalization must be one of: none, zscore_train.');
  }

  const targetCapMin = toNumberOrNull(advanced.targetCapMin);
  const targetCapMax = toNumberOrNull(advanced.targetCapMax);
  if (advanced.targetCapMin !== undefined && targetCapMin === null) {
    errors.push('modelSettings.advanced.targetCapMin must be a number.');
  }
  if (advanced.targetCapMax !== undefined && targetCapMax === null) {
    errors.push('modelSettings.advanced.targetCapMax must be a number.');
  }
  if (targetCapMin !== null && targetCapMax !== null && targetCapMin > targetCapMax) {
    errors.push('modelSettings.advanced.targetCapMin cannot be greater than targetCapMax.');
  }

  return {
    errors,
    warnings,
  };
}

function validateBasketballModelingConfig(config = {}, availableStatColumns = []) {
  const pool = validatePoolFilters(config.poolFilters || {});
  const features = validateFeatureConfig(config.featureConfig || {}, availableStatColumns);
  const model = validateModelSettings(config.modelSettings || {});

  const errors = [...pool.errors, ...features.errors, ...model.errors];
  const warnings = [...pool.warnings, ...features.warnings, ...model.warnings];

  return {
    ok: !errors.length,
    errors,
    warnings,
  };
}

module.exports = {
  validateBasketballModelingConfig,
};
