const express = require('express');
const { buildRoundLeaderProjection } = require('../services/roundLeaderProjectionService');

const toolsRouter = express.Router();

toolsRouter.get('/ping', (_req, res) => {
  res.json({
    ok: true,
    message: 'Tools API is reachable.',
  });
});

toolsRouter.post('/round-leader-projection', async (req, res) => {
  const { leaderboardUrl, tourcastUrl } = req.body || {};

  if (!leaderboardUrl || !tourcastUrl) {
    return res.status(400).json({
      ok: false,
      error: 'leaderboardUrl and tourcastUrl are required.',
    });
  }

  const result = await buildRoundLeaderProjection({
    leaderboardUrl,
    tourcastUrl,
  });

  return res.json({
    ok: true,
    data: result,
  });
});

module.exports = {
  toolsRouter,
};
