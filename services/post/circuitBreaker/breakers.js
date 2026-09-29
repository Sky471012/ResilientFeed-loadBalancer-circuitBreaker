'use strict';

const { createBreaker } = require('../../../shared/circuitBreaker');

// Post Service -> Profile Service
const profileBreaker = createBreaker('post:profile');

module.exports = { profileBreaker };
