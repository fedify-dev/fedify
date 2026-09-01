import { PGlite } from "@electric-sql/pglite";
import { PgliteKvStore } from "@fedify/pglite/kv";
import { testKvStore } from "@fedify/testing";
import * as temporal from "@js-temporal/polyfill";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

const Temporal = globalThis.Temporal ?? temporal.Temporal;

const randomName = (prefix: string): string =>
  `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;

test("PgliteKvStore conforms to KvStore", async () => {
  const pg = new PGlite();
  const store = new PgliteKvStore(pg, { tableName: randomName("fedify_kv") });
  try {
    await testKvStore(
      () => store,
      () => undefined,
    );
  } finally {
    await store.drop();
    await pg.close();
  }
});

test("PgliteKvStore.initialize() is idempotent", async () => {
  const pg = new PGlite();
  const tableName = randomName("fedify_kv");
  const store = new PgliteKvStore(pg, { tableName });
  try {
    await Promise.all([store.initialize(), store.initialize()]);
    await store.initialize();
    const result = await pg.query<{ table_name: string | null }>(
      "SELECT to_regclass($1) AS table_name;",
      [tableName],
    );
    assert.strictEqual(result.rows[0].table_name, tableName);
  } finally {
    await store.drop();
    await pg.close();
  }
});

test("PgliteKvStore.drop() is idempotent", async () => {
  const pg = new PGlite();
  const tableName = randomName("fedify_kv");
  const store = new PgliteKvStore(pg, { tableName });
  try {
    await store.initialize();
    await store.drop();
    await store.drop();
    const result = await pg.query<{ table_name: string | null }>(
      "SELECT to_regclass($1) AS table_name;",
      [tableName],
    );
    assert.strictEqual(result.rows[0].table_name, null);
  } finally {
    await store.drop();
    await pg.close();
  }
});

test("PgliteKvStore rejects table names with empty segments", () => {
  const pg = {} as unknown as PGlite;
  for (const tableName of ["", ".", "schema..table", ".table", "table."]) {
    assert.throws(
      () => new PgliteKvStore(pg, { tableName }),
      TypeError,
      `tableName: ${JSON.stringify(tableName)}`,
    );
  }
});

test("PgliteKvStore supports qualified mixed-case table names", async () => {
  const pg = new PGlite();
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const schemaName = `FedifySchema${suffix}`;
  const relationName = `FedifyTable${suffix}`;
  const store = new PgliteKvStore(pg, {
    tableName: `${schemaName}.${relationName}`,
  });
  try {
    await pg.query(`CREATE SCHEMA "${schemaName}";`);
    await store.initialize();
    assert.strictEqual(await store.cas(["key"], undefined, { value: 1 }), true);
    assert.deepStrictEqual(await store.get(["key"]), { value: 1 });
  } finally {
    await store.drop();
    await pg.query(`DROP SCHEMA IF EXISTS "${schemaName}";`);
    await pg.close();
  }
});

test("PgliteKvStore stores values as jsonb", async () => {
  const pg = new PGlite();
  const tableName = randomName("fedify_kv");
  const store = new PgliteKvStore(pg, { tableName });
  try {
    const value = { nested: { answer: 42 } };
    await store.set(["json"], value);
    const result = await pg.query<{ value: unknown; value_type: string }>(
      `
      SELECT value, pg_typeof(value)::text AS value_type
      FROM "${tableName}"
      WHERE key = $1::text[];
    `,
      [["json"]],
    );
    assert.deepStrictEqual(result.rows[0].value, value);
    assert.strictEqual(result.rows[0].value_type, "jsonb");
  } finally {
    await store.drop();
    await pg.close();
  }
});

test("PgliteKvStore.set() refreshes the TTL origin", async () => {
  const pg = new PGlite();
  const tableName = randomName("fedify_kv");
  const store = new PgliteKvStore(pg, { tableName });
  try {
    await store.initialize();
    await pg.query(
      `
      INSERT INTO "${tableName}" (key, value, created)
      VALUES (
        $1::text[],
        $2::text::jsonb,
        CURRENT_TIMESTAMP - INTERVAL '2 days'
      );
    `,
      [["ttl", "origin"], JSON.stringify("stale")],
    );

    await store.set(["ttl", "origin"], "fresh", {
      ttl: Temporal.Duration.from({ days: 1 }),
    });

    assert.strictEqual(await store.get(["ttl", "origin"]), "fresh");
    const result = await pg.query<{ recent: boolean }>(
      `
      SELECT created > CURRENT_TIMESTAMP - INTERVAL '1 minute' AS recent
      FROM "${tableName}"
      WHERE key = $1::text[];
    `,
      [["ttl", "origin"]],
    );
    assert.strictEqual(result.rows[0].recent, true);
  } finally {
    await store.drop();
    await pg.close();
  }
});

test("PgliteKvStore persists data after its owner reopens PGlite", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "fedify-pglite-"));
  const tableName = randomName("fedify_kv");
  let pg: PGlite | undefined;
  try {
    pg = new PGlite(dataDir);
    const firstStore = new PgliteKvStore(pg, { tableName });
    await firstStore.set(["persistent"], { value: true });
    await pg.close();

    pg = new PGlite(dataDir);
    const secondStore = new PgliteKvStore(pg, {
      tableName,
      initialized: true,
    });
    assert.deepStrictEqual(await secondStore.get(["persistent"]), {
      value: true,
    });
    await secondStore.drop();
  } finally {
    if (pg != null && !pg.closed) await pg.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
