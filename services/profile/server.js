'use strict';

const express = require('express');
const mongoose = require('mongoose');
const config = require('../../shared/config');
const Profile = require('./models/Profile');
const profileRoutes = require('./routes/profileRoutes');

const PORT = config.envInt('PROFILE_PORT', 7000);

const app = express();
app.use(express.json());

const startedAt = Date.now();

// GET /health
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'profile',
    port: PORT,
    mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptimeMs: Date.now() - startedAt
  });
});

app.use('/', profileRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});

mongoose
  .connect(config.MONGODB_URI)
  .then(async () => {
    console.log(`[PROFILE] Connected to MongoDB (${config.MONGODB_URI})`);
    await Profile.seedIfEmpty();
    app.listen(PORT, () => {
      console.log(`[PROFILE] Profile Service listening on http://localhost:${PORT}`);
      console.log(`[PROFILE] Try: curl http://localhost:${PORT}/profiles/aakash@example.com`);
    });
  })
  .catch((err) => {
    console.log(`[PROFILE] MongoDB connection failed: ${err.message}`);
    console.log('[PROFILE] Is MongoDB running? See README section "How to start every service".');
    process.exit(1);
  });
