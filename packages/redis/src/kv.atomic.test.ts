// Independent cases and namespace cleanup must run sequentially.
/* oxlint-disable eslint/no-await-in-loop */
import type { KvKey, KvStoreCasEntry, KvStoreSetEntry } from "@fedify/fedify";
import { RedisKvStore } from "@fedify/redis/kv";
import { EncodingError, JsonCodec, type Codec } from "@fedify/redis/codec";
import { testAtomicKvStore } from "@fedify/testing";
import * as temporal from "@js-temporal/polyfill";
import { Cluster, Redis } from "ioredis";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import process from "node:process";
import { test, type TestContext } from "node:test";
import {
  atomicMaxBytes,
  atomicMaxEntries,
  atomicRedisVersions,
} from "./atomic.ts";

const Temporal = globalThis.Temporal ?? temporal.Temporal;
const redisUrl = process.env.REDIS_URL?.trim() || undefined;
const clusterNodes = process.env.REDIS_CLUSTER_NODES?.trim() || undefined;
const versions = new Set<string>(atomicRedisVersions);

function skipUnsupported(t: TestContext, reason: string): void {
  // Bun lacks dynamic skip; Deno may report a dynamic skip as a pass.
  assert.notEqual(
    process.env.FEDIFY_REDIS_REQUIRE_ATOMIC_TESTS,
    "true",
    `Atomic CI requires an audited Redis engine: ${reason}`,
  );
  console.warn(`Skipping Redis atomic test: ${reason}`);
  if (process.versions.bun == null) t.skip(reason);
}
if (process.env.FEDIFY_REDIS_REQUIRE_ATOMIC_TESTS === "true") {
  test("Redis atomic CI requires every service fixture", () => {
    for (const name of [
      "REDIS_URL",
      "REDIS_CLUSTER_NODES",
      "REDIS_ATOMIC_ADMIN_URL",
      "REDIS_ATOMIC_CLUSTER_ADMIN_NODES",
      "REDIS_ATOMIC_MIGRATION_NODES",
    ]) {
      assert(process.env[name]?.trim(), `Atomic CI requires ${name}`);
    }
  });
}

const modes = ["standalone", "cluster"] as const;

function client(mode: (typeof modes)[number]): Redis | Cluster {
  if (mode === "standalone") return new Redis(redisUrl!);
  return new Cluster(
    clusterNodes!.split(",").map((node) => {
      const [host, port] = node.split(":");
      return { host, port: Number(port) };
    }),
  );
}

async function cleanup(redis: Redis | Cluster, prefix: string): Promise<void> {
  // SCAN on Cluster itself has no slot affinity. Clean every primary directly.
  const nodes = redis instanceof Cluster ? redis.nodes("master") : [redis];
  for (const node of nodes) {
    let cursor = "0";
    do {
      const [next, keys] = await node.scan(
        cursor,
        "MATCH",
        `${prefix}*`,
        "COUNT",
        100,
      );
      cursor = next;
      if (keys.length > 0) await node.del(...keys);
    } while (cursor !== "0");
  }
}

async function version(redis: Redis | Cluster): Promise<string> {
  const info = await redis.info("server");
  const match = /^redis_version:([^\r\n]+)/m.exec(info);
  assert(match, "Redis must identify its version for these integration tests");
  return match[1];
}

for (const mode of modes) {
  const skip = mode === "standalone" ? redisUrl == null : clusterNodes == null;
  test(`Redis atomic ${mode} conformance`, { skip }, async (t) => {
    if (skip) return; // Bun ignores the node:test skip option.
    const probe = client(mode);
    try {
      const actual = await version(probe);
      if (!versions.has(actual)) {
        skipUnsupported(
          t,
          `Redis ${actual} is outside the audited batch engine list; rejection is tested separately`,
        );
        return;
      }
    } finally {
      await probe.quit();
    }
    await testAtomicKvStore(
      async () => {
        const first = client(mode);
        const second = client(mode);
        const prefix = `{fedify_atomic_${crypto.randomUUID()}}::`;
        try {
          await Promise.all([first.ping(), second.ping()]);
          return {
            first: new RedisKvStore(first, { keyPrefix: prefix }),
            second: new RedisKvStore(second, { keyPrefix: prefix }),
            async dispose() {
              try {
                await cleanup(first, prefix);
              } finally {
                await Promise.all([first.quit(), second.quit()]);
              }
            },
          };
        } catch (error) {
          first.disconnect();
          second.disconnect();
          throw error;
        }
      },
      {
        objectKeyOrder: "significant",
        ttl: {
          short: Temporal.Duration.from({ seconds: 1 }),
          wait: Temporal.Duration.from({ milliseconds: 2500 }),
        },
        rejections(makeKey) {
          const keys = Array.from({ length: atomicMaxEntries + 1 }, (_, i) =>
            makeKey("limit", String(i)),
          );
          return {
            getMany: keys,
            setMany: keys.map((key, value) => ({ key, value })),
            deleteMany: keys,
            casMany: keys.map((key, value) => ({
              key,
              expectedValue: value,
              newValue: value + 1,
            })),
          };
        },
      },
    );
  });

  test(
    `Redis atomic ${mode} engine rejection or guarded acceptance`,
    { skip },
    async () => {
      if (skip) return; // Bun ignores the node:test skip option.
      const redis = client(mode);
      const prefix = `{fedify_engine_${crypto.randomUUID()}}::`;
      const store = new RedisKvStore(redis, { keyPrefix: prefix });
      try {
        await store.set(["a"], 1, {
          ttl: Temporal.Duration.from({ seconds: 30 }),
        });
        await store.set(["b"], 2);
        const actual = await version(redis);
        if (versions.has(actual)) {
          const identity = await redis.eval(
            "return redis.REDIS_VERSION_NUM",
            0,
          );
          assert.equal(
            identity,
            actual.split(".").reduce((n, part) => n * 256 + Number(part), 0),
          );
          assert.deepEqual(await store.getMany([["a"], ["b"]]), [1, 2]);
          return;
        }
        const before = await redis.pttl(`${prefix}a`);
        const calls = [
          () => store.getMany([["a"], ["b"]]),
          () =>
            store.setMany([
              { key: ["a"], value: 10 },
              { key: ["b"], value: 20 },
            ]),
          () => store.deleteMany([["a"], ["b"]]),
          () =>
            store.casMany([
              { key: ["a"], expectedValue: 1, newValue: 10 },
              { key: ["b"], expectedValue: 2, newValue: 20 },
            ]),
        ];
        for (const call of calls) {
          // Redis before 7.0 rejects the script shebang during compilation,
          // before the in-script version guard can provide its own message.
          if (Number(actual.split(".")[0]) < 7) await assert.rejects(call);
          else
            await assert.rejects(
              call,
              /atomic KV batches require official Redis/,
            );
        }
        assert.deepEqual(
          [await store.get(["a"]), await store.get(["b"])],
          [1, 2],
        );
        const after = await redis.pttl(`${prefix}a`);
        assert(
          after > 0 && after <= before,
          "rejection must preserve the original expiry",
        );
        assert.deepEqual(await store.getMany([]), []);
        await store.setMany([]);
        await store.deleteMany([]);
        assert.equal(await store.casMany([]), true);
      } finally {
        await cleanup(redis, prefix);
        await redis.quit();
      }
    },
  );

  test(
    `Redis atomic ${mode} validation, codec, and physical deletion`,
    { skip },
    async (t) => {
      if (skip) return; // Bun ignores the node:test skip option.
      const redis = client(mode);
      const prefix = `{fedify_edges_${crypto.randomUUID()}}::`;
      const store = new RedisKvStore(redis, { keyPrefix: prefix });
      try {
        const actual = await version(redis);
        if (!versions.has(actual)) {
          skipUnsupported(t, `Redis ${actual} is not an audited batch engine`);
          return;
        }
        await store.setMany([
          { key: ["a"], value: 1 },
          { key: ["b"], value: 2 },
        ]);
        const ttl = Temporal.Duration.from({ seconds: 30 });
        await assert.rejects(store.set(["a"], undefined));
        await assert.rejects(store.cas(["a"], "wrong", undefined, { ttl }));
        await assert.rejects(store.cas(["a"], 1, undefined, { ttl }));
        await assert.rejects(
          store.setMany([
            { key: ["a"], value: 10 },
            { key: ["b"], value: undefined },
          ]),
        );
        await assert.rejects(
          store.setMany([
            { key: ["a"], value: 10 },
            {
              key: ["b"],
              value: 20,
              options: { ttl: Temporal.Duration.from({ months: 1 }) },
            },
          ]),
        );
        await assert.rejects(
          store.casMany([
            { key: ["a"], expectedValue: "wrong", newValue: 10 },
            {
              key: ["b"],
              expectedValue: 2,
              newValue: undefined,
              options: { ttl },
            },
          ]),
        );
        await assert.rejects(
          store.setMany([
            { key: ["a"], value: 10 },
            {
              key: ["b"],
              value: 20,
              options: { ttl: Temporal.Duration.from({ seconds: 2 ** 31 }) },
            },
          ]),
        );
        await assert.rejects(
          store.setMany([
            { key: ["a"], value: 10 },
            { key: ["b"], value: "x".repeat(atomicMaxBytes) },
          ]),
        );
        await assert.rejects(
          store.casMany([
            {
              key: ["a"],
              expectedValue: "x".repeat(atomicMaxBytes),
              newValue: 10,
            },
          ]),
        );
        // Single-key methods retain the old large-duration range; batch
        // scripts deliberately accept only their audited, bounded TTL range.
        const hugeTtl = Temporal.Duration.from({
          seconds: Number.MAX_SAFE_INTEGER,
          milliseconds: 999,
        });
        await store.set(["huge"], 1, { ttl: hugeTtl });
        assert.equal(await store.cas(["huge"], 1, 2, { ttl: hugeTtl }), true);
        assert.equal(await store.get(["huge"]), 2);
        await assert.rejects(
          store.setMany([
            { key: ["huge"], value: 3, options: { ttl: hugeTtl } },
          ]),
          RangeError,
        );
        assert.equal(await store.get(["huge"]), 2);
        await assert.rejects(store.deleteMany([["\ud800"], ["\ud801"]]));
        await assert.rejects(store.getMany(new Array<KvKey>(2)));
        await assert.rejects(store.setMany(new Array<KvStoreSetEntry>(2)));
        await assert.rejects(store.casMany(new Array<KvStoreCasEntry>(2)));
        assert.deepEqual(await store.getMany([["a"], ["b"]]), [1, 2]);
        const throwing: Codec = {
          encode(value) {
            if (value === "fail") throw new Error("late codec failure");
            return new JsonCodec().encode(value);
          },
          decode(value) {
            return new JsonCodec().decode(value);
          },
        };
        const failed = new RedisKvStore(redis, {
          keyPrefix: prefix,
          codec: throwing,
        });
        await assert.rejects(
          failed.setMany([
            { key: ["a"], value: 10 },
            { key: ["b"], value: "fail" },
          ]),
          /late codec failure/,
        );
        assert.deepEqual(await store.getMany([["a"], ["b"]]), [1, 2]);
        await redis.del(`${prefix}b`);
        await redis.rpush(`${prefix}b`, "nonstring");
        await assert.rejects(
          store.casMany([
            { key: ["a"], expectedValue: 1, newValue: 10 },
            { key: ["b"], expectedValue: 2, newValue: 20 },
          ]),
          /WRONGTYPE/,
        );
        assert.equal(await store.get(["a"]), 1);
        await store.setMany([
          { key: ["a"], value: 3 },
          { key: ["b"], value: 4 },
        ]);
        await store.deleteMany([["a"]]);
        assert.equal(await redis.exists(`${prefix}a`), 0);
        assert.equal(
          await store.casMany([
            { key: ["b"], expectedValue: 4, newValue: undefined },
          ]),
          true,
        );
        assert.equal(await redis.exists(`${prefix}b`), 0);
        await store.setMany([
          {
            key: ["expires"],
            value: 1,
            options: { ttl: Temporal.Duration.from({ milliseconds: 1 }) },
          },
        ]);
        const remaining = await redis.pttl(`${prefix}expires`);
        assert(remaining > 0 && remaining <= 1000);
        await new Promise((resolve) => setTimeout(resolve, 1100));
        assert.equal(await store.get(["expires"]), undefined);
        assert.equal(await redis.exists(`${prefix}expires`), 0);
        await store.setMany([{ key: ["reopen"], value: { persistent: true } }]);
        const reopened = client(mode);
        try {
          assert.deepEqual(
            await new RedisKvStore(reopened, { keyPrefix: prefix }).getMany([
              ["reopen"],
            ]),
            [{ persistent: true }],
          );
        } finally {
          await reopened.quit();
        }
      } finally {
        await cleanup(redis, prefix);
        await redis.quit();
      }
    },
  );
}

test("JsonCodec rejects unencodable top-level values", () => {
  const codec = new JsonCodec();
  for (const value of [undefined, Symbol("value"), () => 1])
    assert.throws(() => codec.encode(value), EncodingError);
});

for (const mode of modes) {
  const skip = mode === "standalone" ? redisUrl == null : clusterNodes == null;
  test(
    `Redis atomic ${mode} binary codecs, capture, and prefixes`,
    { skip },
    async (t) => {
      if (skip) return; // Bun ignores the node:test skip option.
      const redis = client(mode);
      const prefix = `{fedify_binary_${crypto.randomUUID()}}::`;
      try {
        const actual = await version(redis);
        if (!versions.has(actual)) {
          skipUnsupported(t, `Redis ${actual} is not an audited batch engine`);
          return;
        }
        const scratch = Buffer.alloc(32);
        const codec: Codec = {
          encode(value) {
            assert.equal(typeof value, "string");
            if (value === "") return Buffer.alloc(0);
            scratch.fill(0);
            scratch.write(String(value));
            return scratch;
          },
          decode(value) {
            return value.toString().replace(/\0+$/, "");
          },
        };
        const store = new RedisKvStore(redis, { keyPrefix: prefix, codec });
        await store.setMany([
          { key: ["a"], value: "one" },
          { key: ["b"], value: "two" },
        ]);
        assert.deepEqual(await store.getMany([["a"], ["b"]]), ["one", "two"]);
        assert.equal(await store.cas(["a"], "one", "three"), true);
        assert.equal(
          await store.casMany([
            { key: ["a"], expectedValue: "three", newValue: "four" },
            { key: ["b"], expectedValue: "two", newValue: "" },
          ]),
          true,
        );
        assert.deepEqual(await store.getMany([["b"], ["missing"], ["a"]]), [
          "",
          undefined,
          "four",
        ]);
        assert.equal(
          await store.casMany([
            { key: ["b"], expectedValue: "", newValue: "five" },
          ]),
          true,
        );

        const identity: Codec = {
          encode(value) {
            assert(Buffer.isBuffer(value));
            return value;
          },
          decode(value) {
            return Buffer.from(value);
          },
        };
        const binary = new RedisKvStore(redis, {
          keyPrefix: prefix,
          codec: identity,
        });
        const value = Buffer.from([0, 255, 128, 1]);
        const write = binary.setMany([{ key: ["bytes"], value }]);
        value.fill(7);
        await write;
        assert.deepEqual(await binary.getMany([["bytes"]]), [
          Buffer.from([0, 255, 128, 1]),
        ]);
        assert.equal(
          await binary.casMany([
            {
              key: ["bytes"],
              expectedValue: Buffer.from([0, 255, 128, 1]),
              newValue: Buffer.from([254, 0]),
            },
          ]),
          true,
        );
        assert.deepEqual(await binary.get(["bytes"]), Buffer.from([254, 0]));

        const json = new RedisKvStore(redis, { keyPrefix: prefix });
        const later = { key: ["captured-b"] as KvKey, value: 2 };
        let reads = 0;
        const first = {
          key: ["captured-a"] as KvKey,
          get value() {
            reads++;
            return {
              toJSON() {
                later.value = 99;
                return 1;
              },
            };
          },
        };
        await json.setMany([first, later]);
        assert.equal(reads, 1);
        assert.deepEqual(
          await json.getMany([["captured-a"], ["captured-b"]]),
          [1, 2],
        );

        const binaryPrefix = Buffer.concat([
          Buffer.from(prefix),
          Buffer.from([255]),
        ]);
        const frozen = Buffer.from(binaryPrefix);
        const prefixed = new RedisKvStore(redis, { keyPrefix: binaryPrefix });
        binaryPrefix.fill(0);
        try {
          await prefixed.setMany([
            { key: ["a"], value: 1 },
            { key: ["b"], value: 2 },
          ]);
          assert.deepEqual(await prefixed.getMany([["a"], ["b"]]), [1, 2]);
          assert.equal(
            await redis.get(Buffer.concat([frozen, Buffer.from("a")])),
            "1",
          );
        } finally {
          await redis.del(
            Buffer.concat([frozen, Buffer.from("a")]),
            Buffer.concat([frozen, Buffer.from("b")]),
          );
        }
      } finally {
        await cleanup(redis, prefix);
        await redis.quit();
      }

      // A string prefix ending in a high surrogate joins a low surrogate key
      // before ioredis encodes UTF-8. These are distinct physical keys.
      const clientPrefix = `{fedify_client_${crypto.randomUUID()}}\ud800`;
      const configured =
        mode === "standalone"
          ? new Redis(redisUrl!, { keyPrefix: clientPrefix })
          : new Cluster(
              clusterNodes!.split(",").map((node) => {
                const [host, port] = node.split(":");
                return { host, port: Number(port) };
              }),
              { redisOptions: { keyPrefix: clientPrefix } },
            );
      const raw = client(mode);
      const store = new RedisKvStore(configured, { keyPrefix: "" });
      try {
        await store.setMany([
          { key: ["\udc00"], value: 1 },
          { key: ["\udc01"], value: 2 },
        ]);
        assert.deepEqual(await store.getMany([["\udc00"], ["\udc01"]]), [1, 2]);
        assert.equal(await raw.get(Buffer.from(clientPrefix + "\udc00")), "1");
      } finally {
        await raw.del(
          Buffer.from(clientPrefix + "\udc00"),
          Buffer.from(clientPrefix + "\udc01"),
        );
        await Promise.all([configured.quit(), raw.quit()]);
      }

      const oversizedPrefix = `{'budget'}${"x".repeat(atomicMaxBytes)}`;
      const oversized =
        mode === "standalone"
          ? new Redis(redisUrl!, { keyPrefix: oversizedPrefix })
          : new Cluster(
              clusterNodes!.split(",").map((node) => {
                const [host, port] = node.split(":");
                return { host, port: Number(port) };
              }),
              { redisOptions: { keyPrefix: oversizedPrefix } },
            );
      try {
        const store = new RedisKvStore(oversized);
        await assert.rejects(store.getMany([["a"]]), RangeError);
        await assert.rejects(
          store.setMany([{ key: ["a"], value: 1 }]),
          RangeError,
        );
      } finally {
        await oversized.quit();
      }
    },
  );
}

for (const mode of modes) {
  const skip = mode === "standalone" ? redisUrl == null : clusterNodes == null;
  test(`Redis atomic ${mode} stringNumbers replies`, { skip }, async (t) => {
    if (skip) return; // Bun ignores the node:test skip option.
    const redis =
      mode === "standalone"
        ? new Redis(redisUrl!, { stringNumbers: true })
        : new Cluster(
            clusterNodes!.split(",").map((node) => {
              const [host, port] = node.split(":");
              return { host, port: Number(port) };
            }),
            { redisOptions: { stringNumbers: true } },
          );
    const prefix = `{fedify_numbers_${crypto.randomUUID()}}::`;
    const store = new RedisKvStore(redis, { keyPrefix: prefix });
    try {
      const actual = await version(redis);
      if (!versions.has(actual)) {
        skipUnsupported(t, `Redis ${actual} is not an audited batch engine`);
        return;
      }
      assert.equal(
        await store.casMany([
          { key: ["a"], expectedValue: undefined, newValue: 1 },
          { key: ["b"], expectedValue: undefined, newValue: 2 },
        ]),
        true,
      );
      assert.equal(await store.cas(["a"], 1, 3), true);
      assert.equal(await store.cas(["a"], 1, 4), false);
      assert.equal(
        await store.casMany([
          { key: ["a"], expectedValue: 1, newValue: 4 },
          { key: ["b"], expectedValue: 2, newValue: 5 },
        ]),
        false,
      );
      assert.deepEqual(await store.getMany([["a"], ["b"]]), [3, 2]);
    } finally {
      await redis.del(`${prefix}a`, `${prefix}b`);
      await redis.quit();
    }
  });
}

test("Redis CAS validates numeric, string, and binary replies without retrying", async () => {
  const cases: [unknown, boolean][] = [
    [1, true],
    ["1", true],
    [Buffer.from("1"), true],
    [0, false],
    ["0", false],
    [Buffer.from("0"), false],
  ];
  const invalid = [
    undefined,
    null,
    2,
    -1,
    true,
    "01",
    " 1",
    Buffer.from([0xb1]),
    Buffer.alloc(0),
  ];
  for (const [reply, expected] of cases) {
    let calls = 0;
    const redis = {
      options: {},
      eval() {
        calls++;
        return Promise.resolve(reply);
      },
      sendCommand() {
        calls++;
        return Promise.resolve(reply);
      },
    } as unknown as Redis;
    const store = new RedisKvStore(redis);
    assert.equal(await store.cas(["key"], 1, 2), expected);
    assert.equal(
      await store.casMany([{ key: ["key"], expectedValue: 1, newValue: 2 }]),
      expected,
    );
    assert.equal(calls, 2, "each CAS must dispatch once without a retry");
  }
  for (const reply of invalid) {
    let calls = 0;
    const redis = {
      options: {},
      eval() {
        calls++;
        return Promise.resolve(reply);
      },
      sendCommand() {
        calls++;
        return Promise.resolve(reply);
      },
    } as unknown as Redis;
    const store = new RedisKvStore(redis);
    await assert.rejects(store.cas(["key"], 1, 2), /Invalid Redis CAS reply/);
    await assert.rejects(
      store.casMany([{ key: ["key"], expectedValue: 1, newValue: 2 }]),
      /Invalid Redis CAS reply/,
    );
    assert.equal(calls, 2, "an invalid reply must not replay the request");
  }
});

for (const mode of modes) {
  const skip = mode === "standalone" ? redisUrl == null : clusterNodes == null;
  test(
    `Redis atomic ${mode} successful auto-pipelined snapshots`,
    { skip },
    async (t) => {
      if (skip) return; // Bun ignores the node:test skip option.
      const redis =
        mode === "standalone"
          ? new Redis(redisUrl!, { enableAutoPipelining: true })
          : new Cluster(
              clusterNodes!.split(",").map((node) => {
                const [host, port] = node.split(":");
                return { host, port: Number(port) };
              }),
              { enableAutoPipelining: true },
            );
      const prefix = `{fedify_pipeline_${crypto.randomUUID()}}::`;
      const store = new RedisKvStore(redis, { keyPrefix: prefix });
      try {
        const actual = await version(redis);
        if (!versions.has(actual)) {
          skipUnsupported(t, `Redis ${actual} is not an audited batch engine`);
          return;
        }
        await store.setMany([
          { key: ["a"], value: 1 },
          { key: ["b"], value: null },
        ]);
        assert.deepEqual(
          await store.getMany([["b"], ["missing"], ["a"], ["a"]]),
          [null, undefined, 1, 1],
        );
        assert.equal(
          await store.casMany([{ key: ["a"], expectedValue: 1, newValue: 2 }]),
          true,
        );
        const codec: Codec = {
          encode(value) {
            assert(Buffer.isBuffer(value));
            return value;
          },
          decode(value) {
            return Buffer.from(value);
          },
        };
        const binary = new RedisKvStore(redis, { keyPrefix: prefix, codec });
        await binary.setMany([
          { key: ["bytes"], value: Buffer.from([0, 255, 128]) },
          { key: ["empty"], value: Buffer.alloc(0) },
        ]);
        const [first, second] = await Promise.all([
          binary.getMany([["bytes"], ["missing"], ["empty"], ["bytes"]]),
          store.getMany([["a"], ["b"]]),
        ]);
        assert.deepEqual(first, [
          Buffer.from([0, 255, 128]),
          undefined,
          Buffer.alloc(0),
          Buffer.from([0, 255, 128]),
        ]);
        assert.deepEqual(second, [2, null]);
        await store.deleteMany([["a"], ["b"]]);
        assert.deepEqual(await store.getMany([["a"], ["b"]]), [
          undefined,
          undefined,
        ]);
      } finally {
        await cleanup(redis, prefix);
        await redis.quit();
      }
    },
  );
}

test("Redis KV rejects malformed keys and non-array batches before dispatch", async () => {
  let dispatched = 0;
  function dispatch(): Promise<null> {
    dispatched++;
    return Promise.resolve(null);
  }
  const redis = {
    options: {},
    getBuffer: dispatch,
    set: dispatch,
    setex: dispatch,
    del: dispatch,
    eval: dispatch,
    sendCommand: dispatch,
  } as unknown as Redis;
  const store = new RedisKvStore(redis);
  const empty = [] as unknown as KvKey;
  const sparse = new Array<string>(1) as unknown as KvKey;
  const nonString = ["a", 1] as unknown as KvKey;
  const arrayLike = { 0: ["valid"], length: 1 } as unknown as readonly KvKey[];
  const operations = [
    () => store.get(empty),
    () => store.set(empty, 1),
    () => store.get(sparse),
    () => store.getMany([empty]),
    () => store.deleteMany([empty]),
    () => store.setMany([{ key: nonString, value: 1 }]),
    () =>
      store.casMany([{ key: sparse, expectedValue: undefined, newValue: 1 }]),
    () => store.getMany(arrayLike),
    () => store.deleteMany("x" as unknown as readonly KvKey[]),
    () =>
      store.setMany({
        0: { key: ["valid"], value: 1 },
        length: 1,
      } as unknown as readonly KvStoreSetEntry[]),
  ];
  for (const operation of operations) {
    await assert.rejects(operation, TypeError);
    assert.equal(dispatched, 0, "invalid input must not dispatch a command");
  }
});
