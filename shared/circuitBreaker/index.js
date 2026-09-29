'use strict';

const CircuitBreaker = require('./CircuitBreaker');
const config = require('../config');
const redisSync = require('../redis/redisSync');

/**
 * Creates a breaker wired to Redis state synchronization.
 * name is always "<source>:<target>", e.g. "feed:profile" or "post:profile".
 */
function createBreaker(name, options = {}) {
  const [source, target] = String(name).split(':');

  const breaker = new CircuitBreaker({
    name,
    ...config.circuitBreaker,
    ...options,
    onStateChange(oldState, newState, stats) {
      redisSync.publishStateChange({
        source,
        target,
        oldState,
        newState,
        failureCount: stats.failureCount,
        timestamp: new Date().toISOString(),
        instance: redisSync.instanceId
      });
    }
  });

  redisSync.registerBreaker(breaker);
  return breaker;
}

module.exports = CircuitBreaker;
module.exports.createBreaker = createBreaker;
module.exports.STATES = CircuitBreaker.STATES;
