const { BasketballSavedModel } = require('../../models/BasketballSavedModel');
const { createHttpError } = require('./errors');
const { getRunRecord, upsertRunRecord, buildRunSummary } = require('./runStoreService');

function cloneSerializable(value) {
  return JSON.parse(JSON.stringify(value));
}

function toSavedModelListItem(doc) {
  const runRecord = doc.runRecord || {};
  return {
    id: String(doc._id),
    name: doc.name,
    runId: doc.runId,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    featureCount: runRecord.featureCount ?? null,
    rowCounts: runRecord.rowCounts ?? null,
    metrics: runRecord.metrics ?? null,
  };
}

async function saveModelFromRun({ runId, name }) {
  const normalizedRunId = String(runId || '').trim();
  if (!normalizedRunId) {
    throw createHttpError(400, 'runId is required.');
  }

  const normalizedName = String(name || '').trim();
  if (!normalizedName) {
    throw createHttpError(400, 'name is required.');
  }

  const runRecord = getRunRecord(normalizedRunId);
  const saved = await BasketballSavedModel.create({
    name: normalizedName,
    runId: runRecord.runId,
    runRecord: cloneSerializable(runRecord),
  });

  return {
    id: String(saved._id),
    name: saved.name,
    runId: saved.runId,
    createdAt: saved.createdAt,
  };
}

async function listSavedModels() {
  const docs = await BasketballSavedModel.find({})
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  return docs.map(toSavedModelListItem);
}

async function loadSavedModel(savedModelId) {
  const normalizedId = String(savedModelId || '').trim();
  if (!normalizedId) {
    throw createHttpError(400, 'savedModelId is required.');
  }

  const doc = await BasketballSavedModel.findById(normalizedId).lean();
  if (!doc) {
    throw createHttpError(404, `Saved model not found: ${normalizedId}`);
  }

  const runRecord = doc.runRecord || {};
  if (!runRecord.runId) {
    throw createHttpError(500, 'Saved model is missing runRecord.runId.');
  }

  upsertRunRecord(runRecord);

  return {
    savedModel: toSavedModelListItem(doc),
    runSummary: buildRunSummary(runRecord),
    config: runRecord.config || null,
  };
}

async function deleteSavedModel(savedModelId) {
  const normalizedId = String(savedModelId || '').trim();
  if (!normalizedId) {
    throw createHttpError(400, 'savedModelId is required.');
  }

  const deleted = await BasketballSavedModel.findByIdAndDelete(normalizedId).lean();
  if (!deleted) {
    throw createHttpError(404, `Saved model not found: ${normalizedId}`);
  }

  return {
    id: String(deleted._id),
    name: deleted.name,
    runId: deleted.runId,
  };
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter((value) => typeof value === 'string' && value.trim()))];
}

async function exportSavedModel(savedModelId) {
  const normalizedId = String(savedModelId || '').trim();
  if (!normalizedId) {
    throw createHttpError(400, 'savedModelId is required.');
  }

  const doc = await BasketballSavedModel.findById(normalizedId).lean();
  if (!doc) {
    throw createHttpError(404, `Saved model not found: ${normalizedId}`);
  }

  const runRecord = doc.runRecord || {};
  const statFeatureRules = runRecord.config?.featureConfig?.statFeatureRules || [];
  const selectedStats = uniqueStrings(statFeatureRules.map((rule) => rule?.statColumn));
  const crossPairStats = uniqueStrings(statFeatureRules.map((rule) => rule?.crossPairStatColumn));

  return {
    id: String(doc._id),
    name: doc.name,
    runId: doc.runId,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    modelType: runRecord.modelType || 'ridge',
    selectedStats,
    crossPairStats,
    config: runRecord.config || null,
    featureCount: runRecord.featureCount ?? null,
    rowCounts: runRecord.rowCounts ?? null,
    diagnostics: runRecord.diagnostics ?? null,
    metrics: runRecord.metrics ?? null,
    warnings: runRecord.warnings || [],
  };
}

module.exports = {
  saveModelFromRun,
  listSavedModels,
  loadSavedModel,
  deleteSavedModel,
  exportSavedModel,
};
