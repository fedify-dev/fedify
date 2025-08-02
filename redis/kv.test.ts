import { RedisKvStore } from "@fedify/redis/kv";
import { Redis } from "ioredis";
import assert from "node:assert/strict";
import process from "node:process";
import { test } from "node:test";

const redisUrl = process.env.REDIS_URL;
const skip = redisUrl == null;

function getRedis(): { redis: Redis; keyPrefix: string; store: RedisKvStore } {
  const redis = new Redis(redisUrl!);
  const keyPrefix = `fedify_test_${crypto.randomUUID()}::`;
  const store = new RedisKvStore(redis, { keyPrefix });
  return { redis, keyPrefix, store };
}

test("RedisKvStore.get()", { skip }, async () => {
  if (skip) return; // see https://github.com/oven-sh/bun/issues/19412
  const { redis, keyPrefix, store } = getRedis();
  try {
    await redis.set(`${keyPrefix}foo::bar`, '"foobar"');
    assert.strictEqual(await store.get(["foo", "bar"]), "foobar");
  } finally {
    redis.disconnect();
  }
});

test("RedisKvStore.set()", { skip }, async () => {
  if (skip) return; // see https://github.com/oven-sh/bun/issues/19412
  const { redis, keyPrefix, store } = getRedis();
  try {
    await store.set(["foo", "baz"], "baz");
    assert.strictEqual(await redis.get(`${keyPrefix}foo::baz`), '"baz"');
  } finally {
    redis.disconnect();
  }
});

test("RedisKvStore.delete()", { skip }, async () => {
  if (skip) return; // see https://github.com/oven-sh/bun/issues/19412
  const { redis, keyPrefix, store } = getRedis();
  try {
    await redis.set(`${keyPrefix}foo::baz`, '"baz"');
    await store.delete(["foo", "baz"]);
    assert.equal(await redis.exists(`${keyPrefix}foo::baz`), 0);
  } finally {
    redis.disconnect();
  }
});
