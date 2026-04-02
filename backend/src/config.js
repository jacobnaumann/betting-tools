require('dotenv').config({ quiet: true });

const PORT = Number(process.env.PORT) || 5000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
const MONGO_DB_URI = process.env.MONGO_DB_URI || process.env.mongo_db_uri || '';

module.exports = {
  PORT,
  CORS_ORIGIN,
  MONGO_DB_URI,
};
