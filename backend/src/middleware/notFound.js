function notFound(req, res) {
  res.status(404).json({
    ok: false,
    error: 'Route not found',
    path: req.originalUrl,
  });
}

module.exports = {
  notFound,
};
