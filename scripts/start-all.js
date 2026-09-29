'use strict';

// Starts every process of ResilientFeed in one terminal with clear tags:
//   [PROFILE] [POST] [FEED#1] [FEED#2] [FEED#3]  and raw [LB] logs.
// Press Ctrl+C to stop everything.

const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const children = [];

const PROCESSES = [
  { tag: 'PROFILE', args: ['services/profile/server.js'], delay: 0 },
  { tag: 'POST', args: ['services/post/server.js'], delay: 300 },
  { tag: 'FEED#1', args: ['scripts/run-feed.js', '7004'], delay: 600 },
  { tag: 'FEED#2', args: ['scripts/run-feed.js', '7005'], delay: 800 },
  { tag: 'FEED#3', args: ['scripts/run-feed.js', '7006'], delay: 1000 },
  { tag: '', args: ['load-balancer/server.js'], delay: 2000 }
];

// Lines that already identify their own service/instance are printed as-is,
// e.g. "[FEED:7004] Calling Profile Service" or "[PROFILE] Connected to MongoDB".
// Everything else (mainly "[CB:...]" lines) gets the process tag.
const SELF_IDENTIFYING = /^\[(FEED:|PROFILE\]|POST\]|LB\]|REDIS:)/;

function pipeOutput(tag, stream, isError) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.trim() === '') continue;
      const prefix = tag && !SELF_IDENTIFYING.test(line) ? `[${tag}] ` : '';
      if (isError) {
        console.error(prefix + line);
      } else {
        console.log(prefix + line);
      }
    }
  });
}

function start(entry) {
  const child = spawn(process.execPath, entry.args, {
    cwd: root,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  pipeOutput(entry.tag, child.stdout, false);
  pipeOutput(entry.tag, child.stderr, true);

  child.on('exit', (code, signal) => {
    const label = entry.tag ? `[${entry.tag}]` : '[LB]';
    console.log(`${label} exited (code=${code}, signal=${signal || 'none'})`);
  });

  children.push(child);
}

console.log('Starting ResilientFeed...');
console.log('  Profile :7000 | Post :7001 | Feed :7004 :7005 :7006 | Load Balancer :8000');
console.log('  Press Ctrl+C to stop everything.\n');

for (const entry of PROCESSES) {
  setTimeout(() => start(entry), entry.delay);
}

function shutdown() {
  console.log('\nStopping all services...');
  for (const child of children) {
    if (!child.killed) child.kill('SIGINT');
  }
  setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
