'use strict';

const CLOSED = 'CLOSED';
const OPEN = 'OPEN';
const HALF_OPEN = 'HALF_OPEN';

const TARGET_LABELS = {
  profile: 'Profile Service',
  post: 'Post Service',
  feed: 'Feed Service'
};

function targetLabel(breakerName) {
  const target = String(breakerName).split(':')[1] || '';
  return TARGET_LABELS[target] || target;
}

/**
 * Reusable Circuit Breaker.
 *
 * CLOSED    -> requests allowed, failures counted.
 * OPEN      -> requests rejected immediately (downstream is never called).
 * HALF_OPEN -> a single test request is allowed to probe recovery.
 */
class CircuitBreaker {
  constructor(options = {}) {
    this.name = options.name || 'unnamed';
    this.failureThreshold = options.failureThreshold ?? 3;
    this.successThreshold = options.successThreshold ?? 2;
    this.openTimeoutMs = options.openTimeoutMs ?? 10000;
    this.halfOpenMaxRequests = options.halfOpenMaxRequests ?? 1;
    this.enabled = options.enabled !== false;
    this.onStateChange = options.onStateChange || null;

    this.state = CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenInFlight = 0;
    this.lastFailureTime = null;
    this.openUntil = null;

    console.log(`[CB:${this.name}] ${this.state}`);
  }

  canExecute() {
    if (!this.enabled) return true;

    if (this.state === OPEN) {
      const now = Date.now();
      if (now < (this.openUntil || 0)) {
        console.log(`[CB:${this.name}] OPEN - request rejected without calling ${targetLabel(this.name)}`);
        return false;
      }
      this._transition(HALF_OPEN);
    }

    if (this.state === HALF_OPEN) {
      if (this.halfOpenInFlight >= this.halfOpenMaxRequests) {
        console.log(`[CB:${this.name}] HALF_OPEN - test request already in flight, request rejected`);
        return false;
      }
      this.halfOpenInFlight += 1;
      console.log(`[CB:${this.name}] HALF_OPEN - sending test request to ${targetLabel(this.name)}`);
      return true;
    }

    return true;
  }

  recordSuccess() {
    if (this.state === HALF_OPEN) {
      this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
      this.successCount += 1;
      console.log(`[CB:${this.name}] Test request succeeded (${this.successCount}/${this.successThreshold})`);
      if (this.successCount >= this.successThreshold) {
        this._transition(CLOSED);
      }
      return;
    }

    if (this.failureCount > 0) {
      console.log(`[CB:${this.name}] Success - resetting failure count (was ${this.failureCount})`);
    }
    this.failureCount = 0;
    this.successCount += 1;
  }

  recordFailure() {
    this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
    this.failureCount += 1;
    this.lastFailureTime = new Date().toISOString();

    if (this.state === HALF_OPEN) {
      console.log(`[CB:${this.name}] Test request failed`);
      if (this.enabled) {
        this._transition(OPEN);
        return;
      }
    }

    if (!this.enabled) {
      console.log(`[CB:${this.name}] Failure ${this.failureCount}/${this.failureThreshold} (CIRCUIT_BREAKER_ENABLED=false - staying ${this.state})`);
      return;
    }

    console.log(`[CB:${this.name}] Failure ${this.failureCount}/${this.failureThreshold}`);
    if (this.failureCount >= this.failureThreshold && this.state === CLOSED) {
      this._transition(OPEN);
    }
  }

  /**
   * Convenience wrapper used by every downstream HTTP call.
   * Returns { ok, data } on success, { ok:false, skipped } when the
   * circuit rejects the call, or { ok:false, error } on a real failure.
   */
  async execute(fn) {
    if (!this.canExecute()) {
      return { ok: false, skipped: true, error: 'circuit-open' };
    }
    try {
      const data = await fn();
      this.recordSuccess();
      return { ok: true, skipped: false, data };
    } catch (err) {
      this.recordFailure();
      return { ok: false, skipped: false, error: err.message || String(err) };
    }
  }

  getState() {
    return this.state;
  }

  getStats() {
    return {
      dependency: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      openUntil: this.openUntil ? new Date(this.openUntil).toISOString() : null
    };
  }

  /** Called when another instance published a state change over Redis. */
  applyRemoteState(message) {
    const newState = message.newState;
    if (!newState || newState === this.state) return;

    const oldState = this.state;
    this.state = newState;

    if (newState === OPEN) {
      this.openUntil = Date.now() + this.openTimeoutMs;
      this.failureCount = typeof message.failureCount === 'number' ? message.failureCount : this.failureThreshold;
      this.successCount = 0;
      this.halfOpenInFlight = 0;
    } else if (newState === HALF_OPEN) {
      this.openUntil = null;
      this.successCount = 0;
      this.halfOpenInFlight = 0;
    } else if (newState === CLOSED) {
      this.openUntil = null;
      this.failureCount = 0;
      this.successCount = 0;
      this.halfOpenInFlight = 0;
    }

    console.log(`[CB:${this.name}] Redis sync from ${message.instance || 'unknown instance'}: ${oldState} -> ${newState}`);
  }

  _transition(nextState) {
    const oldState = this.state;
    if (oldState === nextState) return;
    this.state = nextState;

    console.log(`[CB:${this.name}] ${oldState} -> ${nextState}`);

    if (nextState === OPEN) {
      this.openUntil = Date.now() + this.openTimeoutMs;
      this.halfOpenInFlight = 0;
      this.successCount = 0;
    } else if (nextState === HALF_OPEN) {
      this.openUntil = null;
      this.halfOpenInFlight = 0;
      this.successCount = 0;
    } else if (nextState === CLOSED) {
      this.openUntil = null;
      this.failureCount = 0;
      this.successCount = 0;
      this.halfOpenInFlight = 0;
    }

    if (typeof this.onStateChange === 'function') {
      this.onStateChange(oldState, nextState, this.getStats());
    }
  }
}

module.exports = CircuitBreaker;
module.exports.STATES = { CLOSED, OPEN, HALF_OPEN };
