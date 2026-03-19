function errorHandler(err, _req, res, _next) {
  const status = err.status || 500;
  const message = err.message || 'Internal server error';

  if (status >= 500) {
    // Keep server-side visibility for unexpected failures.
    console.error('[BetLab API Error]', err);
  }

  res.status(status).json({
    ok: false,
    error: message,
  });
}

module.exports = {
  errorHandler,
};
