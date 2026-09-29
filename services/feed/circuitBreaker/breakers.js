'use strict';

const { createBreaker } = require('../../../shared/circuitBreaker');

// Feed -> Profile  and  Feed -> Post  (two independent breakers)
const profileBreaker = createBreaker('feed:profile');
const postBreaker = createBreaker('feed:post');

module.exports = { profileBreaker, postBreaker };
