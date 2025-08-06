import { PostgresKvStore } from "@fedify/postgres/kv";
import * as temporal from "@js-temporal/polyfill";
import { delay } from "@std/async/delay";
import assert from "node:assert/strict";
import process from "node:process";
import { test } from "node:test";
import postgres from "postgres";

let Temporal: typeof temporal.Temporal;
if ("Temporal" in globalThis) {
  Temporal = globalThis.Temporal;
} else {
  Temporal = temporal.Temporal;
}

const dbUrl = process.env.DATABASE_URL;

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

// cSpell: ignore regclass
