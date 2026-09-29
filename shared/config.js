'use strict';

const path = require('path');
const dotenv = require('dotenv');

// Every service loads the same root .env file.
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function envBool(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function envInt(name, defaultValue) {
  const parsed = parseInt(process.env[name], 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function envStr(name, defaultValue) {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? defaultValue : raw;
}

module.exports = {
  MONGODB_URI: envStr('MONGODB_URI', 'mongodb://127.0.0.1:27017/resilient_feed'),
  REDIS_URL: envStr('REDIS_URL', 'redis://127.0.0.1:6379'),
  DOWNSTREAM_TIMEOUT_MS: envInt('DOWNSTREAM_TIMEOUT_MS', 3000),
  circuitBreaker: {
    failureThreshold: envInt('FAILURE_THRESHOLD', 3),
    successThreshold: envInt('SUCCESS_THRESHOLD', 2),
    openTimeoutMs: envInt('OPEN_TIMEOUT_MS', 10000),
    halfOpenMaxRequests: envInt('HALF_OPEN_MAX_REQUESTS', 1),
    enabled: envBool('CIRCUIT_BREAKER_ENABLED', true)
  },
  envBool,
  envInt,
  envStr
};
