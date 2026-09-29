'use strict';

// Usage: node scripts/run-feed.js <port>
const port = process.argv[2];

if (!port) {
  console.log('Usage: node scripts/run-feed.js <port>');
  process.exit(1);
}

process.env.PORT = port;
require('../services/feed/server.js');
