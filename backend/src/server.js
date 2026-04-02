const { app } = require('./app');
const { PORT } = require('./config');
const { connectToMongo, disconnectFromMongo } = require('./db');

let server;

async function startServer() {
  await connectToMongo();
  console.log('MongoDB connection established.');

  server = app.listen(PORT, () => {
    console.log(`BetLab backend listening on http://localhost:${PORT}`);
  });
}

async function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);

  if (server) {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }

  await disconnectFromMongo();
  process.exit(0);
}

process.on('SIGINT', () => {
  shutdown('SIGINT').catch((error) => {
    console.error('Graceful shutdown failed:', error);
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch((error) => {
    console.error('Graceful shutdown failed:', error);
    process.exit(1);
  });
});

startServer().catch((error) => {
  console.error('Failed to start backend:', error);
  process.exit(1);
});
