'use strict';

const config = require('../../../shared/config');
const { postBreaker } = require('../circuitBreaker/breakers');

const POST_SERVICE_URL = config.envStr('FEED_POST_SERVICE_URL', 'http://localhost:7001');

function tag() {
  return `[FEED:${process.env.PORT || config.envInt('FEED_PORT', 7004)}]`;
}

/**
 * Calls the Post Service through the "feed:post" circuit breaker.
 * Returns { ok, posts }.
 */
async function getPosts(email) {
  const result = await postBreaker.execute(async () => {
    console.log(`${tag()} Calling Post Service`);
    const response = await fetch(`${POST_SERVICE_URL}/posts?email=${encodeURIComponent(email)}`, {
      signal: AbortSignal.timeout(config.DOWNSTREAM_TIMEOUT_MS)
    });
    if (!response.ok) {
      throw new Error(`Post Service returned ${response.status}`);
    }
    return response.json();
  });

  if (result.ok) {
    console.log(`${tag()} Post Service responded with ${result.data.posts.length} posts`);
    return { ok: true, posts: result.data.posts, degraded: result.data.degraded === true };
  }

  if (result.skipped) {
    console.log(`${tag()} Post call skipped - feed:post circuit is OPEN`);
  } else {
    console.log(`${tag()} Post Service call failed: ${result.error}`);
  }

  return { ok: false, posts: [], degraded: true };
}

module.exports = { getPosts, postBreaker };
