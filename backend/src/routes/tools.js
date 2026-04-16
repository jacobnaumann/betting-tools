const express = require('express');
const { buildRoundLeaderProjection } = require('../services/roundLeaderProjectionService');
const { validateUploadedSgCsv } = require('../services/roundLeaderProjectionStatService');
const {
  getRoundLeaderProjectionEvents,
  refreshRoundLeaderProjectionEvents,
} = require('../services/roundLeaderProjectionEventsService');
const { buildResultsPoolPreview, getModelingMeta } = require('../services/basketballModeling/previewPoolService');
const { validateBasketballModelingConfig } = require('../services/basketballModeling/configValidationService');
const { runBasketballModel, buildRunDetails, predictMatchup } = require('../services/basketballModeling/runModelService');
const {
  saveModelFromRun,
  listSavedModels,
  loadSavedModel,
  deleteSavedModel,
  exportSavedModel,
} = require('../services/basketballModeling/savedModelService');

const toolsRouter = express.Router();

toolsRouter.get('/ping', (_req, res) => {
  res.json({
    ok: true,
    message: 'Tools API is reachable.',
  });
});

toolsRouter.post('/round-leader-projection', async (req, res) => {
  const {
    baseUrl,
    leaderboardUrl,
    tourcastUrl,
    courseStatsUrl,
    selectedStats,
    statOverrides,
    scoreOverrides,
    uploadedSgCsv,
  } = req.body || {};

  if (!baseUrl && !leaderboardUrl && !tourcastUrl && !courseStatsUrl) {
    return res.status(400).json({
      ok: false,
      error: 'baseUrl is required.',
    });
  }

  const result = await buildRoundLeaderProjection({
    baseUrl,
    leaderboardUrl,
    tourcastUrl,
    courseStatsUrl,
    selectedStats,
    statOverrides,
    scoreOverrides,
    uploadedSgCsv,
  });

  return res.json({
    ok: true,
    data: result,
  });
});

toolsRouter.post('/round-leader-projection/validate-sg-csv', async (req, res) => {
  const { uploadedSgCsv } = req.body || {};
  const data = validateUploadedSgCsv(uploadedSgCsv);
  return res.json({
    ok: true,
    data,
  });
});

toolsRouter.get('/round-leader-projection/events', async (_req, res) => {
  const data = await getRoundLeaderProjectionEvents();
  return res.json({
    ok: true,
    data,
  });
});

toolsRouter.post('/round-leader-projection/events/refresh', async (_req, res) => {
  const data = await refreshRoundLeaderProjectionEvents();
  return res.json({
    ok: true,
    data,
  });
});

toolsRouter.get('/basketball-modeling/meta', async (_req, res) => {
  const data = await getModelingMeta();
  return res.json({
    ok: true,
    data,
  });
});

toolsRouter.post('/basketball-modeling/preview-pool', async (req, res) => {
  const { poolFilters = {} } = req.body || {};
  const data = await buildResultsPoolPreview(poolFilters);

  return res.json({
    ok: true,
    data,
  });
});

toolsRouter.post('/basketball-modeling/validate-config', async (req, res) => {
  const payload = req.body || {};
  const modelingMeta = await getModelingMeta();
  const validation = validateBasketballModelingConfig(payload, modelingMeta.statsColumns);

  return res.status(validation.ok ? 200 : 400).json({
    ok: validation.ok,
    errors: validation.errors,
    warnings: validation.warnings,
    data: {
      statsColumnsCount: modelingMeta.statsColumnsCount,
      resultsRowsCount: modelingMeta.resultsRowsCount,
    },
  });
});

toolsRouter.post('/basketball-modeling/run', async (req, res) => {
  const payload = req.body || {};
  const data = await runBasketballModel(payload);

  return res.status(201).json({
    ok: true,
    data,
  });
});

toolsRouter.get('/basketball-modeling/run/:runId', async (req, res) => {
  const { runId } = req.params;
  const data = buildRunDetails(runId);
  return res.json({
    ok: true,
    data,
  });
});

toolsRouter.post('/basketball-modeling/predict', async (req, res) => {
  const payload = req.body || {};
  const data = await predictMatchup(payload);
  return res.json({
    ok: true,
    data,
  });
});

toolsRouter.post('/basketball-modeling/save-model', async (req, res) => {
  const payload = req.body || {};
  const data = await saveModelFromRun(payload);
  return res.status(201).json({
    ok: true,
    data,
  });
});

toolsRouter.get('/basketball-modeling/saved-models', async (_req, res) => {
  const data = await listSavedModels();
  return res.json({
    ok: true,
    data,
  });
});

toolsRouter.post('/basketball-modeling/saved-models/:savedModelId/load', async (req, res) => {
  const { savedModelId } = req.params;
  const data = await loadSavedModel(savedModelId);
  return res.json({
    ok: true,
    data,
  });
});

toolsRouter.delete('/basketball-modeling/saved-models/:savedModelId', async (req, res) => {
  const { savedModelId } = req.params;
  const data = await deleteSavedModel(savedModelId);
  return res.json({
    ok: true,
    data,
  });
});

toolsRouter.get('/basketball-modeling/saved-models/:savedModelId/export', async (req, res) => {
  const { savedModelId } = req.params;
  const data = await exportSavedModel(savedModelId);
  return res.json({
    ok: true,
    data,
  });
});

module.exports = {
  toolsRouter,
};
