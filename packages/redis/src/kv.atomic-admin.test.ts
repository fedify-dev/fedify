// These opt-in tests change ACL/configuration on dedicated disposable servers.
import { RedisKvStore } from "@fedify/redis/kv";
import * as temporal from "@js-temporal/polyfill";
import { Redis } from "ioredis";
import assert from "node:assert/strict";
import process from "node:process";
import { test, type TestContext } from "node:test";
import { atomicRedisVersions } from "./atomic.ts";

const Temporal = globalThis.Temporal ?? temporal.Temporal;
const adminUrl = process.env.REDIS_ATOMIC_ADMIN_URL?.trim() || undefined;
const clusterAdminNodes =
  process.env.REDIS_ATOMIC_CLUSTER_ADMIN_NODES?.trim() || undefined;
const versions = new Set<string>(atomicRedisVersions);

function skipUnsupported(t: TestContext, reason: string): void {
  // Bun lacks dynamic skip; Deno may report a dynamic skip as a pass.
  console.warn(`Skipping Redis atomic test: ${reason}`);
  if (process.versions.bun == null) t.skip(reason);
}

async function failures(admin: Redis, prefix: string): Promise<void> {
  const store = new RedisKvStore(admin, { keyPrefix: prefix });
  const user = `fedify_atomic_${crypto.randomUUID()}`;
  const password = crypto.randomUUID();
  const ttl = Temporal.Duration.from({ seconds: 30 });
  const short = Temporal.Duration.from({ seconds: 1 });
  await store.setMany([
    { key: ["a"], value: 1, options: { ttl } },
    { key: ["b"], value: 2, options: { ttl } },
  ]);
  const started = Date.now();
  const before = await Promise.all([
    admin.pttl(`${prefix}a`),
    admin.pttl(`${prefix}b`),
  ]);
  async function unchanged(): Promise<void> {
    assert.deepEqual([await store.get(["a"]), await store.get(["b"])], [1, 2]);
    const after = await Promise.all([
      admin.pttl(`${prefix}a`),
      admin.pttl(`${prefix}b`),
    ]);
    for (let i = 0; i < after.length; i++) {
      assert(
        after[i] <= before[i] &&
          after[i] >= before[i] - (Date.now() - started) - 100,
        "rejection must not change expiry",
      );
    }
  }
  await admin.acl(
    "SETUSER",
    user,
    "reset",
    "on",
    `>${password}`,
    `~${prefix}*`,
    "+eval",
    "+get",
    "+exists",
    "+set",
    "+del",
    "+ping",
    "-setex",
  );
  const limited = new Redis({
    ...admin.options,
    username: user,
    password,
    enableReadyCheck: false,
  });
  const restricted = new RedisKvStore(limited, { keyPrefix: prefix });
  try {
    await limited.ping();
    await assert.rejects(
      restricted.setMany([
        { key: ["a"], value: 10 },
        { key: ["b"], value: 20, options: { ttl: short } },
      ]),
    );
    await unchanged();
    await assert.rejects(
      restricted.casMany([
        { key: ["a"], expectedValue: "wrong", newValue: 10 },
        { key: ["b"], expectedValue: 2, newValue: 20, options: { ttl: short } },
      ]),
    );
    await unchanged();
    await admin.acl("SETUSER", user, "+setex", "-del");
    await assert.rejects(
      restricted.casMany([
        { key: ["a"], expectedValue: 1, newValue: 10 },
        { key: ["b"], expectedValue: 2, newValue: undefined },
      ]),
    );
    await unchanged();
    await admin.acl("SETUSER", user, "+del", "resetkeys", `~${prefix}a`);
    await assert.rejects(
      restricted.setMany([
        { key: ["a"], value: 10 },
        { key: ["b"], value: 20 },
      ]),
    );
    await unchanged();
    // EVAL checks both read/write key access before entering the script.
    await admin.acl("SETUSER", user, "resetkeys", `%W~${prefix}*`);
    await assert.rejects(
      restricted.setMany([
        { key: ["a"], value: 10 },
        { key: ["b"], value: 20 },
      ]),
    );
    await unchanged();
    await admin.acl("SETUSER", user, "resetkeys", `%R~${prefix}*`);
    await assert.rejects(restricted.getMany([["a"], ["b"]]));
    await unchanged();
  } finally {
    limited.disconnect();
    await admin.acl("DELUSER", user);
  }

  const originalMemory = await admin.config("GET", "maxmemory");
  const originalPolicy = await admin.config("GET", "maxmemory-policy");
  assert(
    Array.isArray(originalMemory) && typeof originalMemory[1] === "string",
  );
  assert(
    Array.isArray(originalPolicy) && typeof originalPolicy[1] === "string",
  );
  try {
    await admin.config("SET", "maxmemory-policy", "noeviction");
    await admin.config("SET", "maxmemory", "1");
    await assert.rejects(
      store.casMany([
        { key: ["a"], expectedValue: 1, newValue: undefined },
        { key: ["b"], expectedValue: 2, newValue: 20 },
      ]),
      /OOM/,
    );
    await assert.rejects(
      store.setMany([
        { key: ["a"], value: 10 },
        { key: ["b"], value: 20 },
      ]),
      /OOM/,
    );
    await assert.rejects(store.deleteMany([["a"], ["b"]]), /OOM/);
    assert.deepEqual(await store.getMany([["a"], ["b"]]), [1, 2]);
    await unchanged();
  } finally {
    await admin.config("SET", "maxmemory", originalMemory[1]);
    await admin.config("SET", "maxmemory-policy", originalPolicy[1]);
    await admin.del(`${prefix}a`, `${prefix}b`);
  }
}

test(
  "Redis atomic standalone administrative failures",
  { skip: adminUrl == null },
  async (t) => {
    if (adminUrl == null) return; // Bun ignores node:test skip.
    assert.notEqual(
      adminUrl,
      process.env.REDIS_URL,
      "use a dedicated administrative fixture, separate from ordinary package tests",
    );
    const admin = new Redis(adminUrl!);
    try {
      const actual = String(await admin.eval("return redis.REDIS_VERSION", 0));
      if (!versions.has(actual)) {
        skipUnsupported(t, `Redis ${actual} is not an audited batch engine`);
        return;
      }
      await failures(admin, `{fedify_admin_${crypto.randomUUID()}}::`);
    } finally {
      await admin.quit();
    }
  },
);

test(
  "Redis atomic Cluster administrative failures",
  { skip: clusterAdminNodes == null },
  async (t) => {
    if (clusterAdminNodes == null) return; // Bun ignores node:test skip.
    // Opt in only when no other tests/clients are using this disposable Cluster.
    const nodes = clusterAdminNodes!.split(",").map((node) => {
      const [host, port] = node.split(":");
      return new Redis(Number(port), host);
    });
    try {
      const actual = String(
        await nodes[0].eval("return redis.REDIS_VERSION", 0),
      );
      if (!versions.has(actual)) {
        skipUnsupported(t, `Redis ${actual} is not an audited batch engine`);
        return;
      }
      const prefix = `{fedify_cluster_admin_${crypto.randomUUID()}}::`;
      const slot = Number(await nodes[0].cluster("KEYSLOT", `${prefix}a`));
      const slots = await nodes[0].cluster("SLOTS");
      assert(Array.isArray(slots));
      const range = slots.find(
        (range: unknown) =>
          Array.isArray(range) && slot >= range[0] && slot <= range[1],
      );
      assert(Array.isArray(range) && Array.isArray(range[2]));
      const nodeIds = await Promise.all(
        nodes.map(async (node) => String(await node.cluster("MYID"))),
      );
      const owner = nodes.find(
        (_, index) => nodeIds[index] === String(range[2][2]),
      );
      assert(owner);
      await failures(owner, prefix);
    } finally {
      await Promise.all(nodes.map((node) => node.quit()));
    }
  },
);
