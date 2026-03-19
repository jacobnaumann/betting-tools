const express = require('express');
const cors = require('cors');
const { CORS_ORIGIN } = require('./config');
const { apiRouter } = require('./routes');
const { notFound } = require('./middleware/notFound');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use(
  cors({
    origin: CORS_ORIGIN,
  })
);
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    name: 'BetLab API',
    version: '1.0.0',
  });
});

app.use('/api', apiRouter);
app.use(notFound);
app.use(errorHandler);

module.exports = {
  app,
};
