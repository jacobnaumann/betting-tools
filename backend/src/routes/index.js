const express = require('express');
const { healthRouter } = require('./health');
const { toolsRouter } = require('./tools');

const apiRouter = express.Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/tools', toolsRouter);

module.exports = {
  apiRouter,
};
