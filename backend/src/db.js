const mongoose = require('mongoose');
const { MONGO_DB_URI } = require('./config');

async function connectToMongo() {
  if (!MONGO_DB_URI) {
    throw new Error('MONGO_DB_URI (or mongo_db_uri) is required to start the backend.');
  }

  await mongoose.connect(MONGO_DB_URI, {
    serverSelectionTimeoutMS: 10000,
  });
}

async function disconnectFromMongo() {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
}

module.exports = {
  connectToMongo,
  disconnectFromMongo,
};
