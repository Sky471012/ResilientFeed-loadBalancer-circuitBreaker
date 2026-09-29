'use strict';

const express = require('express');
const config = require('../shared/config');

const LB_PORT = config.envInt('LB_PORT', 8000);
const HEALTH_PROBE_MS = config.envInt('LB_HEALTH_PROBE_MS', 3000);
const UPSTREAM_TIMEOUT_MS = config.envInt('UPSTREAM_TIMEOUT_MS', 8000);

const rawTargets = config.envStr(
  'FEED_TARGETS',
  'http://localhost:7004,http://localhost:7005,http://localhost:7006'
);

// Round-robin state: every target starts healthy.
const targets = rawTargets
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean)
  .map((url, index) => {
    let port = '';
    try {
      port = new URL(url).port;
    } catch (err) {
      // keep port empty if the URL is malformed
    }
    return {
      name: `Feed #${index + 1}`,
      url: url.replace(/\/$/, ''),
      port,
      label: `Feed #${index + 1} :${port}`,
      healthy: true
    };
  });

let cursor = 0;
let totalProxied = 0;

const app = express();

function pickTarget() {
  for (let i = 0; i < targets.length; i += 1) {
    const candidate = targets[(cursor + i) % targets.length];
    if (candidate.healthy) {
      cursor = (cursor + i + 1) % targets.length;
      return candidate;
    }
  }
  return null;
}

function markDown(target, reason) {
  if (target.healthy) {
    target.healthy = false;
    console.log(`[LB] ${target.label} is DOWN (${reason}) - removing from rotation`);
  }
}

function markUp(target) {
  if (!target.healthy) {
    target.healthy = true;
    console.log(`[LB] ${target.label} is UP again - adding back to rotation`);
  }
}

// GET /feed -> proxies to the next Feed instance (round-robin)
app.get('/feed', async (req, res) => {
  const target = pickTarget();

  if (!target) {
    console.log('[LB] No healthy Feed instance available - returning 503');
    return res.status(503).json({ success: false, message: 'No Feed instance available' });
  }

  totalProxied += 1;
  console.log(`[LB] Request /feed -> ${target.label}`);

  const query = new URLSearchParams(req.query).toString();
  const upstreamUrl = `${target.url}/feed${query ? `?${query}` : ''}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });
    const body = await upstream.text();
    res.status(upstream.status);
    res.set('content-type', upstream.headers.get('content-type') || 'application/json');
    return res.send(body);
  } catch (err) {
    markDown(target, err.message);
    return res.status(502).json({
      success: false,
      message: `${target.name} is unavailable`,
      error: err.message
    });
  }
});

// GET /health -> Load Balancer health plus the state of every target
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'load-balancer',
    port: LB_PORT,
    totalProxied,
    targets: targets.map((t) => ({ name: t.name, url: t.url, healthy: t.healthy }))
  });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});

// Background health checks so a Feed instance that comes back is re-added.
setInterval(async () => {
  for (const target of targets) {
    try {
      const response = await fetch(`${target.url}/health`, {
        signal: AbortSignal.timeout(1500)
      });
      if (response.ok) {
        markUp(target);
      } else {
        markDown(target, `health check returned ${response.status}`);
      }
    } catch (err) {
      markDown(target, err.message);
    }
  }
}, HEALTH_PROBE_MS);

app.listen(LB_PORT, () => {
  console.log(`[LB] Load Balancer listening on http://localhost:${LB_PORT}`);
  console.log(`[LB] Round-robin targets: ${targets.map((t) => t.label).join(', ')}`);
  console.log(`[LB] Try: curl "http://localhost:${LB_PORT}/feed?email=aakash@example.com"`);
});
