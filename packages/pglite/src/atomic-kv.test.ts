// Cases and transaction statements must run sequentially on each owner.
/* oxlint-disable eslint/no-await-in-loop */
import {
  PGlite,
  MemoryFS,
  type PGliteInterface,
  type Transaction,
  type QueryOptions,
} from "@electric-sql/pglite";
import type { KvKey, KvStoreCasEntry } from "@fedify/fedify";
import { PgliteKvStore } from "@fedify/pglite/kv";
import { testAtomicKvStore } from "@fedify/testing";
import * as temporal from "@js-temporal/polyfill";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const Temporal = globalThis.Temporal ?? temporal.Temporal;
const randomName = (): string =>
  "atomic_" + crypto.randomUUID().replaceAll("-", "");

async function fixture(
  run: (pg: PGlite, store: PgliteKvStore, table: string) => Promise<void>,
): Promise<void> {
  const pg = new PGlite();
  const tableName = randomName();
  const store = new PgliteKvStore(pg, { tableName });
  try {
    await store.initialize();
    await run(pg, store, '"' + tableName + '"');
  } finally {
    await pg.close();
  }
}

async function physical(pg: PGlite, table: string): Promise<unknown[]> {
  return (
    await pg.query(
      "SELECT key, value, created::text AS created, ttl::text AS ttl FROM " +
        table +
        " ORDER BY key",
    )
  ).rows;
}

function code(expected: string): (error: unknown) => boolean {
  return (error) =>
    error instanceof Error && "code" in error && error.code === expected;
}

async function listed(
  store: PgliteKvStore,
  prefix?: KvKey,
): Promise<unknown[]> {
  const values: unknown[] = [];
  for await (const value of store.list(prefix)) values.push(value);
  return values;
}

test("PgliteKvStore conforms to AtomicKvStore on one shared owner", async () => {
  const pg = new PGlite();
  try {
    await testAtomicKvStore(
      async () => {
        const tableName = randomName();
        const first = new PgliteKvStore(pg, { tableName });
        await first.initialize();
        return {
          first,
          second: new PgliteKvStore(pg, { tableName, initialized: true }),
          dispose: () => first.drop(),
        };
      },
      { objectKeyOrder: "ignored" },
    );
  } finally {
    await pg.close();
  }
});

test("PgliteKvStore rolls back late writes, CAS, deletes and codec failures", () =>
  fixture(async (pg, store, table) => {
    const ttl = Temporal.Duration.from({ hours: 1 });
    await store.setMany([
      { key: ["a"], value: "before-a", options: { ttl } },
      { key: ["b"], value: "before-b", options: { ttl } },
    ]);
    const before = await physical(pg, table);
    await pg.exec(
      "ALTER TABLE " + table + " ADD CHECK (value <> '\"blocked\"'::jsonb)",
    );
    await assert.rejects(
      store.setMany([
        { key: ["a"], value: "after-a" },
        { key: ["b"], value: "blocked" },
      ]),
      code("23514"),
    );
    assert.deepStrictEqual(await physical(pg, table), before);
    await assert.rejects(
      store.casMany([
        { key: ["a"], expectedValue: "before-a", newValue: "after-a" },
        { key: ["b"], expectedValue: "before-b", newValue: "blocked" },
      ]),
      code("23514"),
    );
    assert.deepStrictEqual(await physical(pg, table), before);
    await assert.rejects(
      store.setMany([
        { key: ["a"], value: "after-a" },
        { key: ["b"], value: "\0" },
      ]),
    );
    assert.deepStrictEqual(await physical(pg, table), before);

    const functionName = randomName();
    try {
      await pg.exec(
        "CREATE FUNCTION " +
          functionName +
          "() RETURNS trigger LANGUAGE plpgsql AS $$ " +
          "BEGIN IF OLD.key = ARRAY['b'] THEN RAISE EXCEPTION 'injected delete failure'; END IF; RETURN OLD; END $$; " +
          "CREATE TRIGGER fail_delete BEFORE DELETE ON " +
          table +
          " FOR EACH ROW EXECUTE FUNCTION " +
          functionName +
          "()",
      );
      await assert.rejects(store.deleteMany([["a"], ["b"]]), code("P0001"));
      assert.deepStrictEqual(await physical(pg, table), before);
      await pg.exec("DROP TRIGGER fail_delete ON " + table);
    } finally {
      await pg.exec("DROP FUNCTION IF EXISTS " + functionName + "() CASCADE");
    }
    await store.set(["usable"], true);
    assert.strictEqual(await store.get(["usable"]), true);
  }));

test("PgliteKvStore preflights every CAS codec and TTL even after mismatch", () =>
  fixture(async (pg, store, table) => {
    await store.setMany([
      { key: ["a"], value: 1 },
      { key: ["b"], value: 2 },
    ]);
    const before = await physical(pg, table);
    const overflow = Temporal.Duration.from({ years: 300000 });
    const invalid: KvStoreCasEntry[] = [
      { key: ["b"], expectedValue: 2, newValue: "\0" },
      { key: ["b"], expectedValue: "\ud800", newValue: 3 },
      { key: ["b"], expectedValue: 2, newValue: 3, options: { ttl: overflow } },
      {
        key: ["b"],
        expectedValue: 2,
        newValue: undefined,
        options: { ttl: Temporal.Duration.from({ seconds: 1 }) },
      },
      {
        key: ["b"],
        expectedValue: 2,
        newValue: 3,
        options: { ttl: Temporal.Duration.from({ seconds: -1 }) },
      },
    ];
    for (const entry of invalid) {
      await assert.rejects(
        store.casMany([
          { key: ["a"], expectedValue: "wrong", newValue: 100 },
          entry,
        ]),
      );
      assert.deepStrictEqual(await physical(pg, table), before);
    }
    for (const write of [
      () => store.set(["overflow"], 1, { ttl: overflow }),
      () =>
        store.setMany([
          { key: ["overflow"], value: 1, options: { ttl: overflow } },
        ]),
      () => store.cas(["overflow"], undefined, 1, { ttl: overflow }),
      () =>
        store.casMany([
          {
            key: ["overflow"],
            expectedValue: undefined,
            newValue: 1,
            options: { ttl: overflow },
          },
        ]),
    ]) {
      await assert.rejects(write, code("22008"));
      assert.deepStrictEqual(await physical(pg, table), before);
    }
  }));

test("PgliteKvStore captures input and rejects malformed keys without aliases", () =>
  fixture(async (_pg, store) => {
    const key: [string] = ["captured"];
    const value = { nested: { value: 1 } };
    const write = store.setMany([{ key, value }]);
    key[0] = "mutated";
    value.nested.value = 2;
    await write;
    assert.deepStrictEqual(await store.get(["captured"]), {
      nested: { value: 1 },
    });
    assert.strictEqual(await store.get(["mutated"]), undefined);
    const readKey: [string] = ["captured"];
    const read = store.getMany([readKey]);
    readKey[0] = "mutated";
    assert.deepStrictEqual(await read, [{ nested: { value: 1 } }]);
    const replacement = { value: 3 };
    const change = store.cas(
      ["captured"],
      { nested: { value: 1 } },
      replacement,
    );
    replacement.value = 4;
    assert.strictEqual(await change, true);
    assert.deepStrictEqual(await store.get(["captured"]), { value: 3 });

    const invalidKeys = [
      [],
      ["\ud800"],
      ["\udc00"],
      ["a\0b"],
      ["a", null],
      new Array(2),
    ] as unknown as KvKey[];
    for (const bad of invalidKeys) {
      for (const operation of [
        () => store.get(bad),
        () => store.getMany([bad]),
        () => store.set(bad, 1),
        () => store.setMany([{ key: bad, value: 1 }]),
        () => store.delete(bad),
        () => store.deleteMany([bad]),
        () => store.cas(bad, undefined, 1),
        () =>
          store.casMany([
            { key: ["captured"], expectedValue: "wrong", newValue: 9 },
            { key: bad, expectedValue: undefined, newValue: 1 },
          ]),
      ])
        await assert.rejects(operation, TypeError);
      if (bad.length > 0) await assert.rejects(listed(store, bad), TypeError);
    }
    const keys: KvKey[] = [
      ["a", "b:c"],
      ["a:b", "c"],
      [""],
      ['"\\{}'],
      ["한😀"],
      ["\ufffd"],
    ];
    await store.setMany(keys.map((key, value) => ({ key, value })));
    assert.deepStrictEqual(
      await store.getMany(keys),
      keys.map((_, index) => index),
    );
    assert.deepStrictEqual(
      await listed(store, [] as unknown as KvKey),
      await listed(store),
    );
  }));

test("PgliteKvStore preserves large compressible keys and rolls back index failures", () =>
  fixture(async (pg, store, table) => {
    const large: KvKey = ["a".repeat(100000)];
    await store.set(large, 1);
    assert.strictEqual(await store.get(large), 1);
    assert.strictEqual(await store.cas(large, 1, 2), true);
    await store.setMany([{ key: large, value: 3 }]);
    assert.deepStrictEqual(await store.getMany([large]), [3]);
    assert.strictEqual(
      await store.casMany([{ key: large, expectedValue: 3, newValue: 4 }]),
      true,
    );
    await store.deleteMany([large]);
    await store.set(large, 5);
    await store.delete(large);
    assert.strictEqual(await store.get(large), undefined);

    const oversized: KvKey = [
      Array.from(crypto.getRandomValues(new Uint8Array(4096)), (x) =>
        x.toString(16).padStart(2, "0"),
      ).join(""),
    ];
    await store.set(["a"], "before", {
      ttl: Temporal.Duration.from({ hours: 1 }),
    });
    const before = await physical(pg, table);
    assert.strictEqual(
      await store.casMany([
        { key: ["a"], expectedValue: "wrong", newValue: "after" },
        { key: oversized, expectedValue: undefined, newValue: 1 },
      ]),
      false,
    );
    assert.deepStrictEqual(await physical(pg, table), before);
    await assert.rejects(
      store.setMany([
        { key: ["a"], value: "after" },
        { key: oversized, value: 1 },
      ]),
      code("54000"),
    );
    assert.deepStrictEqual(await physical(pg, table), before);
    await assert.rejects(
      store.casMany([
        { key: ["a"], expectedValue: "before", newValue: "after" },
        { key: oversized, expectedValue: undefined, newValue: 1 },
      ]),
      code("54000"),
    );
    assert.deepStrictEqual(await physical(pg, table), before);
  }));

test("PgliteKvStore handles interval rounding, exact expiry and legacy poison rows", () =>
  fixture(async (pg, store, table) => {
    await store.setMany([
      {
        key: ["half"],
        value: 1,
        options: { ttl: Temporal.Duration.from({ nanoseconds: 500 }) },
      },
      {
        key: ["up"],
        value: 1,
        options: { ttl: Temporal.Duration.from({ nanoseconds: 600 }) },
      },
      {
        key: ["month"],
        value: 1,
        options: { ttl: Temporal.Duration.from({ months: 1 }) },
      },
    ]);
    const intervals = await pg.query<{ key: KvKey; ttl: string }>(
      "SELECT key, ttl::text AS ttl FROM " + table + " ORDER BY key",
    );
    assert.deepStrictEqual(intervals.rows, [
      { key: ["half"], ttl: "00:00:00" },
      { key: ["month"], ttl: "1 mon" },
      { key: ["up"], ttl: "00:00:00.000001" },
    ]);
    assert.strictEqual(await store.get(["half"]), undefined);
    await pg.query(
      "INSERT INTO " +
        table +
        " (key,value,created,ttl) VALUES ($1::text[], '1', NULL, '1 day')",
      [["legacy-null"]],
    );
    assert.strictEqual(await store.get(["legacy-null"]), undefined);
    assert.strictEqual(await store.cas(["legacy-null"], undefined, 2), true);
    assert.strictEqual(await store.get(["legacy-null"]), 2);

    await pg.exec(
      "INSERT INTO " +
        table +
        " (key,value,ttl) VALUES (ARRAY['poison-a'], '1', '300000 years'), (ARRAY['poison-b'], '2', '300000 years')",
    );
    const before = await physical(pg, table);
    await assert.rejects(store.get(["poison-a"]), code("22008"));
    await assert.rejects(store.getMany([["poison-b"]]), code("22008"));
    await assert.rejects(store.set(["cleanup-failure"], 1), code("22008"));
    assert.deepStrictEqual(await physical(pg, table), before);
    await assert.rejects(store.delete(["poison-a"]), code("22008"));
    assert.deepStrictEqual(await physical(pg, table), before);
    await store.deleteMany([["poison-a"], ["poison-b"]]);
    await store.set(["recovered"], true);
    assert.strictEqual(await store.get(["recovered"]), true);
  }));

test("PgliteKvStore queues absent-key CAS, snapshots and ordinary writes behind the owner", () =>
  fixture(async (pg, store, table) => {
    const second = new PgliteKvStore(pg, {
      tableName: table.slice(1, -1),
      initialized: true,
    });
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transaction = pg.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO " + table + " (key,value) VALUES (ARRAY['a'],'1')",
      );
      enter();
      await gate;
      await tx.query(
        "INSERT INTO " +
          table +
          " (key,value) VALUES (ARRAY['b'],'1'), (ARRAY['absent'],'1')",
      );
    });
    await entered;
    let settled = false;
    const reads = store.getMany([["a"], ["b"]]);
    const condition = second.cas(["absent"], undefined, 2);
    const ordinary = second.set(["ordinary"], true);
    const pending = [reads, condition, ordinary];
    for (const operation of pending)
      void operation.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.strictEqual(settled, false);
    } finally {
      release();
      await Promise.allSettled([transaction, ...pending]);
    }
    await transaction;
    assert.deepStrictEqual(await reads, [1, 1]);
    assert.strictEqual(await condition, false);
    await ordinary;
    assert.strictEqual(await store.get(["ordinary"]), true);
  }));

function instrumentTransactions(
  pg: PGlite,
  before: (tx: Transaction) => Promise<void>,
  afterQuery: (tx: Transaction, sql: string) => Promise<void>,
): PGliteInterface {
  return {
    waitReady: pg.waitReady,
    query: pg.query.bind(pg),
    transaction: <T>(callback: (tx: Transaction) => Promise<T>): Promise<T> =>
      pg.transaction(async (tx) => {
        await before(tx);
        return await callback({
          ...tx,
          query: async <R>(
            sql: string,
            params?: Parameters<Transaction["query"]>[1],
            options?: QueryOptions,
          ) => {
            const result = await tx.query<R>(sql, params, options);
            await afterQuery(tx, sql);
            return result;
          },
        });
      }),
  } as PGliteInterface;
}

test("PgliteKvStore uses one expiry cutoff across delayed snapshot statements", () =>
  fixture(async (pg, store, table) => {
    let delayed = false;
    const observed = instrumentTransactions(
      pg,
      async (tx) => {
        await tx.query(
          "INSERT INTO " +
            table +
            " (key,value,created,ttl) VALUES " +
            "(ARRAY['a'],'1',CURRENT_TIMESTAMP,'50 milliseconds'), " +
            "(ARRAY['b'],'1',CURRENT_TIMESTAMP,'50 milliseconds'), " +
            "(ARRAY['boundary'],'1',CURRENT_TIMESTAMP,'0 seconds')",
        );
      },
      async (tx, sql) => {
        if (!delayed && sql.includes("SELECT value FROM")) {
          delayed = true;
          await tx.query("SELECT pg_sleep(0.1)");
        }
      },
    );
    const snapshot = new PgliteKvStore(observed, {
      tableName: table.slice(1, -1),
      initialized: true,
    });
    assert.deepStrictEqual(
      await snapshot.getMany([["a"], ["b"], ["a"], ["boundary"]]),
      [1, 1, 1, undefined],
    );
    assert.strictEqual(delayed, true);
    assert.deepStrictEqual(await store.getMany([["a"], ["b"]]), [
      undefined,
      undefined,
    ]);
  }));

test("PgliteKvStore batch changes and TTLs survive clean filesystem reopen", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "fedify-pglite-atomic-"));
  const tableName = randomName();
  let pg: PGlite | undefined;
  try {
    pg = new PGlite(dataDir);
    let store = new PgliteKvStore(pg, { tableName });
    await store.setMany([
      { key: ["a"], value: { version: 1 } },
      { key: ["b"], value: null },
      {
        key: ["ttl"],
        value: true,
        options: { ttl: Temporal.Duration.from({ days: 1 }) },
      },
    ]);
    assert.strictEqual(
      await store.casMany([
        { key: ["a"], expectedValue: { version: 1 }, newValue: { version: 2 } },
        { key: ["b"], expectedValue: null, newValue: undefined },
        { key: ["c"], expectedValue: undefined, newValue: "created" },
      ]),
      true,
    );
    await pg.close();
    pg = new PGlite(dataDir);
    store = new PgliteKvStore(pg, { tableName, initialized: true });
    assert.deepStrictEqual(
      await store.getMany([["a"], ["b"], ["c"], ["ttl"]]),
      [{ version: 2 }, undefined, "created", true],
    );
    const rows = await pg.query<{ ttl: string }>(
      'SELECT ttl::text AS ttl FROM "' + tableName + '" WHERE key = $1::text[]',
      [["ttl"]],
    );
    assert.strictEqual(rows.rows[0].ttl, "1 day");
    await store.drop();
  } finally {
    if (pg != null && !pg.closed) await pg.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("PgliteKvStore awaits post-commit filesystem sync and does not replay failures", async () => {
  class ObservedMemoryFS extends MemoryFS {
    onSync: () => Promise<void> = async () => {};
    override async syncToFs(): Promise<void> {
      await this.onSync();
    }
  }
  const fs = new ObservedMemoryFS();
  const pg = new PGlite({ fs, relaxedDurability: false });
  const store = new PgliteKvStore(pg, { tableName: randomName() });
  const events: string[] = [];
  const transaction = pg.transaction.bind(pg);
  pg.transaction = async <T>(
    callback: (tx: Transaction) => Promise<T>,
  ): Promise<T> => {
    const result = await transaction(callback);
    events.push("committed");
    return result;
  };
  try {
    await store.initialize();
    const operations = [
      () => store.set(["single"], 1),
      () => store.cas(["single"], 1, 2),
      () => store.delete(["single"]),
      () => store.setMany([{ key: ["batch"], value: 1 }]),
      () => store.casMany([{ key: ["batch"], expectedValue: 1, newValue: 2 }]),
      () => store.deleteMany([["batch"]]),
    ];
    for (const operation of operations) {
      events.length = 0;
      let release!: () => void;
      let enter!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      fs.onSync = async () => {
        // BEGIN also syncs in 0.5.8; only pause the sync after COMMIT.
        if (!events.includes("committed")) return;
        events.push("sync");
        enter();
        await gate;
      };
      let settled = false;
      const pending = operation().then(() => {
        settled = true;
      });
      try {
        // Also finish if the regression returns without a post-commit sync.
        await Promise.race([entered, pending]);
        assert.deepStrictEqual(events, ["committed", "sync"]);
        assert.strictEqual(settled, false);
      } finally {
        release();
        await pending;
        fs.onSync = async () => {};
      }
      assert.strictEqual(settled, true);
    }

    events.length = 0;
    const failure = new Error("filesystem synchronization failed");
    fs.onSync = () =>
      events.includes("committed")
        ? Promise.reject(failure)
        : Promise.resolve();
    await assert.rejects(
      store.set(["committed-despite-rejection"], 42),
      (error) => error === failure,
    );
    fs.onSync = async () => {};
    assert.deepStrictEqual(events, ["committed"]);
    assert.strictEqual(await store.get(["committed-despite-rejection"]), 42);
    await store.set(["connection-usable"], true);
    assert.strictEqual(await store.get(["connection-usable"]), true);
  } finally {
    fs.onSync = async () => {};
    await pg.close();
  }
});
