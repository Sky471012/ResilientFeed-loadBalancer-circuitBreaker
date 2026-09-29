'use strict';

const config = require('../../shared/config');

// Resolve our port FIRST so every module (routes, clients) sees the same value.
const PORT = config.envInt('PORT', config.envInt('FEED_PORT', 7004));
process.env.PORT = String(PORT);

const express = require('express');
const redisSync = require('../../shared/redis/redisSync');
const feedRoutes = require('./routes/feedRoutes');
const { profileBreaker, postBreaker } = require('./circuitBreaker/breakers');

const app = express();

const startedAt = Date.now();

// GET /health
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'feed',
    port: PORT,
    uptimeMs: Date.now() - startedAt
  });
});

// GET /health/circuit-breakers
app.get('/health/circuit-breakers', (req, res) => {
  res.json({
    instance: `feed:${PORT}`,
    breakers: [profileBreaker.getStats(), postBreaker.getStats()]
  });
});

app.use('/', feedRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});

async function start() {
  await redisSync.init(`feed:${PORT}`);

  app.listen(PORT, () => {
    console.log(`[FEED:${PORT}] Feed Service instance listening on http://localhost:${PORT}`);
    console.log(`[FEED:${PORT}] Try: curl "http://localhost:${PORT}/feed?email=aakash@example.com"`);
  });
}

start().catch((err) => {
  console.log(`[FEED:${PORT}] Failed to start: ${err.message}`);
  process.exit(1);
});
