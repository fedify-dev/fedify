import { test } from "@fedify/fixture";
import { RedisKvStore } from "@fedify/redis/kv";
import { Redis } from "ioredis";
import assert from "node:assert/strict";
import process from "node:process";

const redisUrl = process.env.REDIS_URL;
const ignore = redisUrl == null;

function getRedis(): { redis: Redis; keyPrefix: string; store: RedisKvStore } {
  const redis = new Redis(redisUrl!);
  const keyPrefix = `fedify_test_${crypto.randomUUID()}::`;
  const store = new RedisKvStore(redis, { keyPrefix });
  return { redis, keyPrefix, store };
}

test("RedisKvStore.get()", { ignore }, async () => {
  if (ignore) return; // see https://github.com/oven-sh/bun/issues/19412
  const { redis, keyPrefix, store } = getRedis();
  try {
    await redis.set(`${keyPrefix}foo::bar`, '"foobar"');
    assert.strictEqual(await store.get(["foo", "bar"]), "foobar");
  } finally {
    redis.disconnect();
  }
});

test("RedisKvStore.set()", { ignore }, async () => {
  if (ignore) return; // see https://github.com/oven-sh/bun/issues/19412
  const { redis, keyPrefix, store } = getRedis();
  try {
    await store.set(["foo", "baz"], "baz");
    assert.strictEqual(await redis.get(`${keyPrefix}foo::baz`), '"baz"');
  } finally {
    redis.disconnect();
  }
});

test("RedisKvStore.delete()", { ignore }, async () => {
  if (ignore) return; // see https://github.com/oven-sh/bun/issues/19412
  const { redis, keyPrefix, store } = getRedis();
  try {
    await redis.set(`${keyPrefix}foo::baz`, '"baz"');
    await store.delete(["foo", "baz"]);
    assert.equal(await redis.exists(`${keyPrefix}foo::baz`), 0);
  } finally {
    redis.disconnect();
  }
});

test("RedisKvStore.list()", { ignore }, async () => {
  if (ignore) return; // see https://github.com/oven-sh/bun/issues/19412
  const { redis, store } = getRedis();
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
    await redis.flushdb();
    redis.disconnect();
  }
});

test("RedisKvStore.list() - single element key", { ignore }, async () => {
  if (ignore) return; // see https://github.com/oven-sh/bun/issues/19412
  const { redis, store } = getRedis();
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
    await redis.flushdb();
    redis.disconnect();
  }
});

test("RedisKvStore.list() - empty prefix", { ignore }, async () => {
  if (ignore) return; // see https://github.com/oven-sh/bun/issues/19412
  const { redis, store } = getRedis();
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
    await redis.flushdb();
    redis.disconnect();
  }
});
