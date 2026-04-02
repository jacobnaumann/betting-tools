const crypto = require('node:crypto');
const { createHttpError } = require('./errors');

const MAX_RUNS = 50;
const runs = [];
const runById = new Map();

function generateRunId() {
  return `bm-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function buildRunSummary(runRecord) {
  return {
    runId: runRecord.runId,
    createdAt: runRecord.createdAt,
    modelType: runRecord.modelType,
    featureCount: runRecord.featureCount,
    rowCounts: runRecord.rowCounts,
    metrics: runRecord.metrics,
    warnings: runRecord.warnings,
  };
}

function saveRunRecord(runRecord) {
  upsertRunRecord(runRecord);
  return buildRunSummary(runRecord);
}

function upsertRunRecord(runRecord) {
  const existingIndex = runs.findIndex((row) => row.runId === runRecord.runId);
  if (existingIndex >= 0) {
    runs.splice(existingIndex, 1);
  }

  runs.unshift(runRecord);
  runById.set(runRecord.runId, runRecord);

  while (runs.length > MAX_RUNS) {
    const removed = runs.pop();
    if (removed) runById.delete(removed.runId);
  }
}

function getRunRecord(runId) {
  const run = runById.get(runId);
  if (!run) {
    throw createHttpError(404, `Basketball modeling run not found: ${runId}`);
  }
  return run;
}

module.exports = {
  generateRunId,
  saveRunRecord,
  upsertRunRecord,
  getRunRecord,
  buildRunSummary,
};
