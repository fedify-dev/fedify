import { PostgresKvStore } from "@fedify/postgres/kv";
import * as temporal from "@js-temporal/polyfill";
import { delay } from "@std/async/delay";
import assert from "node:assert/strict";
import process from "node:process";
import { test } from "node:test";
import postgres from "postgres";

const Temporal = globalThis.Temporal ?? temporal.Temporal;

const dbUrl = process.env.POSTGRES_URL;

function getStore(): {
  // deno-lint-ignore no-explicit-any
  sql: postgres.Sql<any>;
  tableName: string;
  store: PostgresKvStore;
} {
  const sql = postgres(dbUrl!);
  const tableName = `fedify_kv_test_${Math.random().toString(36).slice(5)}`;
  return {
    sql,
    tableName,
    store: new PostgresKvStore(sql, { tableName }),
  };
}

test("PostgresKvStore.initialize()", { skip: dbUrl == null }, async () => {
  if (dbUrl == null) return; // Bun does not support skip option

  const { sql, tableName, store } = getStore();
  try {
    await store.initialize();
    const result = await sql`
      SELECT to_regclass(${tableName}) IS NOT NULL AS exists;
    `;
    assert(result[0].exists);
  } finally {
    await store.drop();
    await sql.end();
  }
});

test("PostgresKvStore.get()", { skip: dbUrl == null }, async () => {
  if (dbUrl == null) return; // Bun does not support skip option

  const { sql, tableName, store } = getStore();
  try {
    await store.initialize();
    await sql`
      INSERT INTO ${sql(tableName)} (key, value)
      VALUES (${["foo", "bar"]}, ${["foobar"]})
    `;
    assert.deepStrictEqual(await store.get(["foo", "bar"]), ["foobar"]);

    await sql`
      INSERT INTO ${sql(tableName)} (key, value, ttl)
      VALUES (${["foo", "bar", "ttl"]}, ${["foobar"]}, ${"0 seconds"})
    `;
    await delay(500);
    assert.strictEqual(await store.get(["foo", "bar", "ttl"]), undefined);
  } finally {
    await store.drop();
    await sql.end();
  }
});

test("PostgresKvStore.set()", { skip: dbUrl == null }, async () => {
  if (dbUrl == null) return; // Bun does not support skip option

  const { sql, tableName, store } = getStore();
  try {
    await store.set(["foo", "baz"], "baz");
    const result = await sql`
      SELECT * FROM ${sql(tableName)}
      WHERE key = ${["foo", "baz"]}
    `;
    assert.strictEqual(result.length, 1);
    assert.deepStrictEqual(result[0].key, ["foo", "baz"]);
    assert.strictEqual(result[0].value, "baz");
    assert.strictEqual(result[0].ttl, null);

    await store.set(["foo", "qux"], "qux", {
      ttl: Temporal.Duration.from({ days: 1 }),
    });
    const result2 = await sql`
      SELECT * FROM ${sql(tableName)}
      WHERE key = ${["foo", "qux"]}
    `;
    assert.strictEqual(result2.length, 1);
    assert.deepStrictEqual(result2[0].key, ["foo", "qux"]);
    assert.strictEqual(result2[0].value, "qux");
    assert.strictEqual(result2[0].ttl, "1 day");

    await store.set(["foo", "quux"], true);
    const result3 = await sql`
      SELECT * FROM ${sql(tableName)}
      WHERE key = ${["foo", "quux"]}
    `;
    assert.strictEqual(result3.length, 1);
    assert.deepStrictEqual(result3[0].key, ["foo", "quux"]);
    assert.strictEqual(result3[0].value, true);
    assert.strictEqual(result3[0].ttl, null);
  } finally {
    await store.drop();
    await sql.end();
  }
});

test("PostgresKvStore.delete()", { skip: dbUrl == null }, async () => {
  if (dbUrl == null) return; // Bun does not support skip option

  const { sql, tableName, store } = getStore();
  try {
    await store.delete(["foo", "bar"]);
    const result = await sql`
      SELECT * FROM ${sql(tableName)}
      WHERE key = ${["foo", "bar"]}
    `;
    assert.strictEqual(result.length, 0);
  } finally {
    await store.drop();
    await sql.end();
  }
});

test("PostgresKvStore.drop()", { skip: dbUrl == null }, async () => {
  if (dbUrl == null) return; // Bun does not support skip option

  const { sql, tableName, store } = getStore();
  try {
    await store.drop();
    const result2 = await sql`
      SELECT to_regclass(${tableName}) IS NOT NULL AS exists;
    `;
    assert.ok(!result2[0].exists);
  } finally {
    await sql.end();
  }
});

test("PostgresKvStore.list()", { skip: dbUrl == null }, async () => {
  if (dbUrl == null) return; // Bun does not support skip option

  const { sql, store } = getStore();
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
    await store.drop();
    await sql.end();
  }
});

test(
  "PostgresKvStore.list() - excludes expired",
  { skip: dbUrl == null },
  async () => {
    if (dbUrl == null) return; // Bun does not support skip option

    const { sql, tableName, store } = getStore();
    try {
      await store.initialize();

      // Insert expired entry directly
      await sql`
      INSERT INTO ${sql(tableName)} (key, value, created, ttl)
      VALUES (
        ${["list-test", "expired"]},
        ${"expired-value"},
        CURRENT_TIMESTAMP - INTERVAL '1 hour',
        ${"30 minutes"}
      )
    `;
      await store.set(["list-test", "valid"], "valid-value");

      const entries: { key: readonly string[]; value: unknown }[] = [];
      for await (const entry of store.list(["list-test"])) {
        entries.push({ key: entry.key, value: entry.value });
      }

      assert.strictEqual(entries.length, 1);
      assert.deepStrictEqual(entries[0].key, ["list-test", "valid"]);
    } finally {
      await store.drop();
      await sql.end();
    }
  },
);

test(
  "PostgresKvStore.list() - single element key",
  { skip: dbUrl == null },
  async () => {
    if (dbUrl == null) return; // Bun does not support skip option

    const { sql, store } = getStore();
    try {
      await store.set(["a"], "value-a");
      await store.set(["b"], "value-b");

      const entries: { key: readonly string[]; value: unknown }[] = [];
      for await (const entry of store.list(["a"])) {
        entries.push({ key: entry.key, value: entry.value });
      }

      assert.strictEqual(entries.length, 1);
    } finally {
      await store.drop();
      await sql.end();
    }
  },
);

test(
  "PostgresKvStore.list() - empty prefix",
  { skip: dbUrl == null },
  async () => {
    if (dbUrl == null) return; // Bun does not support skip option

    const { sql, store } = getStore();
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
      await store.drop();
      await sql.end();
    }
  },
);

// Regression test for the driver JSON serialization probe being skipped
// together with the schema DDL when `initialized: true` is passed.
//
// `initialize()` does two unrelated things: it runs the `CREATE UNLOGGED
// TABLE` statement, and it sets `#driverSerializesJson` from the
// `driverSerializesJson()` probe.  Because the constructor assigned
// `options.initialized` straight into `#initialized`, `initialize()` returned
// at its first line and reached neither, so the flag stayed `false`, `#json()`
// called `JSON.stringify()` before handing the value to postgres.js, and the
// driver serialized it a second time.  The value was stored as a JSONB string
// instead of a JSONB object, and unlike the queue's version of this bug the
// bad row stays in the table: every later `get()` returns a string, including
// one from a store that never passed the option.
//
// See: https://github.com/fedify-dev/fedify/issues/1031
test(
  "PostgresKvStore stores JSONB objects when initialized is true",
  { skip: dbUrl == null },
  async () => {
    if (dbUrl == null) return; // Bun does not support skip option

    const sql = postgres(dbUrl!);
    const tableName = `fedify_kv_test_${Math.random().toString(36).slice(5)}`;
    const store = new PostgresKvStore(sql, { tableName, initialized: true });
    try {
      // Create the table up front, which is the situation `initialized: true`
      // describes.  The DDL is the same one `initialize()` would have run.
      await sql`
        CREATE UNLOGGED TABLE IF NOT EXISTS ${sql(tableName)} (
          key text[] PRIMARY KEY,
          value jsonb NOT NULL,
          created timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
          ttl interval
        );
      `;

      const value = { keyPair: { id: "https://example.com/actor#main-key" } };
      await store.set(["cache", "a"], value);

      const [row] = await sql`
        SELECT value, jsonb_typeof(value) AS json_type
        FROM ${sql(tableName)}
        WHERE key = ${["cache", "a"]};
      `;
      assert.strictEqual(
        row.json_type,
        "object",
        "initialized: true should still store the value as a JSONB object",
      );
      assert.deepStrictEqual(
        row.value,
        value,
        "the stored value should round-trip as the original object",
      );
      assert.deepStrictEqual(
        await store.get(["cache", "a"]),
        value,
        "get() should return the object that set() was given",
      );
    } finally {
      await store.drop();
      await sql.end();
    }
  },
);

// The other half of the same contract: running the probe unconditionally must
// not drag the DDL along with it.  If `initialized: true` ever starts creating
// the table again, callers that pass it precisely because they manage their own
// schema would silently get a table they did not ask for, so the missing table
// has to surface as an error instead.
test(
  "PostgresKvStore initialized true still skips the schema DDL",
  { skip: dbUrl == null },
  async () => {
    if (dbUrl == null) return; // Bun does not support skip option

    const sql = postgres(dbUrl!);
    const tableName = `fedify_kv_test_${Math.random().toString(36).slice(5)}`;
    const store = new PostgresKvStore(sql, { tableName, initialized: true });
    try {
      // The table is deliberately never created.
      await assert.rejects(
        () => store.set(["cache", "a"], { n: 1 }),
        (error: unknown) =>
          error instanceof postgres.PostgresError && error.code === "42P01",
        "initialized: true should not create the table on its own",
      );

      const rows = await sql`
        SELECT 1
        FROM pg_tables
        WHERE schemaname = current_schema()
          AND tablename = ${tableName};
      `;
      assert.strictEqual(rows.length, 0, "no table should have been created");
    } finally {
      await store.drop();
      await sql.end();
    }
  },
);

// cSpell: ignore regclass
