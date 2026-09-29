'use strict';

const express = require('express');
const { getProfile } = require('../services/profileClient');
const { getPosts } = require('../services/postClient');
const { profileBreaker, postBreaker } = require('../circuitBreaker/breakers');

const router = express.Router();

const PORT = parseInt(process.env.PORT || 7004, 10);

// GET /feed?email=aakash@example.com
router.get('/feed', async (req, res) => {
  const email = req.query.email;
  if (!email) {
    return res.status(400).json({ success: false, message: 'email query param is required' });
  }

  console.log(`[FEED:${PORT}] GET /feed?email=${email}`);

  // Both calls run concurrently. Each one is guarded by its own circuit breaker.
  const [profileResult, postsResult] = await Promise.all([
    getProfile(email),
    getPosts(email)
  ]);

  // notFound means the Profile Service answered but has no such profile -
  // that is not a failure, so it does not mark the feed as degraded.
  const profileOk = profileResult.ok || profileResult.notFound === true;
  const postsOk = postsResult.ok;
  const degraded = !(profileOk && postsOk);

  const response = {
    success: true,
    instance: PORT,
    email,
    profile: profileOk ? profileResult.profile : null,
    posts: postsOk ? postsResult.posts : [],
    degraded,
    message: degraded ? 'Some feed data is temporarily unavailable' : null,
    circuitBreakers: {
      'feed:profile': profileBreaker.getState(),
      'feed:post': postBreaker.getState()
    }
  };

  if (degraded) {
    const missing = [!profileOk ? 'profile' : null, !postsOk ? 'posts' : null].filter(Boolean).join(' + ');
    console.log(`[FEED:${PORT}] Degraded response (${missing} unavailable)`);
  } else {
    console.log(`[FEED:${PORT}] Full response - ${response.posts.length} posts`);
  }

  return res.json(response);
});

module.exports = router;
