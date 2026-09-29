'use strict';

const express = require('express');
const Post = require('../models/Post');
const config = require('../../../shared/config');
const { getProfile } = require('../services/profileClient');
const { profileBreaker } = require('../circuitBreaker/breakers');

const router = express.Router();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// GET /posts?email=aakash@example.com
router.get('/posts', async (req, res) => {
  const email = req.query.email;
  if (!email) {
    return res.status(400).json({ success: false, message: 'email query param is required' });
  }

  const delayMs = config.envInt('POST_DELAY_MS', 0);
  if (delayMs > 0) {
    console.log(`[POST] POST_DELAY_MS=${delayMs} - delaying response`);
    await sleep(delayMs);
  }

  if (config.envBool('POST_FAIL', false)) {
    console.log(`[POST] POST_FAIL=true - returning 500 for ${email}`);
    return res.status(500).json({ success: false, message: 'Post Service simulated failure' });
  }

  try {
    // 1) Get the profile (protected by the post:profile circuit breaker)
    const profileResult = await getProfile(email);

    // 2) Load posts from our own database
    const allPosts = await Post.find().sort({ createdAt: -1 }).limit(20).lean();

    // 3) Personalize using the profile
    let posts = allPosts;
    let personalized = false;

    if (profileResult.ok) {
      const preferred = profileResult.profile.preferredCategories || [];
      const filtered = allPosts.filter((post) => preferred.includes(post.category));
      if (filtered.length > 0) {
        posts = filtered;
        personalized = true;
        console.log(`[POST] Personalized ${posts.length}/${allPosts.length} posts for preferred categories [${preferred.join(', ')}]`);
      } else {
        console.log('[POST] No posts matched the preferred categories - returning all posts');
      }
    }

    const degraded = !profileResult.ok && profileResult.notFound !== true;
    console.log(`[POST] Responding with ${posts.length} posts${degraded ? ' (degraded - profile unavailable)' : ''}`);

    return res.json({
      success: true,
      email,
      posts,
      personalized,
      profile: profileResult.ok ? profileResult.profile : null,
      degraded,
      message: degraded ? 'Profile Service unavailable - posts are not personalized' : null,
      circuitBreakers: { 'post:profile': profileBreaker.getState() }
    });
  } catch (err) {
    console.log(`[POST] Error building posts response: ${err.message}`);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
