# ResilientFeed

A small Node.js microservices project for **learning system design concepts**:

- **Round-robin load balancing**
- **Circuit breakers** (`CLOSED` / `OPEN` / `HALF_OPEN`)
- **Cascading failures** and how to contain them
- **Redis Pub/Sub** for synchronizing circuit-breaker state between instances
- **MongoDB** for application data

Everything runs **locally**. No Docker, no Kubernetes, no Nginx, no cloud.

> JavaScript only (no TypeScript), Node.js + Express, plain `console.log` output so you can *watch* the concepts happen.

---

## 1. What this project demonstrates

| Concept            | Where to see it                                                                                    |
|--------------------|----------------------------------------------------------------------------------------------------|
| Load balancing     | `load-balancer/` spreads `/feed` requests over 3 Feed instances                                    |
| Cascading failure  | Profile is slow/down -> Post gets slow/down -> Feed gets slow/down                                 |
| Circuit breaker    | After 3 failures a breaker opens and calls are rejected **without** hitting the downstream service |
| Degraded responses | Feed still answers with `200` and a valid (but smaller) payload                                    |
| Recovery           | `OPEN -> HALF_OPEN -> CLOSED` after the downstream heals                                           |
| State sync         | Feed #1 opens a breaker -> Feed #2 and #3 learn about it over Redis                                |

---

## 2. Architecture

```
                    Client
                      |
                      v
              Load Balancer :8000
                      |
          +-----------+-----------+
          |           |           |
          v           v           v
       Feed #1     Feed #2     Feed #3
       :7004       :7005       :7006
          |           |           |
          +-----------+-----------+
                      |
              +-------+-------+
              |               |
              v               v
        Profile Service   Post Service
             :7000            :7001
                                |
                                v
                         Profile Service
                              :7000
```

**Dependency graph (one circuit breaker per arrow):**

```
Feed  ------> Profile      breaker name: feed:profile
Feed  ------> Post         breaker name: feed:post
Post  ------> Profile      breaker name: post:profile
```

**Services**

| Service         | Port               | Owns data                        | Depends on      |
|-----------------|--------------------|----------------------------------|-----------------|
| Profile Service | 7000               | `profiles` collection            | nothing         |
| Post Service    | 7001               | `posts` collection               | Profile Service |
| Feed Service x3 | 7004 / 7005 / 7006 | **none** (never touches MongoDB) | Profile + Post  |
| Load Balancer   | 8000               | none                             | Feed instances  |

**Redis** is used *only* to broadcast circuit state changes on the channel
`circuit-breaker-state`. Normal requests never touch Redis.

---

## 3. Project structure

```
resilient-feed/
│
├── load-balancer/
│   ├── server.js            round-robin proxy + health checks
│   └── package.json
│
├── services/
│   ├── profile/             Profile Service (:7000)
│   │   ├── server.js
│   │   ├── models/Profile.js
│   │   ├── routes/profileRoutes.js
│   │   └── package.json
│   │
│   ├── post/                Post Service (:7001)
│   │   ├── server.js
│   │   ├── models/Post.js
│   │   ├── routes/postRoutes.js
│   │   ├── services/profileClient.js      calls Profile (post:profile breaker)
│   │   ├── circuitBreaker/breakers.js
│   │   └── package.json
│   │
│   └── feed/                Feed Service (:7004 :7005 :7006 - same code)
│       ├── server.js
│       ├── routes/feedRoutes.js
│       ├── services/profileClient.js      calls Profile (feed:profile breaker)
│       ├── services/postClient.js         calls Post    (feed:post breaker)
│       ├── circuitBreaker/breakers.js
│       └── package.json
│
├── shared/
│   ├── circuitBreaker/CircuitBreaker.js   the reusable breaker class
│   ├── circuitBreaker/index.js            createBreaker() + Redis wiring
│   ├── redis/redisSync.js                 Redis Pub/Sub sync
│   └── config.js                          loads .env once for everyone
│
├── scripts/
│   ├── start-all.js        starts all 6 processes in one terminal
│   └── run-feed.js         starts one Feed instance on a given port
│
├── .env.example
├── package.json
└── README.md
```

Dependencies are installed **once at the root** (`npm install`). Each service
folder only has its own small `package.json` to keep the services clearly
separated.

---

## 4. Prerequisites

1. **Node.js 18+** (20/22 recommended)

   ```powershell
   node --version
   ```

2. **MongoDB** running on `mongodb://127.0.0.1:27017`
   - Windows: the MongoDB service usually already runs.
     Check with `Get-Service MongoDB*`
   - Or start it manually: `mongod --dbpath C:\data\db`

3. **Redis** running on `redis://127.0.0.1:6379`

   ```powershell
   redis-cli ping     # expect: PONG
   ```

---

## 5. How to start every service

### One-time setup

```powershell
cd "C:\path\to\resilient-feed"

Copy-Item .env.example .env
npm install
```

### Option A - everything in one terminal (recommended first run)

```powershell
npm run start:all
```

You will see tagged output from all processes:

```
[PROFILE] Profile Service listening on http://localhost:7000
[POST] Post Service listening on http://localhost:7001
[FEED:7004] Feed Service instance listening on http://localhost:7004
[FEED:7005] Feed Service instance listening on http://localhost:7005
[FEED:7006] Feed Service instance listening on http://localhost:7006
[LB] Load Balancer listening on http://localhost:8000
```

Press `Ctrl+C` to stop everything.

### Option B - one terminal per service (best for experiments)

Open 6 terminals (or tabs) in the project folder:

| Terminal | Command           |
|----------|-------------------|
| 1        | `npm run profile` |
| 2        | `npm run post`    |
| 3        | `npm run feed1`   |
| 4        | `npm run feed2`   |
| 5        | `npm run feed3`   |
| 6        | `npm run lb`      |

Sample data is seeded automatically the first time each service starts
(3 profiles, 12 posts).

### Quick smoke test

```powershell
curl.exe -s "http://localhost:8000/feed?email=aakash@example.com"
```

> PowerShell note: `curl` is an alias for `Invoke-WebRequest`, so use
> **`curl.exe`** (or `Invoke-RestMethod`) for the commands in this README.

---

## 6. Concepts explained

### 6.1 What a load balancer does

The Load Balancer is the single address clients talk to (`:8000`). It forwards
each `/feed` request to one of the three Feed instances using **round-robin**:

```
Request 1 -> Feed #1 :7004
Request 2 -> Feed #2 :7005
Request 3 -> Feed #3 :7006
Request 4 -> Feed #1 :7004
```

Benefits you can observe here:

- traffic is spread across instances (no single instance does all the work)
- if an instance dies, the LB **skips it** and keeps serving
- when it comes back, the LB **re-adds** it (health probe every 3s)

Logs:

```
[LB] Request /feed -> Feed #1 :7004
[LB] Feed #2 :7005 is DOWN (fetch failed) - removing from rotation
[LB] Feed #2 :7005 is UP again - adding back to rotation
```

### 6.2 What a circuit breaker does

A circuit breaker sits **in front of every remote call** and answers one
question: *"Should I even try this call right now?"*

- **Yes** -> the call is made
- **No** -> the call is *rejected immediately* and the caller falls back to a
  degraded response. The slow/broken downstream service is **not called at all**.

That is the whole trick: instead of every request waiting for a failing service,
most requests finish in ~1ms with a "best effort" answer.

### 6.3 CLOSED / OPEN / HALF_OPEN

```
        3 failures in a row
 CLOSED ---------------> OPEN
    ^                      |
    |                      | OPEN_TIMEOUT_MS (10s) passes
    |  2 successful        v
    +----- test requests- HALF_OPEN
                           |
                           | 1 test request fails
                           +-------> OPEN
```

**CLOSED** (normal)
- requests are allowed
- failures are counted
- after `FAILURE_THRESHOLD` (3) consecutive failures -> **OPEN**

**OPEN** (protection)
- requests are rejected immediately, the downstream service is **never called**
- after `OPEN_TIMEOUT_MS` (10000 ms) -> **HALF_OPEN**

**HALF_OPEN** (probing)
- only `HALF_OPEN_MAX_REQUESTS` (1) test request is allowed at a time
- test succeeds -> count it; after `SUCCESS_THRESHOLD` (2) successes -> **CLOSED**
- test fails -> straight back to **OPEN**

Observable logs:

```
[CB:post:profile] Failure 1/3
[CB:post:profile] Failure 2/3
[CB:post:profile] Failure 3/3
[CB:post:profile] CLOSED -> OPEN
[CB:post:profile] OPEN - request rejected without calling Profile Service
[CB:post:profile] OPEN -> HALF_OPEN
[CB:post:profile] HALF_OPEN - sending test request to Profile Service
[CB:post:profile] Test request succeeded (1/2)
[CB:post:profile] Test request succeeded (2/2)
[CB:post:profile] HALF_OPEN -> CLOSED
```

### 6.4 Cascading failure

Without circuit breakers, one slow dependency poisons everything upstream:

```
Profile slow (5s)
   -> Post waits 5s for every request -> Post looks "down"
      -> Feed waits 5s for every request -> Feed looks "down"
         -> Load Balancer queues requests -> users see timeouts
```

Each service holds resources (sockets, event-loop time) while waiting, so the
problem **spreads** instead of staying where it started. That is a cascade.

A circuit breaker cuts the chain: Post stops calling Profile, returns its own
data quickly, and Feed keeps working.

### 6.5 Why Post depends on Profile

Posts are *personalized*. `GET /posts?email=aakash@example.com`:

1. Post loads all posts from MongoDB
2. Post asks Profile for `preferredCategories` (`["tech","business"]`)
3. Post filters/sorts the posts for that user

If Profile is unavailable, Post still returns posts (just unpersonalized) and
sets `degraded: true`.

### 6.6 Why Feed depends on Post and Profile

Feed aggregates in one response:

- **Profile** -> who the user is (shown at the top of the feed)
- **Post** -> the actual content

Both calls run concurrently with `Promise.all`, and **each one has its own
breaker**, so a problem with one dependency does not take out the other.

### 6.7 Why circuit state is kept locally (in memory)

The normal request path must be fast:

```
Request -> local breaker check (microseconds) -> call downstream / reject
```

If every request asked Redis *"is the circuit open?"*, then Redis would become
a new single point of failure and add network latency to every call. So each
instance keeps its own copy in memory and only **publishes state changes**.

### 6.8 Why Redis Pub/Sub is used

Three Feed instances run the same code, but each one has its own memory.
Without synchronization, Feed #1 could be rejecting requests while Feed #2 is
still hammering a dead Post Service.

When any instance changes a breaker state it publishes to the channel
`circuit-breaker-state`:

```json
{
  "source": "feed",
  "target": "post",
  "oldState": "CLOSED",
  "newState": "OPEN",
  "failureCount": 3,
  "timestamp": "2026-09-28T19:50:18.368Z",
  "instance": "feed:7004"
}
```

Every instance subscribes, and if the message matches one of *its* breakers it
applies the change:

```
[REDIS:feed:7005] received feed:post CLOSED -> OPEN from feed:7004
[FEED#2] [CB:feed:post] Redis sync from feed:7004: CLOSED -> OPEN
```

So: **fast local reads + shared state on every change**.

### 6.9 How multiple Feed instances work

All three instances run the *same* code from `services/feed/`; only the port
differs (`PORT=7004|7005|7006`). They are independent processes, so:

- each one has its own breaker instances
- they learn from each other through Redis
- the load balancer can remove any one of them without downtime

---

## 7. Configuration (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/resilient_feed` | MongoDB connection |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection |
| `FAILURE_THRESHOLD` | `3` | failures before OPEN |
| `SUCCESS_THRESHOLD` | `2` | successful probes before CLOSED |
| `OPEN_TIMEOUT_MS` | `10000` | how long the breaker stays OPEN |
| `HALF_OPEN_MAX_REQUESTS` | `1` | concurrent probes allowed |
| `CIRCUIT_BREAKER_ENABLED` | `true` | `false` = count failures but never open |
| `DOWNSTREAM_TIMEOUT_MS` | `3000` | timeout for one downstream HTTP call |
| `PROFILE_PORT` | `7000` | Profile Service port |
| `PROFILE_FAIL` | `false` | simulate Profile failures (500) |
| `PROFILE_DELAY_MS` | `0` | simulate a slow Profile |
| `POST_PORT` | `7001` | Post Service port |
| `POST_FAIL` | `false` | simulate Post failures (500) |
| `POST_DELAY_MS` | `0` | simulate a slow Post |
| `LB_PORT` | `8000` | Load Balancer port |
| `FEED_TARGETS` | `http://localhost:7004,...` | round-robin target list |
| `LB_HEALTH_PROBE_MS` | `3000` | how often the LB pings Feed instances |

Failure flags are read **on every request**, so after editing `.env` you only
need to restart the service that owns the flag.

In PowerShell you can also override without editing the file:

```powershell
$env:PROFILE_FAIL = "true"
npm run profile
# undo:
Remove-Item Env:PROFILE_FAIL
```

---

## 8. Endpoints

| Service | Endpoint | Purpose |
|---|---|---|
| Load Balancer | `GET /feed?email=...` | proxies to the next Feed instance |
| | `GET /health` | LB health + target states |
| Feed | `GET /feed?email=...` | aggregated feed |
| | `GET /health` | service health |
| | `GET /health/circuit-breakers` | `feed:profile` + `feed:post` state |
| Post | `GET /posts?email=...` | personalized posts |
| | `GET /health` | service health |
| | `GET /health/circuit-breakers` | `post:profile` state |
| Profile | `GET /profiles/:email` | profile data |
| | `GET /health` | service health |

Example responses:

```json
// GET /feed  (healthy)
{
  "success": true,
  "instance": 7004,
  "email": "aakash@example.com",
  "profile": { "email": "aakash@example.com", "name": "Aakash", "interests": ["technology","finance"], "preferredCategories": ["tech","business"] },
  "posts": [ ... ],
  "degraded": false,
  "message": null,
  "circuitBreakers": { "feed:profile": "CLOSED", "feed:post": "CLOSED" }
}
```

```json
// GET /feed  (something is broken)
{
  "success": true,
  "instance": 7004,
  "email": "aakash@example.com",
  "profile": null,
  "posts": [],
  "degraded": true,
  "message": "Some feed data is temporarily unavailable",
  "circuitBreakers": { "feed:profile": "OPEN", "feed:post": "CLOSED" }
}
```

```json
// GET /health/circuit-breakers
{
  "instance": "feed:7004",
  "breakers": [
    { "dependency": "feed:profile", "state": "CLOSED", "failureCount": 0, "successCount": 6, "lastFailureTime": null, "openUntil": null }
  ]
}
```

---

## 9. Experiments

> Use `curl.exe` in PowerShell. `POST_FAIL` / `PROFILE_FAIL` etc. live in `.env`,
> so "set a flag" means: **edit `.env`, then restart that one service**.
>
> To restart a single service while the others keep running (important: this
> preserves their circuit state):
>
> ```powershell
> # stop the process listening on a port, e.g. Profile on 7000
> Get-NetTCPConnection -LocalPort 7000 -State Listen |
>   Select-Object -ExpandProperty OwningProcess | Stop-Process -Force
>
> # ...edit .env...
> npm run profile
> ```

### Experiment 1 - Normal request flow through the Load Balancer

```powershell
curl.exe -s "http://localhost:8000/feed?email=aakash@example.com"
```

**Expected:** a full response: profile `Aakash`, 6 posts, `"degraded": false`.

Watch the logs:

```
[LB] Request /feed -> Feed #1 :7004
[FEED:7004] GET /feed?email=aakash@example.com
[FEED:7004] Calling Profile Service
[FEED:7004] Calling Post Service
[FEED:7004] Full response - 6 posts
```

### Experiment 2 - Round-robin distribution

```powershell
1..6 | ForEach-Object {
  (Invoke-RestMethod "http://localhost:8000/feed?email=aakash@example.com").instance
}
```

**Expected:** `7004 7005 7006 7004 7005 7006`

```
[LB] Request /feed -> Feed #1 :7004
[LB] Request /feed -> Feed #2 :7005
[LB] Request /feed -> Feed #3 :7006
[LB] Request /feed -> Feed #1 :7004
```

### Experiment 3 - Load Balancer skips a dead instance

```powershell
# stop Feed #2
Get-NetTCPConnection -LocalPort 7005 -State Listen |
  Select-Object -ExpandProperty OwningProcess | Stop-Process -Force

# keep calling
1..6 | ForEach-Object {
  (Invoke-RestMethod "http://localhost:8000/feed?email=aakash@example.com").instance
}

# check what the LB thinks
Invoke-RestMethod http://localhost:8000/health | ConvertTo-Json -Depth 5

# bring it back
npm run feed2
```

**Expected log:**

```
[LB] Feed #2 :7005 is DOWN (fetch failed) - removing from rotation
[LB] Request /feed -> Feed #3 :7006
[LB] Request /feed -> Feed #1 :7004
...
[LB] Feed #2 :7005 is UP again - adding back to rotation
```

The very first request after the kill may return `502` (the LB only discovers
the failure by trying); every later request skips it.

### Experiment 4 - Profile fails, Post sees the failures

1. Edit `.env`: `PROFILE_FAIL=true`
2. Restart only the Profile Service (see the box above)
3. Call Post a few times:

```powershell
1..4 | ForEach-Object {
  Invoke-RestMethod "http://localhost:7001/posts?email=aakash@example.com"
}
```

**Expected:** Post still answers `200` but with `"degraded": true` and 12
(unpersonalized) posts, while its logs show:

```
[POST] Calling Profile Service
[POST] [CB:post:profile] Failure 1/3
[POST] Profile request failed: Profile Service returned 500
[POST] Responding with 12 posts (degraded - profile unavailable)
```

### Experiment 5 - `post:profile` becomes OPEN

Three failing calls later:

```powershell
Invoke-RestMethod http://localhost:7001/health/circuit-breakers | ConvertTo-Json -Depth 5
```

```json
{ "state": "OPEN", "failureCount": 3, "openUntil": "2026-09-28T20:00:18.368Z" }
```

```
[POST] [CB:post:profile] Failure 3/3
[POST] [CB:post:profile] CLOSED -> OPEN
[REDIS:post:7001] published post:profile CLOSED -> OPEN
```

### Experiment 6 - While OPEN, Post stops calling Profile

Call Post again several times and count the calls:

```powershell
1..5 | ForEach-Object {
  Invoke-RestMethod "http://localhost:7001/posts?email=aakash@example.com"
}
```

**Expected:** responses are **instant**, still `200`, still with posts - but the
log no longer contains `Calling Profile Service`. Instead:

```
[POST] [CB:post:profile] OPEN - request rejected without calling Profile Service
[POST] Profile call skipped - post:profile circuit is OPEN
[POST] Responding with 12 posts (degraded - profile unavailable)
```

This is the point of the breaker: Post kept serving while Profile was broken.

### Experiment 7 - Cascading failure (circuit breakers OFF)

1. Edit `.env`:
   ```env
   PROFILE_DELAY_MS=5000
   CIRCUIT_BREAKER_ENABLED=false
   ```
2. Restart **all** services (`Ctrl+C`, then `npm run start:all`)
3. Time a few requests:

```powershell
1..4 | ForEach-Object {
  (Measure-Command { curl.exe -s -o NUL "http://localhost:8000/feed?email=aakash@example.com" }).TotalSeconds
}
```

**Expected:** every request takes **~3 seconds** (the
`DOWNSTREAM_TIMEOUT_MS=3000` timeout - Profile needs 5s), all responses are
degraded, and the breakers never open:

```
[POST] [CB:post:profile] Failure 3/3 (CIRCUIT_BREAKER_ENABLED=false - staying CLOSED)
[POST] [CB:post:profile] Failure 4/3 (CIRCUIT_BREAKER_ENABLED=false - staying CLOSED)
```

Every request keeps paying the full timeout cost - the slowness cascades to
every caller. (Open `GET /health/circuit-breakers` to confirm `failureCount`
keeps growing while `state` stays `CLOSED`.)

### Experiment 8 - Circuit breakers contain the cascade

1. Edit `.env` (same slow Profile, breakers back on):
   ```env
   PROFILE_DELAY_MS=5000
   CIRCUIT_BREAKER_ENABLED=true
   ```
2. Restart all services
3. Time requests to **one** instance so you can watch it trip:

```powershell
1..6 | ForEach-Object {
  (Measure-Command { curl.exe -s -o NUL "http://localhost:7004/feed?email=aakash@example.com" }).TotalSeconds
}
```

**Expected:** the first ~3 requests take ~3s (failing), then everything becomes
**~0.002s**:

```
[FEED#1] [CB:feed:profile] Failure 1/3
[FEED#1] [CB:feed:profile] Failure 2/3
[FEED#1] [CB:feed:profile] Failure 3/3
[FEED#1] [CB:feed:profile] CLOSED -> OPEN
[FEED#1] [CB:feed:profile] OPEN - request rejected without calling Profile Service
```

The cascade is contained: a few slow probes, then fast degraded answers for
everyone. Every `OPEN_TIMEOUT_MS` (10s) you will see exactly one slow probe:

```
[FEED#1] [CB:feed:profile] OPEN -> HALF_OPEN
[FEED#1] [CB:feed:profile] Test request failed
[FEED#1] [CB:feed:profile] HALF_OPEN -> OPEN
```

### Experiment 9 - `feed:post` becomes OPEN

1. Edit `.env`: `POST_FAIL=true` (and reset `PROFILE_DELAY_MS=0`)
2. Restart Post, then call one Feed instance 3+ times:

```powershell
1..4 | ForEach-Object { Invoke-RestMethod "http://localhost:7004/feed?email=aakash@example.com" }
Invoke-RestMethod http://localhost:7004/health/circuit-breakers | ConvertTo-Json -Depth 5
```

**Expected:** `feed:post` is `OPEN`, `feed:profile` is still `CLOSED`, and the
response contains the **profile but no posts**:

```json
"profile": { "name": "Aakash", ... },
"posts": [],
"degraded": true
```

```
[FEED#1] [CB:feed:post] CLOSED -> OPEN
[FEED#1] [CB:feed:post] OPEN - request rejected without calling Post Service
[FEED:7004] Post call skipped - feed:post circuit is OPEN
```

Note how the healthy dependency (`feed:profile`) is *not* affected - each
dependency is protected separately.

### Experiment 10 - HALF_OPEN recovery

Keep the breakers from Experiment 9 `OPEN`, then heal the service:

1. Edit `.env`: `POST_FAIL=false`
2. Restart **only** the Post Service
3. After `OPEN_TIMEOUT_MS` (10 s) keep sending requests:

```powershell
1..8 | ForEach-Object {
  Invoke-RestMethod "http://localhost:7004/feed?email=aakash@example.com"
  Start-Sleep -Seconds 2
}
```

**Expected progression:**

```
[FEED#1] [CB:feed:post] OPEN -> HALF_OPEN
[FEED#1] [CB:feed:post] HALF_OPEN - sending test request to Post Service
[FEED#1] [CB:feed:post] Test request succeeded (1/2)
[FEED#1] [CB:feed:post] Test request succeeded (2/2)
[FEED#1] [CB:feed:post] HALF_OPEN -> CLOSED
```

Responses go from `"degraded": true` back to full data with
`"feed:post": "CLOSED"`.

If the service fails the probe, you will instead see
`Test request failed` and `HALF_OPEN -> OPEN`.

### Experiment 11 - Redis Pub/Sub synchronizes all Feed instances

The goal: open a breaker on **one** instance only, and watch the other two
learn about it without failing any request themselves.

1. Make sure everything is healthy, then **stop Post**:

   ```powershell
   Get-NetTCPConnection -LocalPort 7001 -State Listen |
     Select-Object -ExpandProperty OwningProcess | Stop-Process -Force
   ```

2. Send 3 requests **only to Feed #1** (so #2 and #3 fail nothing):

   ```powershell
   1..3 | ForEach-Object { Invoke-RestMethod "http://localhost:7004/feed?email=aakash@example.com" }
   ```

3. Immediately inspect all three instances:

   ```powershell
   7004,7005,7006 | ForEach-Object {
     $r = Invoke-RestMethod "http://localhost:$_/health/circuit-breakers"
     "$($r.instance): " + (($r.breakers | ForEach-Object { "$($_.dependency)=$($_.state) fail=$($_.failureCount)" }) -join ", ")
   }
   ```

**Expected:** all three report `feed:post=OPEN`, even though only Feed #1 saw a
failure:

```
feed:7004: feed:post=OPEN fail=3
feed:7005: feed:post=OPEN fail=3
feed:7006: feed:post=OPEN fail=3
```

**Proof it came from Redis:**

```
[REDIS:feed:7004] published feed:post CLOSED -> OPEN
[REDIS:feed:7006] received feed:post CLOSED -> OPEN from feed:7004
[FEED#3] [CB:feed:post] Redis sync from feed:7004: CLOSED -> OPEN
[REDIS:feed:7005] received feed:post CLOSED -> OPEN from feed:7004
[FEED#2] [CB:feed:post] Redis sync from feed:7004: CLOSED -> OPEN
```

Now any request to Feed #2/#3 is rejected instantly without calling Post -
exactly what the shared state is for.

---

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| `ECONNREFUSED 27017` | MongoDB is not running |
| `[REDIS:...] unavailable - circuit breakers will run in local-only mode` | Redis is not running (`redis-cli ping`); everything else still works, just without cross-instance sync |
| `port 7000/7001/7004... already in use` | a service from a previous run is still alive - stop it or reboot the terminal |
| LB returns `502` | it just noticed a dead Feed instance; the next request will skip it |
| Feed returns `"posts": []` with `"degraded": true` | `feed:post` is OPEN - check `GET /health/circuit-breakers` |
| Posts are never personalized | Profile is failing - check `PROFILE_FAIL` / `PROFILE_DELAY_MS` |

Useful commands:

```powershell
# breaker states
Invoke-RestMethod http://localhost:7004/health/circuit-breakers | ConvertTo-Json -Depth 5
Invoke-RestMethod http://localhost:7001/health/circuit-breakers | ConvertTo-Json -Depth 5

# who is alive
(7000,7001,7004,7005,7006,8000) | ForEach-Object {
  try { Invoke-RestMethod "http://localhost:$_/health" } catch { "port $_ is DOWN" }
}
```

---

## 11. Ideas to experiment further

- Lower `FAILURE_THRESHOLD` to `1` and watch breakers trip instantly
- Set `OPEN_TIMEOUT_MS=2000` to see probes much more often
- Add a 4th Feed instance (`scripts/run-feed.js 7007`) and add it to `FEED_TARGETS`
- Make Profile fail only for one email (rate limiting / per-tenant circuits)
- Add response-time based breaking (open if latency > X for N requests)
