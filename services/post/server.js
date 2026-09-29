'use strict';

const express = require('express');
const mongoose = require('mongoose');
const config = require('../../shared/config');
const redisSync = require('../../shared/redis/redisSync');
const Post = require('./models/Post');
const postRoutes = require('./routes/postRoutes');
const { profileBreaker } = require('./circuitBreaker/breakers');

const PORT = config.envInt('POST_PORT', 7001);

const app = express();
app.use(express.json());

const startedAt = Date.now();

// GET /health
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'post',
    port: PORT,
    mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptimeMs: Date.now() - startedAt
  });
});

// GET /health/circuit-breakers
app.get('/health/circuit-breakers', (req, res) => {
  res.json({
    instance: `post:${PORT}`,
    breakers: [profileBreaker.getStats()]
  });
});

app.use('/', postRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});

async function start() {
  await redisSync.init(`post:${PORT}`);

  await mongoose.connect(config.MONGODB_URI);
  console.log(`[POST] Connected to MongoDB (${config.MONGODB_URI})`);
  await Post.seedIfEmpty();

  app.listen(PORT, () => {
    console.log(`[POST] Post Service listening on http://localhost:${PORT}`);
    console.log(`[POST] Try: curl "http://localhost:${PORT}/posts?email=aakash@example.com"`);
  });
}

start().catch((err) => {
  console.log(`[POST] Failed to start: ${err.message}`);
  console.log('[POST] Is MongoDB running? See README section "How to start every service".');
  process.exit(1);
});
