import { test } from "node:test";
import { strictEqual } from "node:assert/strict";
import type { Callback, RedisKey } from "ioredis";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import { RedisMessageQueue } from "@fedify/redis/mq";

/**
 * Mock Redis client that allows manual control of subscribe callback timing.
 *
 * This enables deterministic reproduction of the race condition by:
 * 1. Capturing the subscribe callback without executing it
 * 2. Allowing publish() to fire before the callback runs
 * 3. Manually triggering the callback later
 */
class MockRedis extends EventEmitter {
  #subscribeCallback: (() => void) | null = null;
  #subscribed = false;
  #queue: Map<string, { score: number; value: string }[]> = new Map();

  /**
   * Simulates Redis SUBSCRIBE command.
   * Captures callback for later execution (simulates async event loop behavior).
   */
  subscribe(
    _channel: RedisKey,
    callback?: Callback<number>,
  ): Promise<number> {
    this.#subscribed = true;
    if (callback) {
      this.#subscribeCallback = () => callback(null, 1);
    }
    return Promise.resolve(1);
  }

  /**
   * Manually trigger the captured subscribe callback.
   * Call this to simulate the event loop executing the callback.
   */
  triggerSubscribeCallback(): void {
    if (this.#subscribeCallback) {
      this.#subscribeCallback();
      this.#subscribeCallback = null;
    }
  }

  /**
   * Check if subscribe callback is pending (not yet executed).
   */
  hasSubscribeCallbackPending(): boolean {
    return this.#subscribeCallback !== null;
  }

  unsubscribe(_channel: RedisKey): Promise<number> {
    this.#subscribed = false;
    return Promise.resolve(1);
  }

  /**
   * Simulates Redis PUBLISH command.
   * If subscribed and has "message" listener, emits the message.
   */
  publish(channel: RedisKey, message: string): Promise<number> {
    if (this.#subscribed && this.listenerCount("message") > 0) {
      // Emit to listeners (simulates Redis delivering the message)
      this.emit("message", channel, message);
      return Promise.resolve(1);
    }
    // No listeners - message is "lost" (this is the bug!)
    return Promise.resolve(0);
  }

  zadd(key: RedisKey, score: number, value: string): Promise<number> {
    if (!this.#queue.has(String(key))) {
      this.#queue.set(String(key), []);
    }
    this.#queue.get(String(key))!.push({ score, value });
    return Promise.resolve(1);
  }

  zrangebyscoreBuffer(
    key: RedisKey,
    _min: number,
    _max: number,
  ): Promise<Buffer[]> {
    const items = this.#queue.get(String(key)) ?? [];
    return Promise.resolve(items.map((i) => Buffer.from(i.value)));
  }

  zrem(key: RedisKey, value: Buffer): Promise<number> {
    const items = this.#queue.get(String(key));
    if (items) {
      const idx = items.findIndex((i) => i.value === value.toString());
      if (idx >= 0) {
        items.splice(idx, 1);
        return Promise.resolve(1);
      }
    }
    return Promise.resolve(0);
  }

  set(
    _key: RedisKey,
    _value: string,
    _ex: string,
    _seconds: number,
    _nx: string,
  ): Promise<string | null> {
    return Promise.resolve("OK");
  }

  del(_key: RedisKey): Promise<number> {
    return Promise.resolve(1);
  }

  multi(): MockMulti {
    return new MockMulti(this);
  }

  disconnect(): void {
    this.removeAllListeners();
  }
}

/**
 * Mock Redis multi/transaction support.
 */
class MockMulti {
  #redis: MockRedis;
  #commands: (() => Promise<unknown>)[] = [];

  constructor(redis: MockRedis) {
    this.#redis = redis;
  }

  zadd(key: RedisKey, score: number, value: string): this {
    this.#commands.push(() => this.#redis.zadd(key, score, value));
    return this;
  }

  async exec(): Promise<[Error | null, unknown][]> {
    const results: [Error | null, unknown][] = [];
    for (const cmd of this.#commands) {
      try {
        const result = await cmd();
        results.push([null, result]);
      } catch (e) {
        results.push([e as Error, null]);
      }
    }
    return results;
  }
}

/**
 * DETERMINISTIC TEST: Reproduces the race condition 100% of the time.
 *
 * Proves the bug by controlling callback timing:
 * 1. subscribe() with callback - callback CAPTURED, not executed
 * 2. publish() fires - no handler exists yet
 * 3. Callback triggered - handler attached TOO LATE
 * 4. Assert: message lost (0 listeners at publish time)
 */
test("Deterministic: Race condition with callback approach", async () => {
  const receivedMessages: string[] = [];
  const mockSubRedis = new MockRedis();

  // BUGGY: callback-based subscribe
  await mockSubRedis.subscribe("test-channel", () => {
    mockSubRedis.on("message", (_channel, message) => {
      receivedMessages.push(message);
    });
  });

  // Callback not executed yet
  strictEqual(mockSubRedis.hasSubscribeCallbackPending(), true);
  strictEqual(mockSubRedis.listenerCount("message"), 0);

  // Publish BEFORE callback runs
  const listenersAtPublish = mockSubRedis.listenerCount("message");
  await mockSubRedis.publish("test-channel", "notification");

  // NOW trigger callback (too late!)
  mockSubRedis.triggerSubscribeCallback();

  // Assert: message was LOST
  strictEqual(listenersAtPublish, 0, "No listeners when publish() was called");
  strictEqual(
    receivedMessages.length,
    0,
    "Message lost due to race condition",
  );

  mockSubRedis.disconnect();
});

/**
 * DETERMINISTIC TEST: Proves the fix works.
 *
 * With await + sync handler:
 * 1. await subscribe() - wait for confirmation
 * 2. Attach handler synchronously
 * 3. publish() - handler receives message
 * 4. Assert: message received (1 listener at publish time)
 */
test("Deterministic: Fixed approach (await + sync handler)", async () => {
  const receivedMessages: string[] = [];
  const mockSubRedis = new MockRedis();

  // FIXED: await subscribe, then attach handler sync
  await mockSubRedis.subscribe("test-channel");
  mockSubRedis.on("message", (_channel, message) => {
    receivedMessages.push(message);
  });

  // Handler attached immediately
  strictEqual(mockSubRedis.listenerCount("message"), 1);

  // Publish AFTER handler attached
  const listenersAtPublish = mockSubRedis.listenerCount("message");
  await mockSubRedis.publish("test-channel", "notification");

  // Assert: message was RECEIVED
  strictEqual(
    listenersAtPublish,
    1,
    "Handler attached when publish() was called",
  );
  strictEqual(
    receivedMessages.length,
    1,
    "Message received - no race condition",
  );

  mockSubRedis.disconnect();
});

/**
 * REGRESSION TEST: Verifies handler is attached before enqueue is possible.
 *
 * With BUGGY impl: listen() returns before handler attached → race condition
 * With FIXED impl: listen() awaits subscription, attaches handler synchronously
 */
test("Regression: RedisMessageQueue handler attached before yield", async () => {
  let subRedisInstance: MockRedis | null = null;
  let callCount = 0;

  const mockRedisFactory = () => {
    callCount++;
    const mock = new MockRedis();
    if (callCount === 2) subRedisInstance = mock;
    return mock as unknown as import("ioredis").Redis;
  };

  const mq = new RedisMessageQueue(mockRedisFactory, {
    pollInterval: { seconds: 60 },
    channelKey: "test-channel",
    queueKey: "test-queue",
    lockKey: "test-lock",
  });

  const controller = new AbortController();

  try {
    const listening = mq.listen(() => {}, { signal: controller.signal });

    // Yield to let listen() progress
    await new Promise((r) => setTimeout(r, 50));

    // FIXED impl: handler must be attached after yielding
    strictEqual(
      subRedisInstance!.listenerCount("message"),
      1,
      "Handler must be attached after listen() yields control",
    );

    controller.abort();
    await listening;
  } finally {
    mq[Symbol.dispose]();
  }
});
