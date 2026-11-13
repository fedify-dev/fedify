// Database schedules, setup and disposal must run in order.
/* oxlint-disable eslint/no-await-in-loop */
// Proxy forwarding observes calls without changing the real client.
/* oxlint-disable anti-slop/no-reflect-apply */
import type { AtomicKvStore, KvKey } from "@fedify/fedify";
import { PostgresKvStore } from "@fedify/postgres/kv";
import { testAtomicKvStore, testKvStore } from "@fedify/testing";
import * as temporal from "@js-temporal/polyfill";
import assert from "node:assert/strict";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import postgres from "postgres";

const Temporal = globalThis.Temporal ?? temporal.Temporal;
const dbUrl = process.env.POSTGRES_URL;
const key = ["a"] as const;

function fixture(sql = postgres(dbUrl!, { max: 1 })) {
  const tableName = `fedify_atomic_${crypto.randomUUID().replaceAll("-", "")}`;
  const store = new PostgresKvStore(sql, { tableName });
  return {
    sql,
    tableName,
    store,
    async dispose() {
      try {
        await store.drop();
      } finally {
        await sql.end();
      }
    },
  };
}

function dbTest(name: string, run: () => Promise<void>): void {
  test(name, { skip: dbUrl == null, timeout: 30_000 }, async () => {
    if (dbUrl != null) await run(); // Bun ignores the skip option.
  });
}

async function state(sql: postgres.Sql, tableName: string) {
  return Array.from(
    await sql`
    SELECT key, value, created::text AS created, ttl::text AS ttl
    FROM ${sql(tableName)} ORDER BY key
  `,
  );
}

async function waiting(sql: postgres.Sql, pid: number): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt++) {
    const [row] = await sql`SELECT EXISTS (
      SELECT 1 FROM pg_locks WHERE pid = ${pid} AND NOT granted
    ) AS waiting`;
    if (row.waiting) return;
    await delay(10);
  }
  assert.fail("The competing operation did not wait for a database lock");
}

async function promptly<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Unexpected retained lock")),
          2000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

test(
  "PostgresKvStore atomic conformance with independent max:1 clients",
  {
    skip: dbUrl == null,
    timeout: 120_000,
  },
  async () => {
    if (dbUrl == null) return;
    await testAtomicKvStore(
      async () => {
        const f = fixture();
        const other = postgres(dbUrl, { max: 1 });
        try {
          await f.store.initialize();
          const second: AtomicKvStore = new PostgresKvStore(other, {
            tableName: f.tableName,
            initialized: true,
          });
          return {
            first: f.store,
            second,
            async dispose() {
              try {
                await f.dispose();
              } finally {
                await other.end();
              }
            },
          };
        } catch (error) {
          await f.dispose();
          await other.end();
          throw error;
        }
      },
      { objectKeyOrder: "ignored" },
    );
  },
);

dbTest("PostgresKvStore ordinary shared KV regression", async () => {
  const f = fixture();
  try {
    await testKvStore(
      () => f.store,
      () => {},
    );
  } finally {
    await f.dispose();
  }
});

dbTest(
  "PostgresKvStore snapshots input and normalizes its JSON codec",
  async () => {
    const f = fixture();
    try {
      const value = {
        nested: { a: 1, b: [null, true] },
        date: new Date("2026-01-01Z"),
      };
      const keys: [string, ...string[]] = ["one", "two"];
      const pending = f.store.setMany([
        { key: keys, value },
        { key, value: NaN },
      ]);
      keys[0] = "changed";
      value.nested.a = 99;
      await pending;
      assert.deepEqual(
        await f.store.getMany([["one", "two"], ["changed", "two"], key, key]),
        [
          {
            nested: { a: 1, b: [null, true] },
            date: "2026-01-01T00:00:00.000Z",
          },
          undefined,
          null,
          null,
        ],
      );
      assert.equal(await f.store.cas(key, Infinity, { b: 2, a: 1 }), true);
      assert.equal(
        await f.store.casMany([
          { key, expectedValue: { a: 1, b: 2 }, newValue: null },
        ]),
        true,
      );
      assert.equal(
        await f.store.casMany([{ key, expectedValue: null, newValue: [1, 2] }]),
        true,
      );
      assert.equal(await f.store.cas(key, [2, 1], "wrong"), false);
      for (const value of [undefined, 1n, () => 1, Symbol("invalid")]) {
        await assert.rejects(f.store.set(key, value), TypeError);
        if (value !== undefined)
          await assert.rejects(f.store.cas(key, value, 1), TypeError);
      }
      const cyclic: { self?: unknown } = {};
      cyclic.self = cyclic;
      await assert.rejects(
        f.store.setMany([
          { key, value: 1 },
          { key: ["later"], value: cyclic },
        ]),
      );
      assert.deepEqual(await f.store.get(key), [1, 2]);
    } finally {
      await f.dispose();
    }
  },
);

dbTest(
  "PostgresKvStore validates JSON and TTLs even on CAS mismatch",
  async () => {
    const f = fixture();
    try {
      await f.store.set(key, "old", {
        ttl: Temporal.Duration.from({ hours: 1 }),
      });
      const before = await state(f.sql, f.tableName);
      const ttl = Temporal.Duration.from({ years: 1_000_000 });
      for (const expectedValue of ["old", "wrong"]) {
        await assert.rejects(f.store.cas(key, expectedValue, "new", { ttl }));
        await assert.rejects(
          f.store.casMany([
            { key, expectedValue, newValue: "new" },
            {
              key: ["later"],
              expectedValue: undefined,
              newValue: 1,
              options: { ttl },
            },
          ]),
        );
        for (const newValue of ["\0", "\ud800"]) {
          await assert.rejects(f.store.cas(key, expectedValue, newValue));
          await assert.rejects(
            f.store.casMany([{ key, expectedValue, newValue }]),
          );
        }
      }
      await assert.rejects(f.store.set(key, "bad", { ttl }));
      await assert.rejects(f.store.set(["absent"], "bad", { ttl }));
      await assert.rejects(
        f.store.setMany([
          { key, value: "bad" },
          { key: ["later"], value: 1, options: { ttl } },
        ]),
      );
      assert.deepEqual(await state(f.sql, f.tableName), before);
    } finally {
      await f.dispose();
    }
  },
);

dbTest(
  "PostgresKvStore rejects sparse keys and batches before initialization",
  async () => {
    const f = fixture();
    try {
      const sparse = new Array<KvKey>(2);
      sparse[0] = key;
      await assert.rejects(f.store.getMany(sparse), TypeError);
      await assert.rejects(f.store.deleteMany(sparse), TypeError);
      await assert.rejects(
        f.store.getMany([new Array<string>(2) as unknown as KvKey]),
        TypeError,
      );
      await assert.rejects(
        f.store.setMany([
          { key, value: 1 },
          { key: ["a"], value: 2 },
        ]),
        TypeError,
      );
      await assert.rejects(
        f.store.casMany([
          { key, expectedValue: "mismatch", newValue: 1 },
          { key: ["a"], expectedValue: undefined, newValue: undefined },
        ]),
        TypeError,
      );
      await assert.rejects(
        f.store.cas(key, "wrong", undefined, {
          ttl: Temporal.Duration.from({ seconds: 1 }),
        }),
        TypeError,
      );
      const [table] =
        await f.sql`SELECT to_regclass(${f.tableName}) AS relation`;
      assert.equal(table.relation, null);
    } finally {
      await f.dispose();
    }
  },
);

for (const operation of ["deleteMany", "casMany"] as const) {
  dbTest(
    `PostgresKvStore.${operation} sees a writer committed during lock wait`,
    async () => {
      const f = fixture();
      const other = postgres(dbUrl!, { max: 1 });
      const observer = postgres(dbUrl!, { max: 1 });
      const ready = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let holder: Promise<unknown> | undefined;
      let pending: Promise<unknown> | undefined;
      try {
        await f.store.set(key, 0);
        const second = new PostgresKvStore(other, {
          tableName: f.tableName,
          initialized: true,
        });
        await second.initialize();
        const [{ pid }] = await other`SELECT pg_backend_pid() AS pid`;
        holder = f.sql.begin(async (sql) => {
          await sql`INSERT INTO ${sql(f.tableName)} (key, value, created)
          VALUES (ARRAY['a'], '1', statement_timestamp()), (ARRAY['b'], '1', statement_timestamp())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
          ready.resolve();
          await release.promise;
        });
        await ready.promise;
        pending =
          operation === "deleteMany"
            ? second.deleteMany([key, ["b"]])
            : second.casMany([
                { key, expectedValue: 1, newValue: 2 },
                { key: ["b"], expectedValue: 1, newValue: 2 },
              ]);
        await waiting(observer, pid);
        release.resolve();
        await holder;
        const result = await pending;
        if (operation === "casMany") assert.equal(result, true);
        assert.deepEqual(
          await f.store.getMany([key, ["b"]]),
          operation === "deleteMany" ? [undefined, undefined] : [2, 2],
        );
      } finally {
        release.resolve();
        await Promise.allSettled([holder, pending]);
        await f.dispose();
        await other.end();
        await observer.end();
      }
    },
  );
}

dbTest(
  "PostgresKvStore.casMany uses post-lock expiry and one TTL origin",
  async () => {
    const f = fixture();
    const other = postgres(dbUrl!, { max: 1 });
    const observer = postgres(dbUrl!, { max: 1 });
    const ready = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let holder: Promise<unknown> | undefined;
    let pending: Promise<boolean> | undefined;
    try {
      await f.store.initialize();
      await f.sql`INSERT INTO ${f.sql(f.tableName)} (key,value,created,ttl)
      VALUES (ARRAY['a'],'0',statement_timestamp(),interval '150 milliseconds')`;
      const second = new PostgresKvStore(other, {
        tableName: f.tableName,
        initialized: true,
      });
      await second.initialize();
      const [{ pid }] = await other`SELECT pg_backend_pid() AS pid`;
      holder = f.sql.begin(async (sql) => {
        await sql`LOCK TABLE ${sql(f.tableName)} IN ROW EXCLUSIVE MODE`;
        ready.resolve();
        await release.promise;
      });
      await ready.promise;
      pending = second.casMany([
        {
          key,
          expectedValue: undefined,
          newValue: 1,
          options: { ttl: Temporal.Duration.from({ seconds: 5 }) },
        },
        {
          key: ["b"],
          expectedValue: undefined,
          newValue: 1,
          options: { ttl: Temporal.Duration.from({ seconds: 5 }) },
        },
      ]);
      await waiting(observer, pid);
      await observer`SELECT pg_sleep(0.2)`; // Let the locked value expire, after observing the wait.
      release.resolve();
      await holder;
      assert.equal(await pending, true);
      const [row] = await f.sql`SELECT count(DISTINCT created)::int AS origins,
      bool_and(created + ttl > statement_timestamp()) AS live FROM ${f.sql(f.tableName)}`;
      assert.equal(row.origins, 1);
      assert.equal(row.live, true);
    } finally {
      release.resolve();
      await Promise.allSettled([holder, pending]);
      await f.dispose();
      await other.end();
      await observer.end();
    }
  },
);

dbTest(
  "PostgresKvStore crossed setMany batches use stable key order",
  async () => {
    const f = fixture();
    const other = postgres(dbUrl!, { max: 1 });
    try {
      await f.store.initialize();
      const second = new PostgresKvStore(other, {
        tableName: f.tableName,
        initialized: true,
      });
      for (let round = 0; round < 8; round++) {
        await Promise.all([
          f.store.setMany([
            { key, value: 1 },
            { key: ["b"], value: 1 },
          ]),
          second.setMany([
            { key: ["b"], value: 2 },
            { key, value: 2 },
          ]),
        ]);
        const [a, b] = await f.store.getMany([key, ["b"]]);
        assert.equal(a, b);
        assert.ok(a === 1 || a === 2);
      }
    } finally {
      await f.dispose();
      await other.end();
    }
  },
);

dbTest(
  "PostgresKvStore later trigger failure rolls back values and TTLs",
  async () => {
    const f = fixture();
    const functionName = `${f.tableName}_fail`;
    try {
      await f.store.setMany([
        {
          key,
          value: 1,
          options: { ttl: Temporal.Duration.from({ hours: 1 }) },
        },
        { key: ["keep"], value: 2 },
      ]);
      await f.sql`CREATE FUNCTION ${f.sql(functionName)}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.key[1] = 'fail' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$`;
      await f.sql`CREATE TRIGGER failure BEFORE INSERT OR UPDATE ON ${f.sql(f.tableName)}
      FOR EACH ROW EXECUTE FUNCTION ${f.sql(functionName)}()`;
      const before = await state(f.sql, f.tableName);
      const entries = [
        { key, expectedValue: 1, newValue: undefined },
        { key: ["fail"] as const, expectedValue: undefined, newValue: 3 },
      ];
      await assert.rejects(f.store.casMany(entries), /injected failure/);
      assert.deepEqual(await state(f.sql, f.tableName), before);
      await f.sql.begin(async (sql) => {
        const store = new PostgresKvStore(sql, {
          tableName: f.tableName,
          initialized: true,
        });
        await sql`INSERT INTO ${sql(f.tableName)} (key,value,created) VALUES (ARRAY['prior'],'9',statement_timestamp())`;
        await assert.rejects(store.casMany(entries), /injected failure/);
        assert.equal((await sql`SELECT 1 AS one`)[0].one, 1);
        assert.equal(await store.get(["prior"]), 9);
        assert.equal(await store.get(key), 1);
      });
      assert.equal(await f.store.get(["prior"]), 9);
      await assert.rejects(
        f.store.setMany([
          { key, value: 7 },
          { key: ["fail"], value: 3 },
        ]),
        /injected failure/,
      );
      assert.equal(await f.store.get(key), 1);
    } finally {
      await f.sql`DROP FUNCTION IF EXISTS ${f.sql(functionName)}() CASCADE`;
      await f.dispose();
    }
  },
);

dbTest(
  "PostgresKvStore sequential caller batches preserve outer rollback and release mismatch locks",
  async () => {
    const f = fixture();
    const other = postgres(dbUrl!, { max: 1 });
    const rollback = new Error("outer rollback");
    try {
      await f.store.setMany([
        { key, value: 1 },
        { key: ["b"], value: 1 },
      ]);
      const second = new PostgresKvStore(other, {
        tableName: f.tableName,
        initialized: true,
      });
      await second.initialize();
      await assert.rejects(
        f.sql.begin(async (sql) => {
          const store = new PostgresKvStore(sql, {
            tableName: f.tableName,
            initialized: true,
          });
          assert.equal(
            await store.casMany([{ key, expectedValue: 0, newValue: 2 }]),
            false,
          );
          await promptly(second.set(["free"], 3));
          assert.equal(
            await store.casMany([{ key, expectedValue: 1, newValue: 2 }]),
            true,
          );
          await store.deleteMany([key, ["b"]]);
          assert.deepEqual(await store.getMany([key, ["b"]]), [
            undefined,
            undefined,
          ]);
          throw rollback;
        }),
        (error) => error === rollback,
      );
      assert.deepEqual(
        await f.store.getMany([key, ["b"], ["free"]]),
        [1, 1, 3],
      );
    } finally {
      await f.dispose();
      await other.end();
    }
  },
);

dbTest(
  "PostgresKvStore lazy caller initialization survives mismatch rollback",
  async () => {
    const f = fixture();
    try {
      await f.sql.begin(async (sql) => {
        const store = new PostgresKvStore(sql, { tableName: f.tableName });
        assert.equal(
          await store.casMany([{ key, expectedValue: "wrong", newValue: 1 }]),
          false,
        );
        await store.set(key, "committed");
      });
      assert.equal(await f.store.get(key), "committed");
    } finally {
      await f.dispose();
    }
  },
);

dbTest(
  "PostgresKvStore batch reads reuse existing tables in read-only transactions",
  async () => {
    const f = fixture();
    try {
      await f.store.setMany([{ key, value: "existing" }]);
      await f.sql.begin("read only", async (sql) => {
        const store = new PostgresKvStore(sql, { tableName: f.tableName });
        for (let attempt = 0; attempt < 2; attempt++) {
          assert.deepEqual(await store.getMany([key, ["missing"]]), [
            "existing",
            undefined,
          ]);
        }
        assert.equal((await sql`SELECT 1 AS healthy`)[0].healthy, 1);
      });
      const reserved = await f.sql.reserve();
      try {
        await reserved`BEGIN READ ONLY`;
        const store = new PostgresKvStore(reserved, { tableName: f.tableName });
        assert.deepEqual(await store.getMany([key]), ["existing"]);
        assert.equal((await reserved`SELECT 1 AS healthy`)[0].healthy, 1);
      } finally {
        await reserved`ROLLBACK`;
        reserved.release();
      }
    } finally {
      await f.dispose();
    }
  },
);

dbTest(
  "PostgresKvStore reserved batch initialization refreshes after rollback and failure",
  async () => {
    const f = fixture();
    const reserved = await f.sql.reserve();
    try {
      const store = new PostgresKvStore(reserved, { tableName: f.tableName });
      await reserved`BEGIN`;
      await store.setMany([{ key, value: "rolled back" }]);
      await reserved`ROLLBACK`;
      await reserved`BEGIN READ ONLY`;
      await assert.rejects(store.setMany([{ key, value: "must reject" }]));
      await reserved`ROLLBACK`;
      assert.deepEqual(await store.getMany([key]), [undefined]);
      await store.setMany([{ key, value: "recovered" }]);
      assert.deepEqual(await store.getMany([key]), ["recovered"]);
    } finally {
      await reserved`ROLLBACK`;
      reserved.release();
      await f.dispose();
    }
  },
);

dbTest(
  "PostgresKvStore reserved restrictions reject before SQL and preserve caller transaction",
  async () => {
    const f = fixture();
    await f.store.initialize();
    const reserved = await f.sql.reserve();
    try {
      for (const transaction of [false, true]) {
        if (transaction) await reserved`BEGIN`;
        let calls = 0;
        const observed = new Proxy(reserved, {
          apply(target, receiver, args) {
            calls++;
            return Reflect.apply(target, receiver, args);
          },
        });
        const store = new PostgresKvStore(observed, {
          tableName: f.tableName,
          initialized: true,
        });
        await assert.rejects(
          store.casMany([{ key, expectedValue: undefined, newValue: 1 }]),
          TypeError,
        );
        await assert.rejects(store.deleteMany([key, ["b"]]), TypeError);
        assert.deepEqual(await store.getMany([]), []);
        await store.setMany([]);
        await store.deleteMany([]);
        assert.equal(await store.casMany([]), true);
        assert.equal(calls, 0);
        await store.setMany([{ key, value: 1 }]);
        await store.deleteMany([key]);
        assert.deepEqual(await store.getMany([key]), [undefined]);
        assert.equal((await reserved`SELECT 1 AS one`)[0].one, 1);
        if (transaction) await reserved`COMMIT`;
      }
    } finally {
      await reserved`ROLLBACK`;
      reserved.release();
      await f.dispose();
    }
  },
);

for (const isolation of ["repeatable read", "serializable"]) {
  dbTest(
    `PostgresKvStore rejects caller ${isolation} atomic mutation scope`,
    async () => {
      const f = fixture();
      try {
        await f.store.set(key, 1);
        await f.sql.begin(`isolation level ${isolation}`, async (sql) => {
          const store = new PostgresKvStore(sql, {
            tableName: f.tableName,
            initialized: true,
          });
          await assert.rejects(
            store.casMany([{ key, expectedValue: 1, newValue: 2 }]),
            TypeError,
          );
          await assert.rejects(store.deleteMany([key, ["b"]]), TypeError);
          assert.equal((await sql`SELECT 1 AS one`)[0].one, 1);
        });
        assert.equal(await f.store.get(key), 1);
      } finally {
        await f.dispose();
      }
    },
  );
}

for (const identity of [false, true]) {
  dbTest(
    `PostgresKvStore batch codec with identity JSON serializer=${identity} and non-ISO DateStyle`,
    async () => {
      const sql = identity
        ? postgres(dbUrl!, {
            max: 1,
            connection: { DateStyle: "SQL, DMY", TimeZone: "Australia/Sydney" },
            types: {
              json: {
                to: 3802,
                from: [114, 3802],
                serialize: (value: unknown) => value as string,
                parse: JSON.parse,
              },
            },
          })
        : postgres(dbUrl!, {
            max: 1,
            connection: { DateStyle: "SQL, DMY", TimeZone: "Australia/Sydney" },
          });
      const f = fixture(sql);
      try {
        await f.store.initialize();
        const store = new PostgresKvStore(sql, {
          tableName: f.tableName,
          initialized: true,
        });
        await store.setMany([
          { key, value: null },
          { key: ["b"], value: { nested: [null, 1] } },
        ]);
        assert.equal(
          await store.casMany([
            {
              key,
              expectedValue: null,
              newValue: { a: 1 },
              options: {
                ttl: Temporal.Duration.from({ seconds: 60, microseconds: 1 }),
              },
            },
            {
              key: ["b"],
              expectedValue: { nested: [null, 1] },
              newValue: null,
            },
          ]),
          true,
        );
        assert.deepEqual(await store.getMany([key, ["b"]]), [{ a: 1 }, null]);
        const [row] = await sql`SELECT count(DISTINCT created)::int AS origins,
        bool_and(ttl IS NULL OR ttl = interval '60.000001 seconds') AS precision FROM ${sql(f.tableName)}`;
        assert.equal(row.origins, 1);
        assert.equal(row.precision, true);
        assert.equal(await store.cas(key, { a: 1 }, null), true);
        assert.equal(await store.get(key), null);
      } finally {
        await f.dispose();
      }
    },
  );
}
for (const membership of ["parent", "child"]) {
  dbTest(
    `PostgresKvStore rejects ordinary inheritance ${membership} batches`,
    async () => {
      const f = fixture();
      const child = `${f.tableName}_child`;
      try {
        await f.store.initialize();
        await f.sql`CREATE TABLE ${f.sql(child)} () INHERITS (${f.sql(f.tableName)})`;
        await f.sql`INSERT INTO ${f.sql(child)} (key,value,created) VALUES (ARRAY['a'],'1',statement_timestamp())`;
        const store = new PostgresKvStore(f.sql, {
          tableName: membership === "parent" ? f.tableName : child,
          initialized: true,
        });
        await assert.rejects(store.getMany([key]), TypeError);
        await assert.rejects(store.setMany([{ key: ["absent"], value: 2 }]));
        await assert.rejects(store.deleteMany([key]), TypeError);
        await assert.rejects(store.deleteMany([key, ["absent"]]), TypeError);
        await assert.rejects(
          store.casMany([{ key, expectedValue: 1, newValue: 2 }]),
          TypeError,
        );
        await f.sql`INSERT INTO ${f.sql(f.tableName)} (key,value,created) VALUES (ARRAY['a'],'3',statement_timestamp())`;
        await assert.rejects(store.getMany([key, key]), TypeError);
        assert.equal(
          (
            await f.sql`SELECT count(*)::int AS size FROM ${f.sql(f.tableName)}`
          )[0].size,
          2,
        );
      } finally {
        await f.sql`DROP TABLE IF EXISTS ${f.sql(child)}`;
        await f.dispose();
      }
    },
  );
}

dbTest(
  "PostgresKvStore declarative parent and leaf batches coordinate direct partition writes",
  async () => {
    const f = fixture();
    const child = `${f.tableName}_part`;
    const other = postgres(dbUrl!, { max: 1 });
    const observer = postgres(dbUrl!, { max: 1 });
    const ready = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let holder: Promise<unknown> | undefined;
    let pending: Promise<boolean> | undefined;
    try {
      await f.sql`CREATE TABLE ${f.sql(f.tableName)} (
      key text[] PRIMARY KEY,value jsonb NOT NULL,created timestamptz,ttl interval
    ) PARTITION BY HASH (key)`;
      await f.sql`CREATE TABLE ${f.sql(child)} PARTITION OF ${f.sql(f.tableName)} FOR VALUES WITH (MODULUS 1, REMAINDER 0)`;
      const parent = new PostgresKvStore(other, {
        tableName: f.tableName,
        initialized: true,
      });
      const leaf = new PostgresKvStore(f.sql, {
        tableName: child,
        initialized: true,
      });
      await leaf.setMany([
        { key, value: 0 },
        { key: ["b"], value: 0 },
      ]);
      assert.deepEqual(await parent.getMany([key, ["b"]]), [0, 0]);
      const [{ pid }] = await other`SELECT pg_backend_pid() AS pid`;
      holder = f.sql.begin(async (sql) => {
        await sql`UPDATE ${sql(child)} SET value = '1' WHERE key = ARRAY['a']`;
        ready.resolve();
        await release.promise;
      });
      await ready.promise;
      pending = parent.casMany([
        { key, expectedValue: 1, newValue: 2 },
        { key: ["b"], expectedValue: 0, newValue: 2 },
      ]);
      await waiting(observer, pid);
      release.resolve();
      await holder;
      assert.equal(await pending, true);
      assert.equal(
        await leaf.casMany([{ key, expectedValue: 2, newValue: 3 }]),
        true,
      );
      await leaf.deleteMany([key, ["b"]]);
      assert.deepEqual(await parent.getMany([key, ["b"]]), [
        undefined,
        undefined,
      ]);
    } finally {
      release.resolve();
      await Promise.allSettled([holder, pending]);
      await f.sql`DROP TABLE IF EXISTS ${f.sql(child)}`;
      await f.dispose();
      await other.end();
      await observer.end();
    }
  },
);

dbTest(
  "PostgresKvStore lock timeout is an error and preserves state",
  async () => {
    const f = fixture();
    const other = postgres(dbUrl!, {
      max: 1,
      connection: { lock_timeout: 100 },
    });
    const ready = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let holder: Promise<unknown> | undefined;
    try {
      await f.store.setMany([
        { key, value: 1 },
        { key: ["b"], value: 1 },
      ]);
      const second = new PostgresKvStore(other, {
        tableName: f.tableName,
        initialized: true,
      });
      holder = f.sql.begin(async (sql) => {
        await sql`LOCK TABLE ${sql(f.tableName)} IN ROW EXCLUSIVE MODE`;
        ready.resolve();
        await release.promise;
      });
      await ready.promise;
      await assert.rejects(
        second.casMany([{ key, expectedValue: 1, newValue: 2 }]),
        (error: unknown) =>
          error instanceof postgres.PostgresError && error.code === "55P03",
      );
      await assert.rejects(
        second.deleteMany([key, ["b"]]),
        (error: unknown) =>
          error instanceof postgres.PostgresError && error.code === "55P03",
      );
      release.resolve();
      await holder;
      assert.deepEqual(await f.store.getMany([key, ["b"]]), [1, 1]);
    } finally {
      release.resolve();
      await Promise.allSettled([holder]);
      await f.dispose();
      await other.end();
    }
  },
);

dbTest(
  "PostgresKvStore caller lock-upgrade deadlock rejects without a partial batch",
  async () => {
    const f = fixture();
    const other = postgres(dbUrl!, { max: 1 });
    const entered = Promise.withResolvers<void>();
    let writers = 0;
    try {
      await f.store.setMany([
        { key, value: 0 },
        { key: ["b"], value: 0 },
      ]);
      const attempt = (client: postgres.Sql, name: string) =>
        client.begin(async (sql) => {
          await sql`INSERT INTO ${sql(f.tableName)} (key,value,created) VALUES (${[name]},'9',statement_timestamp())`;
          if (++writers === 2) entered.resolve();
          await entered.promise;
          const store = new PostgresKvStore(sql, {
            tableName: f.tableName,
            initialized: true,
          });
          try {
            assert.equal(
              await store.casMany([
                { key, expectedValue: 0, newValue: 1 },
                { key: ["b"], expectedValue: 0, newValue: 1 },
              ]),
              true,
            );
          } catch (error) {
            assert.equal((await sql`SELECT 1 AS one`)[0].one, 1);
            throw error; // Release earlier ROW EXCLUSIVE locks with outer rollback.
          }
        });
      const results = await Promise.allSettled([
        attempt(f.sql, "left"),
        attempt(other, "right"),
      ]);
      const failures = results.filter((result) => result.status === "rejected");
      assert.equal(failures.length, 1);
      assert.ok(failures[0].reason instanceof postgres.PostgresError);
      assert.equal(failures[0].reason.code, "40P01");
      assert.deepEqual(await f.store.getMany([key, ["b"]]), [1, 1]);
      const markers = await f.store.getMany([["left"], ["right"]]);
      assert.equal(markers.filter((value) => value === 9).length, 1);
    } finally {
      await f.dispose();
      await other.end();
    }
  },
);

dbTest(
  "PostgresKvStore backend index limit rejects attempted mutation but not mismatch",
  async () => {
    const f = fixture();
    // Incompressible text exceeds the default B-tree entry size; no adapter cap.
    const oversized = [
      Array.from({ length: 400 }, () => crypto.randomUUID()).join(""),
    ] as const;
    try {
      await f.store.set(key, 1);
      assert.equal(
        await f.store.casMany([
          { key, expectedValue: "wrong", newValue: undefined },
          { key: oversized, expectedValue: undefined, newValue: 2 },
        ]),
        false,
      );
      await assert.rejects(
        f.store.casMany([
          { key, expectedValue: 1, newValue: undefined },
          { key: oversized, expectedValue: undefined, newValue: 2 },
        ]),
      );
      assert.deepEqual(await f.store.getMany([key, oversized]), [1, undefined]);
    } finally {
      await f.dispose();
    }
  },
);

dbTest(
  "PostgresKvStore qualified transformed identifiers preserve scalar atomic values",
  async () => {
    const sql = postgres(dbUrl!, { max: 1, transform: postgres.camel });
    const suffix = crypto.randomUUID().replaceAll("-", "");
    const schema = `AtomicSchema${suffix}`;
    const tableName = `${schema}.AtomicValues`;
    const store = new PostgresKvStore(sql, { tableName });
    try {
      await sql`CREATE SCHEMA ${sql(schema)}`;
      await store.setMany([
        { key, value: null },
        { key: ["b"], value: 1 },
      ]);
      assert.equal(
        await store.casMany([{ key, expectedValue: null, newValue: 2 }]),
        true,
      );
      assert.deepEqual(await store.getMany([key, ["b"], key]), [2, 1, 2]);
      await store.deleteMany([key, ["b"]]);
    } finally {
      await store.drop();
      await sql`DROP SCHEMA IF EXISTS ${sql(schema)}`;
      await sql.end();
    }
  },
);

dbTest(
  "PostgresKvStore single CAS liveness and TTL origin follow its final statement",
  async () => {
    const f = fixture();
    const validated = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let pending: Promise<boolean> | undefined;
    try {
      await f.store.initialize();
      await f.sql`INSERT INTO ${f.sql(f.tableName)} (key,value,created,ttl)
      VALUES (ARRAY['a'],'0',statement_timestamp(),interval '300 milliseconds')`;
      const observed = new Proxy(f.sql, {
        apply(target, receiver, args) {
          const query = args[0];
          const result = Reflect.apply(target, receiver, args);
          if (
            Array.isArray(query) &&
            query.join("").includes("count((item->>'ttl')::interval)")
          ) {
            return (async () => {
              const rows = await result;
              validated.resolve();
              await release.promise;
              return rows;
            })();
          }
          return result;
        },
      });
      const store = new PostgresKvStore(observed, {
        tableName: f.tableName,
        initialized: true,
      });
      pending = store.cas(key, undefined, "fresh", {
        ttl: Temporal.Duration.from({ seconds: 5 }),
      });
      await validated.promise;
      const [{ marker }] =
        await f.sql`SELECT statement_timestamp()::text AS marker`;
      await f.sql`SELECT pg_sleep(0.35)`;
      release.resolve();
      assert.equal(await pending, true);
      const [row] =
        await f.sql`SELECT value, created > ${marker}::text::timestamptz AS fresh,
      created + ttl > statement_timestamp() AS live FROM ${f.sql(f.tableName)}`;
      assert.equal(row.value, "fresh");
      assert.equal(row.fresh, true);
      assert.equal(row.live, true);
    } finally {
      release.resolve();
      await Promise.allSettled([pending]);
      await f.dispose();
    }
  },
);

dbTest(
  "PostgresKvStore pooled batches reclaim expired rows after commit",
  async () => {
    const f = fixture();
    const swept = Promise.withResolvers<void>();
    try {
      await f.store.initialize();
      await f.sql`INSERT INTO ${f.sql(f.tableName)} (key,value,created,ttl)
      VALUES (ARRAY['expired'],'0',statement_timestamp()-interval '1 hour',interval '1 second')`;
      const observed = new Proxy(f.sql, {
        apply(target, receiver, args) {
          const query = args[0];
          const result = Reflect.apply(target, receiver, args);
          if (
            Array.isArray(query) &&
            query.join("").includes("WITH sweep_lock")
          ) {
            return (async () => {
              const rows = await result;
              swept.resolve();
              return rows;
            })();
          }
          return result;
        },
      });
      const store = new PostgresKvStore(observed, {
        tableName: f.tableName,
        initialized: true,
      });
      await store.setMany([{ key, value: 1 }]);
      await promptly(swept.promise);
      const [row] =
        await f.sql`SELECT count(*)::int AS size FROM ${f.sql(f.tableName)} WHERE key=ARRAY['expired']`;
      assert.equal(row.size, 0);
    } finally {
      await f.dispose();
    }
  },
);

dbTest(
  "PostgresKvStore pooled cleanup failure cannot reject a committed batch and drop drains it",
  async () => {
    const f = fixture();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let dropping: Promise<void> | undefined;
    try {
      await f.store.initialize();
      const observed = new Proxy(f.sql, {
        apply(target, receiver, args) {
          const query = args[0];
          if (
            Array.isArray(query) &&
            query.join("").includes("WITH sweep_lock")
          ) {
            started.resolve();
            return release.promise.then(() => {
              throw new Error("injected cleanup failure");
            });
          }
          return Reflect.apply(target, receiver, args);
        },
      });
      const store = new PostgresKvStore(observed, {
        tableName: f.tableName,
        initialized: true,
      });
      await promptly(
        store.casMany([{ key, expectedValue: undefined, newValue: 1 }]),
      );
      await started.promise;
      assert.equal(await f.store.get(key), 1);
      let dropped = false;
      dropping = store.drop().then(() => {
        dropped = true;
      });
      await f.sql`SELECT 1`;
      assert.equal(dropped, false);
      release.resolve();
      await dropping;
      assert.equal(dropped, true);
    } finally {
      release.resolve();
      await dropping;
      await f.dispose();
    }
  },
);

dbTest(
  "PostgresKvStore single and batch CAS recover logically absent legacy rows",
  async () => {
    const f = fixture();
    try {
      await f.store.initialize();
      await f.sql`INSERT INTO ${f.sql(f.tableName)} (key,value,created,ttl)
      VALUES (ARRAY['a'],'1',NULL,interval '1 day'),(ARRAY['b'],'1',NULL,interval '1 day')`;
      assert.deepEqual(await f.store.getMany([key, ["b"]]), [
        undefined,
        undefined,
      ]);
      assert.equal(await f.store.cas(key, undefined, "single"), true);
      assert.equal(
        await f.store.casMany([
          { key: ["b"], expectedValue: undefined, newValue: "batch" },
        ]),
        true,
      );
      assert.deepEqual(await f.store.getMany([key, ["b"]]), [
        "single",
        "batch",
      ]);
    } finally {
      await f.dispose();
    }
  },
);

dbTest(
  "PostgresKvStore zero TTL expires and negative Temporal TTL rejects atomically",
  async () => {
    const f = fixture();
    try {
      await f.store.set(key, "old", {
        ttl: Temporal.Duration.from({ hours: 1 }),
      });
      const before = await state(f.sql, f.tableName);
      const options = { ttl: Temporal.Duration.from({ seconds: -1 }) };
      await assert.rejects(f.store.set(key, "negative", options));
      await assert.rejects(
        f.store.setMany([
          { key, value: "changed" },
          { key: ["negative"], value: 1, options },
        ]),
      );
      for (const expectedValue of ["old", "mismatch"]) {
        await assert.rejects(
          f.store.cas(key, expectedValue, "negative", options),
        );
        await assert.rejects(
          f.store.casMany([
            { key, expectedValue, newValue: "changed" },
            {
              key: ["negative"],
              expectedValue: undefined,
              newValue: 1,
              options,
            },
          ]),
        );
      }
      assert.deepEqual(await state(f.sql, f.tableName), before);
      const zero = { ttl: Temporal.Duration.from({ seconds: 0 }) };
      await f.store.set(["zero-single"], 1, zero);
      await f.store.setMany([{ key: ["zero-batch"], value: 1, options: zero }]);
      assert.equal(await f.store.cas(["zero-cas"], undefined, 1, zero), true);
      assert.equal(
        await f.store.casMany([
          {
            key: ["zero-cas-batch"],
            expectedValue: undefined,
            newValue: 1,
            options: zero,
          },
        ]),
        true,
      );
      assert.deepEqual(
        await f.store.getMany([
          ["zero-single"],
          ["zero-batch"],
          ["zero-cas"],
          ["zero-cas-batch"],
        ]),
        [undefined, undefined, undefined, undefined],
      );
    } finally {
      await f.dispose();
    }
  },
);

dbTest(
  "PostgresKvStore transformed table probes match DDL and read-only reads",
  async () => {
    const sql = postgres(dbUrl!, { max: 1, transform: postgres.camel });
    const admin = postgres(dbUrl!, { max: 1 });
    const tableName = `atomicValues${crypto.randomUUID().replaceAll("-", "")}`;
    const actual = tableName.replace("atomicValues", "atomic_values");
    const store = new PostgresKvStore(sql, { tableName });
    try {
      await sql`CREATE UNLOGGED TABLE ${sql(tableName)} (
      key text[] PRIMARY KEY, value jsonb NOT NULL,
      created timestamptz DEFAULT CURRENT_TIMESTAMP, ttl interval
    )`;
      await store.initialize();
      const [relation] = await admin`SELECT relpersistence FROM pg_class
      WHERE oid = to_regclass(${`"${actual}"`})`;
      assert.equal(relation.relpersistence, "p");
      await store.setMany([{ key, value: "existing" }]);
      await sql.begin("read only", async (transaction) => {
        const reader = new PostgresKvStore(transaction, { tableName });
        assert.deepEqual(await reader.getMany([key]), ["existing"]);
      });
    } finally {
      await store.drop();
      await sql.end();
      await admin.end();
    }
  },
);

dbTest(
  "PostgresKvStore transformed initialization ignores a raw-name collision",
  async () => {
    const admin = postgres(dbUrl!, { max: 1 });
    const tableName = `atomic_${crypto.randomUUID().replaceAll("-", "")}`;
    const sql = postgres(dbUrl!, {
      max: 1,
      transform: { column: { to: (name) => `x_${name}` } },
    });
    const store = new PostgresKvStore(sql, { tableName });
    try {
      await admin`CREATE TABLE ${admin(tableName)} (key text[] PRIMARY KEY, value jsonb NOT NULL,
      created timestamptz DEFAULT CURRENT_TIMESTAMP, ttl interval)`;
      await store.setMany([{ key, value: "transformed" }]);
      assert.deepEqual(await store.getMany([key]), ["transformed"]);
      assert.equal(
        (await admin`SELECT count(*)::int AS size FROM ${admin(tableName)}`)[0]
          .size,
        0,
      );
    } finally {
      await store.drop();
      await admin`DROP TABLE IF EXISTS ${admin(tableName)}`;
      await sql.end();
      await admin.end();
    }
  },
);

dbTest(
  "PostgresKvStore table names cannot be shadowed by atomic CTEs",
  async () => {
    const sql = postgres(dbUrl!, { max: 1 });
    const schema = `atomic_names_${crypto.randomUUID().replaceAll("-", "")}`;
    try {
      await sql`CREATE SCHEMA ${sql(schema)}`;
      await sql`SET search_path TO ${sql(schema)}`;
      for (const tableName of [
        "input",
        "support",
        "written",
        "deleted",
        "targets",
      ]) {
        const store = new PostgresKvStore(sql, { tableName });
        try {
          await store.setMany([
            { key, value: 1 },
            { key: ["b"], value: 2 },
          ]);
          assert.deepEqual(await store.getMany([key, ["b"]]), [1, 2]);
          assert.equal(
            await store.casMany([
              { key, expectedValue: 1, newValue: undefined },
              { key: ["b"], expectedValue: 2, newValue: 3 },
            ]),
            true,
          );
          assert.deepEqual(await store.getMany([key, ["b"]]), [undefined, 3]);
          await store.deleteMany([key, ["b"]]);
          assert.deepEqual(await store.getMany([key, ["b"]]), [
            undefined,
            undefined,
          ]);
        } finally {
          await store.drop();
        }
      }
    } finally {
      await sql`RESET search_path`;
      await sql`DROP SCHEMA IF EXISTS ${sql(schema)} CASCADE`;
      await sql.end();
    }
  },
);

for (const [operation, client] of [
  ["insert", "pool"],
  ["update", "pool"],
  ["delete", "pool"],
  ["cas-delete", "pool"],
  ["cas-update", "pool"],
  ["insert", "reserved"],
  ["cas-update", "transaction"],
] as const) {
  dbTest(
    `PostgresKvStore rolls back skipped ${operation} rows on a ${client} client`,
    async () => {
      const f = fixture();
      const audit = `${f.tableName}_audit`;
      const fn = `${f.tableName}_filter`;
      let reserved: postgres.ReservedSql | undefined;
      try {
        await f.store.initialize();
        if (operation !== "insert") {
          await f.store.setMany([
            { key, value: 1 },
            { key: ["b"], value: 2 },
          ]);
        }
        const before = await state(f.sql, f.tableName);
        await f.sql`CREATE TABLE ${f.sql(audit)} (event text)`;
        await f.sql`CREATE FUNCTION ${f.sql(fn)}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          INSERT INTO ${f.sql(audit)} VALUES (TG_OP);
          IF TG_OP = 'DELETE' THEN
            IF OLD.key = ARRAY['a'] THEN RETURN NULL; END IF;
            RETURN OLD;
          END IF;
          IF NEW.key = ARRAY['a'] THEN RETURN NULL; END IF;
          RETURN NEW;
        END
      $$`;
        const event =
          operation === "insert"
            ? f.sql`INSERT`
            : operation === "delete" || operation === "cas-delete"
              ? f.sql`DELETE`
              : f.sql`UPDATE`;
        await f.sql`CREATE TRIGGER filter_rows BEFORE ${event} ON ${f.sql(f.tableName)}
        FOR EACH ROW EXECUTE FUNCTION ${f.sql(fn)}()`;
        const invoke = (store: PostgresKvStore) => {
          if (operation === "insert" || operation === "update") {
            return store.setMany([
              { key, value: 11 },
              { key: ["b"], value: 22 },
            ]);
          }
          if (operation === "delete")
            return store.deleteMany([key, ["b"], ["missing"]]);
          if (operation === "cas-delete")
            return store.casMany([
              { key, expectedValue: 1, newValue: undefined },
              { key: ["b"], expectedValue: 2, newValue: 22 },
            ]);
          return store.casMany([
            { key: ["b"], expectedValue: 2, newValue: undefined },
            { key, expectedValue: 1, newValue: 11 },
          ]);
        };
        if (client === "transaction") {
          await f.sql.begin(async (sql) => {
            const store = new PostgresKvStore(sql, {
              tableName: f.tableName,
              initialized: true,
            });
            await assert.rejects(invoke(store));
            assert.equal((await sql`SELECT 1 AS healthy`)[0].healthy, 1);
          });
        } else {
          if (client === "reserved") reserved = await f.sql.reserve();
          const store =
            reserved == null
              ? f.store
              : new PostgresKvStore(reserved, {
                  tableName: f.tableName,
                  initialized: true,
                });
          await assert.rejects(invoke(store));
          reserved?.release();
          reserved = undefined;
        }
        assert.deepEqual(await state(f.sql, f.tableName), before);
        assert.equal(
          (await f.sql`SELECT count(*)::int AS size FROM ${f.sql(audit)}`)[0]
            .size,
          0,
        );
      } finally {
        reserved?.release();
        await f.sql`DROP TRIGGER IF EXISTS filter_rows ON ${f.sql(f.tableName)}`;
        await f.sql`DROP FUNCTION IF EXISTS ${f.sql(fn)}()`;
        await f.sql`DROP TABLE IF EXISTS ${f.sql(audit)}`;
        await f.dispose();
      }
    },
  );
}

dbTest(
  "PostgresKvStore deletion counts preserve missing-key and concurrent-delete no-ops",
  async () => {
    const f = fixture();
    const other = postgres(dbUrl!, { max: 1 });
    const blocker = await other.reserve();
    let pending: Promise<void> | undefined;
    try {
      await f.store.setMany([{ key, value: 1 }]);
      await f.store.deleteMany([["missing-a"], ["missing-b"]]);
      assert.equal(
        await f.store.casMany([
          { key: ["missing"], expectedValue: undefined, newValue: undefined },
          { key, expectedValue: 1, newValue: 2 },
        ]),
        true,
      );
      const [{ pid }] = await f.sql`SELECT pg_backend_pid() AS pid`;
      await blocker`BEGIN`;
      await blocker`DELETE FROM ${blocker(f.tableName)} WHERE key = ARRAY['a']`;
      pending = f.store.deleteMany([key]);
      await waiting(blocker, pid);
      await blocker`COMMIT`;
      await promptly(pending);
      pending = undefined;
      assert.deepEqual(await f.store.getMany([key]), [undefined]);
    } finally {
      await blocker`ROLLBACK`;
      await pending?.catch(() => {});
      blocker.release();
      await other.end();
      await f.dispose();
    }
  },
);

dbTest(
  "PostgresKvStore resolves relation names that shadow built-in types",
  async () => {
    const sql = postgres(dbUrl!, { max: 1 });
    const schema = `fedify_types_${crypto.randomUUID().replaceAll("-", "")}`;
    try {
      await sql`CREATE SCHEMA ${sql(schema)}`;
      await sql`SET search_path TO ${sql(schema)}`;
      const store = new PostgresKvStore(sql, { tableName: "text" });
      await store.set(key, 1);
      assert.equal(await store.get(key), 1);
      assert.deepEqual(await store.getMany([key]), [1]);
      await store.setMany([
        { key, value: 2 },
        { key: ["b"], value: 3 },
      ]);
      assert.equal(
        await store.casMany([{ key, expectedValue: 2, newValue: 4 }]),
        true,
      );
      await store.deleteMany([["b"]]);
      assert.deepEqual(await store.getMany([key, ["b"]]), [4, undefined]);
    } finally {
      await sql`RESET search_path`;
      await sql`DROP SCHEMA IF EXISTS ${sql(schema)} CASCADE`;
      await sql.end();
    }
  },
);

for (const operation of ["setMany", "deleteMany"] as const) {
  dbTest(
    `PostgresKvStore ${operation} rejects unsupported tables before statement triggers`,
    async () => {
      const f = fixture();
      const child = `${f.tableName}_child`;
      const audit = `${f.tableName}_audit`;
      const fn = `${f.tableName}_audit_fn`;
      try {
        await f.store.set(key, 1);
        const before = await state(f.sql, f.tableName);
        await f.sql`CREATE TABLE ${f.sql(child)} () INHERITS (${f.sql(f.tableName)})`;
        await f.sql`CREATE TABLE ${f.sql(audit)} (event text)`;
        await f.sql`CREATE FUNCTION ${f.sql(fn)}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          INSERT INTO ${f.sql(audit)} VALUES (TG_OP);
          RETURN NULL;
        END
      $$`;
        await f.sql`CREATE TRIGGER audit_statement AFTER INSERT OR UPDATE OR DELETE
        ON ${f.sql(f.tableName)} FOR EACH STATEMENT EXECUTE FUNCTION ${f.sql(fn)}()`;
        await assert.rejects(
          operation === "setMany"
            ? f.store.setMany([{ key, value: 2 }])
            : f.store.deleteMany([key]),
          TypeError,
        );
        assert.deepEqual(await state(f.sql, f.tableName), before);
        assert.equal(
          (await f.sql`SELECT count(*)::int AS size FROM ${f.sql(audit)}`)[0]
            .size,
          0,
        );
      } finally {
        await f.sql`DROP TRIGGER IF EXISTS audit_statement ON ${f.sql(f.tableName)}`;
        await f.sql`DROP FUNCTION IF EXISTS ${f.sql(fn)}()`;
        await f.sql`DROP TABLE IF EXISTS ${f.sql(audit)}`;
        await f.sql`DROP TABLE IF EXISTS ${f.sql(child)}`;
        await f.dispose();
      }
    },
  );
}
