import { test } from "@fedify/fixture";
import { RedisKvStore } from "@fedify/redis/kv";
import * as temporal from "@js-temporal/polyfill";
import type { Redis as RedisClient, RedisKey } from "ioredis";
import { Redis } from "ioredis";
import assert from "node:assert/strict";
import process from "node:process";
import { test as nodeTest } from "node:test";

const Temporal = globalThis.Temporal ?? temporal.Temporal;

const redisUrl = process.env.REDIS_URL;
const ignore = redisUrl == null;

async function cleanupPrefixedKeys(
  redis: Redis,
  keyPrefix: string,
): Promise<void> {
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      `${keyPrefix}*`,
      "COUNT",
      "100",
    );
    cursor = nextCursor;
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } while (cursor !== "0");
}

function getRedis(): {
  redis: Redis;
  keyPrefix: string;
  store: RedisKvStore;
  cleanup: () => Promise<void>;
} {
  const redis = new Redis(redisUrl!);
  const keyPrefix = `fedify_test_${crypto.randomUUID()}::`;
  const store = new RedisKvStore(redis, { keyPrefix });
  return {
    redis,
    keyPrefix,
    store,
    cleanup: () => cleanupPrefixedKeys(redis, keyPrefix),
  };
}

test("RedisKvStore.get()", { ignore }, async () => {
  if (ignore) return; // see https://github.com/oven-sh/bun/issues/19412
  const { redis, keyPrefix, store, cleanup } = getRedis();
  try {
    await redis.set(`${keyPrefix}foo::bar`, '"foobar"');
    assert.strictEqual(await store.get(["foo", "bar"]), "foobar");
  } finally {
    await cleanup();
    redis.disconnect();
  }
});

test("RedisKvStore.set()", { ignore }, async () => {
  if (ignore) return; // see https://github.com/oven-sh/bun/issues/19412
  const { redis, keyPrefix, store, cleanup } = getRedis();
  try {
    await store.set(["foo", "baz"], "baz");
    assert.strictEqual(await redis.get(`${keyPrefix}foo::baz`), '"baz"');
  } finally {
    await cleanup();
    redis.disconnect();
  }
});

test("RedisKvStore.delete()", { ignore }, async () => {
  if (ignore) return; // see https://github.com/oven-sh/bun/issues/19412
  const { redis, keyPrefix, store, cleanup } = getRedis();
  try {
    await redis.set(`${keyPrefix}foo::baz`, '"baz"');
    await store.delete(["foo", "baz"]);
    assert.equal(await redis.exists(`${keyPrefix}foo::baz`), 0);
  } finally {
    await cleanup();
    redis.disconnect();
  }
});

test("RedisKvStore.list()", { ignore }, async () => {
  if (ignore) return; // see https://github.com/oven-sh/bun/issues/19412
  const { redis, store, cleanup } = getRedis();
  try {
    await store.set(["prefix", "a"], "value-a");
    await store.set(["prefix", "b"], "value-b");
    await store.set(["prefix", "nested", "c"], "value-c");
    await store.set(["other", "x"], "value-x");

    const entries: { key: readonly string[]; value: unknown }[] = [];
    for await (const entry of store.list(["prefix"])) {
      entries.push({ key: entry.key, value: entry.value });
    }

    assert.strictEqual(entries.length, 3);
    assert(entries.some((e) => e.key[1] === "a" && e.value === "value-a"));
    assert(entries.some((e) => e.key[1] === "b"));
    assert(entries.some((e) => e.key[1] === "nested"));
  } finally {
    await cleanup();
    redis.disconnect();
  }
});

test("RedisKvStore.list() - single element key", { ignore }, async () => {
  if (ignore) return; // see https://github.com/oven-sh/bun/issues/19412
  const { redis, store, cleanup } = getRedis();
  try {
    await store.set(["a"], "value-a");
    await store.set(["b"], "value-b");

    const entries: { key: readonly string[]; value: unknown }[] = [];
    for await (const entry of store.list(["a"])) {
      entries.push({ key: entry.key, value: entry.value });
    }

    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].value, "value-a");
  } finally {
    await cleanup();
    redis.disconnect();
  }
});

test("RedisKvStore.list() - empty prefix", { ignore }, async () => {
  if (ignore) return; // see https://github.com/oven-sh/bun/issues/19412
  const { redis, store, cleanup } = getRedis();
  try {
    await store.set(["a"], "value-a");
    await store.set(["b", "c"], "value-bc");
    await store.set(["d", "e", "f"], "value-def");

    const entries: { key: readonly string[]; value: unknown }[] = [];
    for await (const entry of store.list()) {
      entries.push({ key: entry.key, value: entry.value });
    }

    assert.strictEqual(entries.length, 3);
  } finally {
    await cleanup();
    redis.disconnect();
  }
});

// Regression tests for `RedisKvStore.set()` handing Redis `SETEX` a TTL that
// is not a whole number of seconds.
//
// `options.ttl.total("second")` was passed straight through, so any duration
// that is not an exact number of seconds — which `KvStoreSetOptions.ttl`
// accepts, since it is any `Temporal.Duration` — made the server reject the
// write with `ERR value is not an integer or out of range` rather than storing
// the value with a rounded expiry.  A zero duration failed too, with `ERR
// invalid expire time in 'setex' command`.
//
// See: https://github.com/fedify-dev/fedify/issues/1028

/**
 * A stand-in for the Redis client that records the arguments `set()` hands to
 * `SETEX`.  It exists so the conversion can be checked on every runtime,
 * including the ones with no `REDIS_URL`; the end-to-end behaviour is covered
 * by the `REDIS_URL`-gated test below.
 */
function recordingRedis(): {
  setexCalls: { key: RedisKey; seconds: unknown }[];
  redis: RedisClient;
} {
  const setexCalls: { key: RedisKey; seconds: unknown }[] = [];
  const client = {
    setex(key: RedisKey, seconds: unknown, _value: unknown): Promise<"OK"> {
      setexCalls.push({ key, seconds });
      return Promise.resolve("OK");
    },
  };
  return { setexCalls, redis: client as unknown as RedisClient };
}

nodeTest("RedisKvStore.set() rounds a TTL up to whole seconds", async () => {
  const cases: [Temporal.Duration, number, string][] = [
    [Temporal.Duration.from({ seconds: 1 }), 1, "a whole second is unchanged"],
    [
      Temporal.Duration.from({ minutes: 5 }),
      300,
      "whole seconds are unchanged",
    ],
    [Temporal.Duration.from({ milliseconds: 1500 }), 2, "1.5s rounds up"],
    [
      Temporal.Duration.from({ milliseconds: 1400 }),
      2,
      "1.4s rounds up, not to the nearest second",
    ],
    [
      Temporal.Duration.from({ milliseconds: 500 }),
      1,
      "a sub-second TTL becomes the smallest expiry",
    ],
    [
      Temporal.Duration.from({ milliseconds: 1 }),
      1,
      "a near-zero TTL stays at least 1",
    ],
    [Temporal.Duration.from({ seconds: 0 }), 1, "a zero TTL stays at least 1"],
    [
      Temporal.Duration.from({ milliseconds: -1 }),
      1,
      "a negative sub-second TTL stays at least 1",
    ],
    [
      Temporal.Duration.from({ seconds: -30 }),
      1,
      "a negative TTL stays at least 1",
    ],
    [
      Temporal.Duration.from({ hours: -1 }),
      1,
      "a large negative TTL stays at least 1",
    ],
  ];
  for (const [ttl, expected, why] of cases) {
    const { setexCalls, redis } = recordingRedis();
    const store = new RedisKvStore(redis, { keyPrefix: "fedify_test::" });
    await store.set(["foo"], "bar", { ttl });
    assert.strictEqual(setexCalls.length, 1);
    assert.strictEqual(setexCalls[0].seconds, expected, why);
    assert(
      Number.isInteger(setexCalls[0].seconds),
      "SETEX only accepts whole seconds",
    );
    assert(
      (setexCalls[0].seconds as number) > 0,
      "SETEX rejects a non-positive expiry",
    );
  }
});

/**
 * Asserts that a key written with a `seconds`-long expiry still has a
 * plausible amount of that lifetime left.
 *
 * `PTTL` is read rather than `TTL` because `TTL` rounds the remaining
 * lifetime to whole seconds: just over half a second after a `SETEX 1` write
 * it reports `0` for a key that is still there, and `29` for one written with
 * `SETEX 30`.  Asserting an exact `TTL` therefore fails on a slow run even
 * though the conversion is correct.
 *
 * `elapsedMs` must span everything from before the write to after the read,
 * so it is an upper bound on how long the key has been alive, and the
 * remaining lifetime cannot have fallen below `seconds * 1000 - elapsedMs`.
 * The upper bound is what rules out a longer expiry than intended.
 */
function assertExpiresIn(
  remainingMs: number,
  seconds: number,
  elapsedMs: number,
  why: string,
): void {
  assert(
    remainingMs > 0,
    `${why}: expected a live key with an expiry, but PTTL returned ` +
      `${remainingMs}`,
  );
  assert(
    remainingMs <= seconds * 1000,
    `${why}: expected at most ${seconds}s left, but PTTL returned ` +
      `${remainingMs}ms`,
  );
  assert(
    remainingMs >= seconds * 1000 - elapsedMs,
    `${why}: expected at least ${seconds * 1000 - elapsedMs}ms left ` +
      `(${seconds}s minus the ${elapsedMs}ms the write and read took), but ` +
      `PTTL returned ${remainingMs}ms`,
  );
}

nodeTest(
  "RedisKvStore.set() stores a sub-second TTL",
  { skip: ignore },
  async () => {
    if (ignore) return; // Bun does not support the skip option
    const { redis, keyPrefix, store, cleanup } = getRedis();
    try {
      // Before the fix this threw `ERR value is not an integer or out of
      // range`.  The expiry is read straight after the write, so only the two
      // Redis commands sit inside the window the bounds have to tolerate.
      let startedAt = Date.now();
      await store.set(["foo", "sub"], "bar", {
        ttl: Temporal.Duration.from({ milliseconds: 500 }),
      });
      let remaining = await redis.pttl(`${keyPrefix}foo::sub`);
      assertExpiresIn(
        remaining,
        1,
        Date.now() - startedAt,
        "a sub-second TTL should be stored as the smallest expiry SETEX accepts",
      );
      assert.strictEqual(await store.get(["foo", "sub"]), "bar");

      // A negative duration is stored for one second rather than rejected.
      // `SETEX` refuses a non-positive expiry outright, so without the floor
      // this throws `ERR invalid expire time in 'setex' command`.
      startedAt = Date.now();
      await store.set(["foo", "negative"], "bar", {
        ttl: Temporal.Duration.from({ seconds: -30 }),
      });
      remaining = await redis.pttl(`${keyPrefix}foo::negative`);
      assertExpiresIn(
        remaining,
        1,
        Date.now() - startedAt,
        "a negative TTL should be stored as the smallest expiry SETEX accepts",
      );
      assert.strictEqual(await store.get(["foo", "negative"]), "bar");

      // A whole number of seconds keeps its value, so the rounding does not
      // change what already worked.
      startedAt = Date.now();
      await store.set(["foo", "whole"], "bar", {
        ttl: Temporal.Duration.from({ seconds: 30 }),
      });
      remaining = await redis.pttl(`${keyPrefix}foo::whole`);
      assertExpiresIn(
        remaining,
        30,
        Date.now() - startedAt,
        "a whole number of seconds should be stored unchanged",
      );
    } finally {
      await cleanup();
      redis.disconnect();
    }
  },
);
