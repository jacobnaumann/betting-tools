const express = require('express');

const healthRouter = express.Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'betlab-backend',
    timestamp: new Date().toISOString(),
  });
});

module.exports = {
  healthRouter,
};
