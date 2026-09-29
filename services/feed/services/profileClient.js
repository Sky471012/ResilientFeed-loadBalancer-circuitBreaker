'use strict';

const config = require('../../../shared/config');
const { profileBreaker } = require('../circuitBreaker/breakers');

const PROFILE_SERVICE_URL = config.envStr('FEED_PROFILE_SERVICE_URL', 'http://localhost:7000');

function tag() {
  return `[FEED:${process.env.PORT || config.envInt('FEED_PORT', 7004)}]`;
}

/**
 * Calls the Profile Service through the "feed:profile" circuit breaker.
 * Returns { ok, profile }.
 */
async function getProfile(email) {
  const result = await profileBreaker.execute(async () => {
    console.log(`${tag()} Calling Profile Service`);
    const response = await fetch(`${PROFILE_SERVICE_URL}/profiles/${encodeURIComponent(email)}`, {
      signal: AbortSignal.timeout(config.DOWNSTREAM_TIMEOUT_MS)
    });
    if (response.status === 404) {
      // The service answered - that is a healthy call, just no data.
      return { notFound: true };
    }
    if (!response.ok) {
      throw new Error(`Profile Service returned ${response.status}`);
    }
    return response.json();
  });

  if (result.ok) {
    if (result.data && result.data.notFound) {
      console.log(`${tag()} Profile not found for ${email}`);
      return { ok: false, notFound: true, profile: null };
    }
    console.log(`${tag()} Profile Service responded`);
    return { ok: true, profile: result.data };
  }

  if (result.skipped) {
    console.log(`${tag()} Profile call skipped - feed:profile circuit is OPEN`);
  } else {
    console.log(`${tag()} Profile Service call failed: ${result.error}`);
  }

  return { ok: false, profile: null };
}

module.exports = { getProfile, profileBreaker };
