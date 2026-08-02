const http = require('http');
const app = require('./app');
const env = require('./config/env');
const { connectDB } = require('./config/db');
const { initRealtime } = require('./realtime/io');

async function start() {
  await connectDB();

  const server = http.createServer(app);
  initRealtime(server);

  server.listen(env.port, () => {
    console.log(`Nagar Sewa API listening on http://localhost:${env.port} [${env.nodeEnv}]`);
  });

  const shutdown = (signal) => {
    console.log(`\n${signal} received, shutting down...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  };

  ['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, () => shutdown(sig)));
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
