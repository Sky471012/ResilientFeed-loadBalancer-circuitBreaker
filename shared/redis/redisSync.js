'use strict';

const { createClient } = require('redis');
const config = require('../config');

const CHANNEL = 'circuit-breaker-state';

/**
 * Redis Pub/Sub synchronization for circuit-breaker state.
 *
 * - Only STATE CHANGES are published (never per-request checks).
 * - Each instance keeps its own breaker state in memory for fast checks
 *   and applies remote changes when it receives them on the channel.
 */
class RedisSync {
  constructor() {
    this.channel = CHANNEL;
    this.instanceId = 'unknown';
    this.publisher = null;
    this.subscriber = null;
    this.connected = false;
    this.breakers = new Map();
  }

  registerBreaker(breaker) {
    this.breakers.set(breaker.name, breaker);
  }

  async init(instanceId) {
    this.instanceId = instanceId;

    try {
      this.publisher = createClient({ url: config.REDIS_URL });
      this.subscriber = createClient({ url: config.REDIS_URL });

      this.publisher.on('error', (err) => console.log(`[REDIS:${this.instanceId}] publisher error: ${err.message}`));
      this.subscriber.on('error', (err) => console.log(`[REDIS:${this.instanceId}] subscriber error: ${err.message}`));

      await this.publisher.connect();
      await this.subscriber.connect();
      await this.subscriber.subscribe(this.channel, (raw) => this._onMessage(raw));

      this.connected = true;
      console.log(`[REDIS:${this.instanceId}] connected - subscribed to "${this.channel}"`);
    } catch (err) {
      this.connected = false;
      console.log(`[REDIS:${this.instanceId}] unavailable (${err.message}) - circuit breakers will run in local-only mode`);
    }
  }

  publishStateChange(payload) {
    if (!this.connected) return;
    const message = JSON.stringify(payload);
    this.publisher.publish(this.channel, message).catch((err) => {
      console.log(`[REDIS:${this.instanceId}] publish failed: ${err.message}`);
    });
    console.log(`[REDIS:${this.instanceId}] published ${payload.source}:${payload.target} ${payload.oldState} -> ${payload.newState}`);
  }

  _onMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch (err) {
      return;
    }

    if (message.instance === this.instanceId) return;

    const breaker = this.breakers.get(`${message.source}:${message.target}`);
    if (!breaker) return;

    console.log(
      `[REDIS:${this.instanceId}] received ${message.source}:${message.target} ${message.oldState} -> ${message.newState} from ${message.instance}`
    );
    breaker.applyRemoteState(message);
  }
}

module.exports = new RedisSync();
