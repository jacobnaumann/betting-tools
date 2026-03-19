const PORT = Number(process.env.PORT) || 5000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

module.exports = {
  PORT,
  CORS_ORIGIN,
};
