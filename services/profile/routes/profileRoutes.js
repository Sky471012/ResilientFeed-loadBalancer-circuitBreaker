'use strict';

const express = require('express');
const Profile = require('../models/Profile');
const config = require('../../../shared/config');

const router = express.Router();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// GET /profiles/:email
router.get('/profiles/:email', async (req, res) => {
  const email = String(req.params.email).toLowerCase();

  const delayMs = config.envInt('PROFILE_DELAY_MS', 0);
  if (delayMs > 0) {
    console.log(`[PROFILE] PROFILE_DELAY_MS=${delayMs} - delaying response`);
    await sleep(delayMs);
  }

  if (config.envBool('PROFILE_FAIL', false)) {
    console.log(`[PROFILE] PROFILE_FAIL=true - returning 500 for ${email}`);
    return res.status(500).json({ success: false, message: 'Profile Service simulated failure' });
  }

  try {
    const profile = await Profile.findOne({ email });
    if (!profile) {
      console.log(`[PROFILE] Profile not found for ${email}`);
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }
    console.log(`[PROFILE] Served profile for ${email}`);
    return res.json({
      email: profile.email,
      name: profile.name,
      interests: profile.interests,
      preferredCategories: profile.preferredCategories
    });
  } catch (err) {
    console.log(`[PROFILE] Error reading profile: ${err.message}`);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
