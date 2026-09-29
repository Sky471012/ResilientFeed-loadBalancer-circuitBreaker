'use strict';

const config = require('../../../shared/config');
const { profileBreaker } = require('../circuitBreaker/breakers');

const PROFILE_SERVICE_URL = config.envStr('PROFILE_SERVICE_URL', 'http://localhost:7000');

/**
 * Calls the Profile Service through the "post:profile" circuit breaker.
 * Returns { ok, profile } - profile is null when the call was skipped or failed.
 */
async function getProfile(email) {
  const result = await profileBreaker.execute(async () => {
    console.log('[POST] Calling Profile Service');
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
      console.log(`[POST] Profile not found for ${email} - returning posts unpersonalized`);
      return { ok: false, notFound: true, profile: null };
    }
    console.log('[POST] Profile received from Profile Service');
    return { ok: true, profile: result.data };
  }

  if (result.skipped) {
    console.log('[POST] Profile call skipped - post:profile circuit is OPEN');
  } else {
    console.log(`[POST] Profile request failed: ${result.error}`);
  }

  return { ok: false, profile: null };
}

module.exports = { getProfile, profileBreaker };
