// Slot migration is opt-in and exclusively owns a disposable Cluster fixture.
/* oxlint-disable eslint/no-await-in-loop */
import type { KvKey } from "@fedify/fedify";
import { RedisKvStore } from "@fedify/redis/kv";
import { Cluster, Redis, type Command, type Pipeline } from "ioredis";
import assert from "node:assert/strict";
import process from "node:process";
import { test, type TestContext } from "node:test";
import { atomicRedisVersions, atomicSnapshotScript } from "./atomic.ts";

const addresses = process.env.REDIS_CLUSTER_NODES?.trim() || undefined;
const migrationAddresses =
  process.env.REDIS_ATOMIC_MIGRATION_NODES?.trim() || undefined;
const versions = new Set<string>(atomicRedisVersions);

function skipUnsupported(t: TestContext, reason: string): void {
  // Bun lacks dynamic skip; Deno may report a dynamic skip as a pass.
  console.warn(`Skipping Redis atomic test: ${reason}`);
  if (process.versions.bun == null) t.skip(reason);
}

function startup(addresses: string): { host: string; port: number }[] {
  return addresses.split(",").map((address) => {
    const [host, port] = address.split(":");
    return { host, port: Number(port) };
  });
}

async function supported(redis: Redis | Cluster): Promise<boolean> {
  return versions.has(
    String(await redis.eval("return redis.REDIS_VERSION", 0)),
  );
}

test(
  "Redis atomic Cluster primary routing and namespace isolation",
  { skip: addresses == null },
  async (t) => {
    if (addresses == null) return; // Bun ignores node:test skip.
    let readRouting = 0;
    const cluster = new Cluster(startup(addresses!), {
      scaleReads(nodes: Redis[]) {
        readRouting++;
        return nodes[0];
      },
    });
    const tag = `{fedify_routing_${crypto.randomUUID()}}`;
    const firstPrefix = `${tag}:one::`,
      secondPrefix = `${tag}:two::`;
    const first = new RedisKvStore(cluster, { keyPrefix: firstPrefix });
    const second = new RedisKvStore(cluster, { keyPrefix: secondPrefix });
    try {
      if (!(await supported(cluster))) {
        skipUnsupported(t, "Redis is not an audited batch engine");
        return;
      }
      await first.setMany([
        { key: ["a"], value: 1 },
        { key: ["b"], value: 2 },
      ]);
      await second.setMany([
        { key: ["a"], value: 10 },
        { key: ["b"], value: 20 },
      ]);
      readRouting = 0;
      assert.deepEqual(await first.getMany([["a"], ["b"]]), [1, 2]);
      assert.deepEqual(await second.getMany([["a"], ["b"]]), [10, 20]);
      assert.equal(
        readRouting,
        0,
        "ordinary EVAL must bypass replica/custom read routing",
      );
      await first.get(["a"]);
      assert(
        readRouting > 0,
        "the custom read route must be active for ordinary GET",
      );
    } finally {
      await cluster.del(
        `${firstPrefix}a`,
        `${firstPrefix}b`,
        `${secondPrefix}a`,
        `${secondPrefix}b`,
      );
      await cluster.quit();
    }
  },
);

for (const autoPipeline of [false, true]) {
  test(
    `Redis atomic Cluster rejects different slots on one master (auto pipeline ${autoPipeline})`,
    { skip: addresses == null },
    async (t) => {
      if (addresses == null) return; // Bun ignores node:test skip.
      const cluster = new Cluster(startup(addresses!), {
        enableAutoPipelining: autoPipeline,
      });
      const prefix = `fedify_cross_${crypto.randomUUID()}::`;
      const store = new RedisKvStore(cluster, { keyPrefix: prefix });
      let keys: KvKey[] = [];
      try {
        if (!(await supported(cluster))) {
          skipUnsupported(t, "Redis is not an audited batch engine");
          return;
        }
        const slots = await cluster.cluster("SLOTS");
        assert(Array.isArray(slots) && Array.isArray(slots[0]));
        const [start, end] = slots[0];
        const found: { key: KvKey; slot: number }[] = [];
        for (let i = 0; i < 100 && found.length < 2; i++) {
          const key: KvKey = [String(i)];
          const slot = Number(
            await cluster.cluster("KEYSLOT", `${prefix}${i}`),
          );
          if (
            slot >= start &&
            slot <= end &&
            !found.some((entry) => entry.slot === slot)
          )
            found.push({ key, slot });
        }
        assert.equal(found.length, 2);
        keys = found.map((entry) => entry.key);
        await store.set(keys[0], 1);
        await store.set(keys[1], 2);
        await assert.rejects(store.getMany(keys));
        await assert.rejects(
          store.setMany([
            { key: keys[0], value: 10 },
            { key: keys[1], value: 20 },
          ]),
        );
        await assert.rejects(store.deleteMany(keys));
        await assert.rejects(
          store.casMany([
            { key: keys[0], expectedValue: 1, newValue: 10 },
            { key: keys[1], expectedValue: 2, newValue: 20 },
          ]),
        );
        assert.deepEqual(
          [await store.get(keys[0]), await store.get(keys[1])],
          [1, 2],
        );
      } finally {
        // DEL itself cannot combine the deliberately different slots.
        for (const key of keys) await store.delete(key);
        await cluster.quit();
      }
    },
  );
}

test(
  "Redis atomic Cluster an empty first brace pair does not select a later tag",
  { skip: addresses == null },
  async (t) => {
    if (addresses == null) return; // Bun ignores node:test skip.
    const cluster = new Cluster(startup(addresses!));
    const prefix = `{}{fedify_empty_${crypto.randomUUID()}}::`;
    const store = new RedisKvStore(cluster, { keyPrefix: prefix });
    try {
      if (!(await supported(cluster))) {
        skipUnsupported(t, "Redis is not an audited batch engine");
        return;
      }
      assert.notEqual(
        await cluster.cluster("KEYSLOT", `${prefix}a`),
        await cluster.cluster("KEYSLOT", `${prefix}b`),
      );
      await store.set(["a"], 1);
      await store.set(["b"], 2);
      await assert.rejects(
        store.setMany([
          { key: ["a"], value: 10 },
          { key: ["b"], value: 20 },
        ]),
      );
      assert.deepEqual(
        [await store.get(["a"]), await store.get(["b"])],
        [1, 2],
      );
    } finally {
      await store.delete(["a"]);
      await store.delete(["b"]);
      await cluster.quit();
    }
  },
);

test(
  "Redis atomic Cluster concurrent batches across masters and ordinary commands",
  { skip: addresses == null },
  async (t) => {
    if (addresses == null) return; // Bun ignores node:test skip.
    const cluster = new Cluster(startup(addresses), {
      enableAutoPipelining: true,
    });
    const prefixes: string[] = [];
    let ordinaryKey = "";
    try {
      if (!(await supported(cluster))) {
        skipUnsupported(t, "Redis is not an audited batch engine");
        return;
      }
      const slots = await cluster.cluster("SLOTS");
      assert(Array.isArray(slots));
      const owner = (slot: number): string => {
        const range = slots.find(
          (range: unknown) =>
            Array.isArray(range) && slot >= range[0] && slot <= range[1],
        );
        assert(Array.isArray(range) && Array.isArray(range[2]));
        return String(range[2][2]);
      };
      const scriptOwner = owner(
        Number(await cluster.cluster("KEYSLOT", atomicSnapshotScript)),
      );
      const found = new Map<string, string>();
      for (
        let i = 0;
        i < 100 && (found.size < 2 || !found.has(scriptOwner));
        i++
      ) {
        const prefix = `{fedify_multimaster_${crypto.randomUUID()}}::`;
        const node = owner(
          Number(await cluster.cluster("KEYSLOT", `${prefix}a`)),
        );
        found.set(node, prefix);
      }
      assert(
        found.size >= 2 && found.has(scriptOwner),
        "a multi-master Cluster fixture is required",
      );
      const firstPrefix = found.get(scriptOwner)!;
      const secondPrefix = [...found].find(
        ([node]) => node !== scriptOwner,
      )![1];
      prefixes.push(firstPrefix, secondPrefix);
      const first = new RedisKvStore(cluster, { keyPrefix: firstPrefix });
      const second = new RedisKvStore(cluster, { keyPrefix: secondPrefix });
      await Promise.all([
        first.setMany([{ key: ["a"], value: 1 }]),
        second.setMany([{ key: ["a"], value: 10 }]),
      ]);
      assert.deepEqual(
        await Promise.all([first.getMany([["a"]]), second.getMany([["a"]])]),
        [[1], [10]],
      );
      ordinaryKey = `${firstPrefix}ordinary`;
      await cluster.set(ordinaryKey, "ordinary");
      const [snapshot, ordinary] = await Promise.all([
        second.getMany([["a"]]),
        cluster.get(ordinaryKey),
      ]);
      assert.deepEqual(snapshot, [10]);
      assert.equal(ordinary, "ordinary");
      assert.deepEqual(
        await Promise.all([
          first.casMany([{ key: ["a"], expectedValue: 1, newValue: 2 }]),
          second.casMany([{ key: ["a"], expectedValue: 10, newValue: 20 }]),
        ]),
        [true, true],
      );
      assert.deepEqual(
        await Promise.all([first.getMany([["a"]]), second.getMany([["a"]])]),
        [[2], [20]],
      );
      await Promise.all([
        first.deleteMany([["a"]]),
        second.deleteMany([["a"]]),
      ]);
      assert.deepEqual(
        await Promise.all([first.getMany([["a"]]), second.getMany([["a"]])]),
        [[undefined], [undefined]],
      );
    } finally {
      for (const prefix of prefixes) await cluster.del(`${prefix}a`);
      if (ordinaryKey !== "") await cluster.del(ordinaryKey);
      await cluster.quit();
    }
  },
);

test(
  "Redis atomic Cluster resharding and routing-to-execution expiry regression",
  { skip: migrationAddresses == null },
  async (t) => {
    if (migrationAddresses == null) return; // Bun ignores node:test skip.
    const nodes = startup(migrationAddresses!).map(
      ({ host, port }) => new Redis(port, host),
    );
    const routed = new Cluster(startup(migrationAddresses!));
    const bounded = new Cluster(startup(migrationAddresses!), {
      maxRedirections: 1,
      retryDelayOnTryAgain: 0,
    });
    let source: Redis | undefined, target: Redis | undefined;
    let sourceId = "",
      targetId = "",
      slot = -1,
      prefix = "";
    let committed = false;
    let slowClient: Redis | undefined;
    const slow = `local start = redis.call('TIME')
local deadline = tonumber(start[1]) * 1000000 + tonumber(start[2]) + 100000
repeat
  local now = redis.call('TIME')
  if tonumber(now[1]) * 1000000 + tonumber(now[2]) >= deadline then break end
until false
return 1`;
    try {
      if (!(await supported(nodes[0]))) {
        skipUnsupported(t, "Redis is not an audited batch engine");
        return;
      }
      assert.equal(nodes.length, 3, "use a dedicated three-master fixture");
      const slots = await nodes[0].cluster("SLOTS");
      assert(Array.isArray(slots));
      for (let attempt = 0; attempt < 100; attempt++) {
        prefix = `{fedify_migration_${crypto.randomUUID()}}::`;
        slot = Number(await nodes[0].cluster("KEYSLOT", `${prefix}a`));
        const range = slots.find(
          (range: unknown) =>
            Array.isArray(range) && slot >= range[0] && slot <= range[1],
        );
        assert(Array.isArray(range) && Array.isArray(range[2]));
        source = nodes.find((node) => node.options.port === range[2][1]);
        assert(source);
        if (Number(await source.cluster("COUNTKEYSINSLOT", slot)) === 0) break;
        slot = -1;
      }
      assert(slot >= 0 && source, "an empty test slot is required");
      target = nodes.find((node) => node !== source);
      assert(target);
      sourceId = String(await source.cluster("MYID"));
      targetId = String(await target.cluster("MYID"));
      slowClient = new Redis({
        host: source.options.host,
        port: source.options.port,
        enableAutoPipelining: true,
      });
      const store = new RedisKvStore(routed, { keyPrefix: prefix });
      const limited = new RedisKvStore(bounded, { keyPrefix: prefix });
      const keys = [`${prefix}a`, `${prefix}b`];

      // Warm routing before changing ownership, then force the older routing
      // snapshot/newer script snapshot window on one auto-pipelined connection.
      await store.setMany([
        { key: ["a"], value: 1 },
        { key: ["b"], value: 2 },
      ]);
      await target.cluster("SETSLOT", slot, "IMPORTING", sourceId);
      await source.cluster("SETSLOT", slot, "MIGRATING", targetId);
      for (const operation of ["set", "delete", "cas"] as const) {
        await source.cluster("SETSLOT", slot, "STABLE");
        await source.set(keys[0], "1", "PX", 50);
        await source.set(keys[1], "2");
        await source.cluster("SETSLOT", slot, "MIGRATING", targetId);
        // Send both requests in one explicit pipeline so the routing clock
        // predates the slow script but the batch execution clock follows it.
        // Capture the actual adapter Command, including its declared keys.
        const pipeline = slowClient.pipeline() as Pipeline;
        pipeline.eval(slow, 0);
        const queued = {
          options: slowClient.options,
          sendCommand(command: Command): Promise<unknown> {
            pipeline.sendCommand(command);
            return command.promise;
          },
        } as unknown as Redis;
        const direct = new RedisKvStore(queued, { keyPrefix: prefix });
        const change =
          operation === "set"
            ? direct.setMany([
                { key: ["b"], value: 100 },
                { key: ["a"], value: 200 },
              ])
            : operation === "delete"
              ? direct.deleteMany([["b"], ["a"]])
              : direct.casMany([
                  { key: ["b"], expectedValue: 2, newValue: undefined },
                  { key: ["a"], expectedValue: 1, newValue: 200 },
                ]);
        const results: PromiseSettledResult<unknown>[] =
          await Promise.allSettled([pipeline.exec(), change]);
        assert.equal(results[0].status, "fulfilled");
        assert.equal(
          results[1].status,
          "rejected",
          "a later expired migrating key must reject before all writes",
        );
        assert.equal(
          await source.get(keys[1]),
          "2",
          "the earlier persistent key must be untouched",
        );
      }
      await source.cluster("SETSLOT", slot, "STABLE");
      await store.setMany([
        { key: ["a"], value: 1 },
        { key: ["b"], value: 2 },
      ]);
      await source.cluster("SETSLOT", slot, "MIGRATING", targetId);
      assert.equal(
        await store.casMany([
          { key: ["a"], expectedValue: 1, newValue: 3 },
          { key: ["b"], expectedValue: 2, newValue: 4 },
        ]),
        true,
      );
      await source.migrate(
        target.options.host ?? "127.0.0.1",
        target.options.port ?? 6379,
        keys[0],
        0,
        5000,
      );
      await assert.rejects(limited.getMany([["a"], ["b"]]));
      await assert.rejects(
        limited.setMany([
          { key: ["a"], value: 10 },
          { key: ["b"], value: 20 },
        ]),
      );
      await assert.rejects(limited.deleteMany([["a"], ["b"]]));
      await assert.rejects(
        limited.casMany([
          { key: ["a"], expectedValue: 3, newValue: 10 },
          { key: ["b"], expectedValue: 4, newValue: 20 },
        ]),
      );
      await target.call("ASKING");
      assert.equal(await target.get(keys[0]), "3");
      assert.equal(await source.get(keys[1]), "4");
      await assert.rejects(
        limited.casMany([
          { key: ["missing-a"], expectedValue: undefined, newValue: 1 },
          { key: ["missing-b"], expectedValue: undefined, newValue: 2 },
        ]),
      );
      await source.migrate(
        target.options.host ?? "127.0.0.1",
        target.options.port ?? 6379,
        keys[1],
        0,
        5000,
      );
      await assert.rejects(
        source.callBuffer("eval", atomicSnapshotScript, 2, ...keys),
        /ASK/,
      );
      assert.deepEqual(
        await store.getMany([["a"], ["b"]]),
        [3, 4],
        "the Cluster client must follow ASK/ASKING",
      );
      assert.equal(
        await store.casMany([
          { key: ["a"], expectedValue: 3, newValue: 5 },
          { key: ["b"], expectedValue: 4, newValue: 6 },
        ]),
        true,
      );
      await target.cluster("SETSLOT", slot, "NODE", targetId);
      await source.cluster("SETSLOT", slot, "NODE", targetId);
      for (const node of nodes)
        if (node !== source && node !== target)
          await node.cluster("SETSLOT", slot, "NODE", targetId);
      committed = true;
      await assert.rejects(source.get(keys[0]), /MOVED/);
      assert.deepEqual(
        await store.getMany([["a"], ["b"]]),
        [5, 6],
        "routing must recover after ownership moves",
      );
      await store.deleteMany([["a"], ["b"]]);
      assert.equal(await target.exists(...keys), 0);
    } finally {
      try {
        if (source && target && slot >= 0 && sourceId) {
          const owner = committed ? target : source;
          const other = committed ? source : target;
          const ownerId = committed ? targetId : sourceId;
          await owner.cluster("SETSLOT", slot, "STABLE");
          await other.cluster("SETSLOT", slot, "IMPORTING", ownerId);
          for (const suffix of ["a", "b", "missing-a", "missing-b"]) {
            await other.call("ASKING");
            await other.del(`${prefix}${suffix}`);
          }
          await owner.del(
            `${prefix}a`,
            `${prefix}b`,
            `${prefix}missing-a`,
            `${prefix}missing-b`,
          );
          await other.cluster("SETSLOT", slot, "STABLE");
          for (const node of nodes)
            await node.cluster("SETSLOT", slot, "NODE", sourceId);
        }
      } finally {
        slowClient?.disconnect();
        routed.disconnect();
        bounded.disconnect();
        await Promise.all(nodes.map((node) => node.quit()));
      }
    }
  },
);
