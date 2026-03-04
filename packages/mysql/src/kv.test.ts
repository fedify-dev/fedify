import { MysqlKvStore } from "@fedify/mysql/kv";
import * as temporal from "@js-temporal/polyfill";
import assert from "node:assert/strict";
import process from "node:process";
import { test } from "node:test";
import mysql from "mysql2/promise";

let Temporal: typeof temporal.Temporal;
if ("Temporal" in globalThis) {
  Temporal = globalThis.Temporal;
} else {
  Temporal = temporal.Temporal;
}

const dbUrl = process.env.MYSQL_URL;

function getStore(): {
  pool: mysql.Pool;
  tableName: string;
  store: MysqlKvStore;
} {
  const pool = mysql.createPool(dbUrl!);
  const tableName = `fedify_kv_test_${Math.random().toString(36).slice(5)}`;
  return {
    pool,
    tableName,
    store: new MysqlKvStore(pool, { tableName }),
  };
}

test("MysqlKvStore rejects invalid table names", () => {
  assert.throws(
    () => new MysqlKvStore({} as mysql.Pool, { tableName: "bad-name!" }),
    RangeError,
  );
  assert.throws(
    () => new MysqlKvStore({} as mysql.Pool, { tableName: "1_starts_digit" }),
    RangeError,
  );
  assert.throws(
    () => new MysqlKvStore({} as mysql.Pool, { tableName: "has space" }),
    RangeError,
  );
  // valid names should not throw
  new MysqlKvStore({} as mysql.Pool, { tableName: "valid_name" });
  new MysqlKvStore({} as mysql.Pool, { tableName: "_leading_underscore" });
  new MysqlKvStore({} as mysql.Pool, { tableName: "CamelCase123" });
});

test("MysqlKvStore.initialize()", { skip: dbUrl == null }, async () => {
  if (dbUrl == null) return;

  const { pool, tableName, store } = getStore();
  try {
    await store.initialize();
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = ?`,
      [tableName],
    );
    assert.strictEqual(rows[0].cnt, 1);

    // Verify key column length is at least 768
    const [cols] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT CHARACTER_MAXIMUM_LENGTH
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = ?
         AND column_name = 'key'`,
      [tableName],
    );
    assert.ok(cols[0].CHARACTER_MAXIMUM_LENGTH >= 768);

    // Verify that an index on the expires column exists
    const [idxRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.statistics
       WHERE table_schema = DATABASE()
         AND table_name = ?
         AND column_name = 'expires'`,
      [tableName],
    );
    assert.strictEqual(idxRows[0].cnt, 1);
  } finally {
    await store.drop();
    await pool.end();
  }
});

test("MysqlKvStore.get()", { skip: dbUrl == null }, async () => {
  if (dbUrl == null) return;

  const { pool, tableName, store } = getStore();
  try {
    await store.initialize();
    await pool.query(
      `INSERT INTO \`${tableName}\` (\`key\`, \`value\`)
       VALUES (?, CAST(? AS JSON))`,
      [JSON.stringify(["foo", "bar"]), JSON.stringify(["foobar"])],
    );
    assert.deepStrictEqual(await store.get(["foo", "bar"]), ["foobar"]);

    // Insert with immediately expired TTL
    await pool.query(
      `INSERT INTO \`${tableName}\` (\`key\`, \`value\`, \`expires\`)
       VALUES (?, CAST(? AS JSON), DATE_SUB(NOW(6), INTERVAL 1 SECOND))`,
      [
        JSON.stringify(["foo", "bar", "ttl"]),
        JSON.stringify(["foobar"]),
      ],
    );
    assert.strictEqual(await store.get(["foo", "bar", "ttl"]), undefined);
  } finally {
    await store.drop();
    await pool.end();
  }
});

test("MysqlKvStore.set()", { skip: dbUrl == null }, async () => {
  if (dbUrl == null) return;

  const { pool, tableName, store } = getStore();
  try {
    await store.set(["foo", "baz"], "baz");
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT * FROM \`${tableName}\` WHERE \`key\` = ?`,
      [JSON.stringify(["foo", "baz"])],
    );
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].value, "baz");
    assert.strictEqual(rows[0].expires, null);

    await store.set(["foo", "qux"], "qux", {
      ttl: Temporal.Duration.from({ days: 1 }),
    });
    const [rows2] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT * FROM \`${tableName}\` WHERE \`key\` = ?`,
      [JSON.stringify(["foo", "qux"])],
    );
    assert.strictEqual(rows2.length, 1);
    assert.strictEqual(rows2[0].value, "qux");
    assert.notStrictEqual(rows2[0].expires, null);

    await store.set(["foo", "quux"], true);
    const [rows3] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT * FROM \`${tableName}\` WHERE \`key\` = ?`,
      [JSON.stringify(["foo", "quux"])],
    );
    assert.strictEqual(rows3.length, 1);
    assert.strictEqual(rows3[0].value, true);
    assert.strictEqual(rows3[0].expires, null);
  } finally {
    await store.drop();
    await pool.end();
  }
});

test(
  "MysqlKvStore.set() - undefined value is a no-op",
  { skip: dbUrl == null },
  async () => {
    if (dbUrl == null) return;

    const { pool, store } = getStore();
    try {
      // Setting undefined on a nonexistent key should leave the key absent
      await store.set(["foo"], undefined);
      assert.strictEqual(await store.get(["foo"]), undefined);

      // Setting a real value then overwriting with undefined should be a no-op
      await store.set(["bar"], "value");
      await store.set(["bar"], undefined);
      assert.deepStrictEqual(await store.get(["bar"]), "value");
    } finally {
      await store.drop();
      await pool.end();
    }
  },
);

test("MysqlKvStore.delete()", { skip: dbUrl == null }, async () => {
  if (dbUrl == null) return;

  const { pool, store } = getStore();
  try {
    await store.set(["foo", "bar"], "foobar");
    assert.deepStrictEqual(await store.get(["foo", "bar"]), "foobar");
    await store.delete(["foo", "bar"]);
    assert.strictEqual(await store.get(["foo", "bar"]), undefined);
  } finally {
    await store.drop();
    await pool.end();
  }
});

test("MysqlKvStore.drop()", { skip: dbUrl == null }, async () => {
  if (dbUrl == null) return;

  const { pool, tableName, store } = getStore();
  try {
    await store.initialize();
    await store.drop();
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = ?`,
      [tableName],
    );
    assert.strictEqual(rows[0].cnt, 0);
  } finally {
    await pool.end();
  }
});

test("MysqlKvStore.list()", { skip: dbUrl == null }, async () => {
  if (dbUrl == null) return;

  const { pool, store } = getStore();
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
    await pool.end();
  }
});

test(
  "MysqlKvStore.list() - excludes expired",
  { skip: dbUrl == null },
  async () => {
    if (dbUrl == null) return;

    const { pool, tableName, store } = getStore();
    try {
      await store.initialize();

      // Insert expired entry directly
      await pool.query(
        `INSERT INTO \`${tableName}\` (\`key\`, \`value\`, \`expires\`)
         VALUES (?, CAST(? AS JSON),
                 DATE_SUB(NOW(6), INTERVAL 30 MINUTE))`,
        [
          JSON.stringify(["list-test", "expired"]),
          JSON.stringify("expired-value"),
        ],
      );
      await store.set(["list-test", "valid"], "valid-value");

      const entries: { key: readonly string[]; value: unknown }[] = [];
      for await (const entry of store.list(["list-test"])) {
        entries.push({ key: entry.key, value: entry.value });
      }

      assert.strictEqual(entries.length, 1);
      assert.deepStrictEqual(entries[0].key, ["list-test", "valid"]);
    } finally {
      await store.drop();
      await pool.end();
    }
  },
);

test(
  "MysqlKvStore.list() - single element key",
  { skip: dbUrl == null },
  async () => {
    if (dbUrl == null) return;

    const { pool, store } = getStore();
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
      await pool.end();
    }
  },
);

test(
  "MysqlKvStore.list() - keys with LIKE special characters",
  { skip: dbUrl == null },
  async () => {
    if (dbUrl == null) return;

    const { pool, store } = getStore();
    try {
      // Keys whose serialized form contains %, _, or \ characters
      await store.set(["50%", "off"], "discount");
      await store.set(["50%", "extra"], "extra-discount");
      await store.set(["snake_case", "key"], "snake");
      await store.set(["back\\slash", "key"], "backslash");
      await store.set(["unrelated"], "noise");

      const percentEntries: unknown[] = [];
      for await (const entry of store.list(["50%"])) {
        percentEntries.push(entry.key);
      }
      assert.strictEqual(percentEntries.length, 2);

      const underscoreEntries: unknown[] = [];
      for await (const entry of store.list(["snake_case"])) {
        underscoreEntries.push(entry.key);
      }
      assert.strictEqual(underscoreEntries.length, 1);

      const backslashEntries: unknown[] = [];
      for await (const entry of store.list(["back\\slash"])) {
        backslashEntries.push(entry.key);
      }
      assert.strictEqual(backslashEntries.length, 1);
    } finally {
      await store.drop();
      await pool.end();
    }
  },
);

test(
  "MysqlKvStore.list() - empty prefix",
  { skip: dbUrl == null },
  async () => {
    if (dbUrl == null) return;

    const { pool, store } = getStore();
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
      await pool.end();
    }
  },
);

test("MysqlKvStore.cas()", { skip: dbUrl == null }, async () => {
  if (dbUrl == null) return;

  const { pool, store } = getStore();
  try {
    await store.set(["foo", "bar"], "foobar");

    // Mismatch: expected "bar" but current value is "foobar"
    assert.strictEqual(
      await store.cas!(["foo", "bar"], "bar", "baz"),
      false,
    );
    assert.deepStrictEqual(await store.get(["foo", "bar"]), "foobar");

    // Match: expected "foobar" matches current value
    assert.strictEqual(
      await store.cas!(["foo", "bar"], "foobar", "baz"),
      true,
    );
    assert.deepStrictEqual(await store.get(["foo", "bar"]), "baz");

    // Delete the key, then CAS with wrong expected value
    await store.delete(["foo", "bar"]);
    assert.strictEqual(
      await store.cas!(["foo", "bar"], "foobar", "baz"),
      false,
    );
    assert.strictEqual(await store.get(["foo", "bar"]), undefined);

    // CAS with undefined expected value on non-existent key (create-if-absent)
    assert.strictEqual(
      await store.cas!(["foo", "bar"], undefined, "baz"),
      true,
    );
    assert.deepStrictEqual(await store.get(["foo", "bar"]), "baz");
  } finally {
    await store.drop();
    await pool.end();
  }
});

test(
  "MysqlKvStore.cas() with undefined newValue deletes the key",
  { skip: dbUrl == null },
  async () => {
    if (dbUrl == null) return;

    const { pool, store } = getStore();
    try {
      // Set up a key then CAS it away with undefined newValue
      await store.set(["foo"], "bar");
      assert.strictEqual(
        await store.cas!(["foo"], "bar", undefined),
        true,
      );
      assert.strictEqual(await store.get(["foo"]), undefined);

      // CAS with wrong expected value and undefined newValue should fail
      await store.set(["baz"], "qux");
      assert.strictEqual(
        await store.cas!(["baz"], "wrong", undefined),
        false,
      );
      assert.deepStrictEqual(await store.get(["baz"]), "qux");
    } finally {
      await store.drop();
      await pool.end();
    }
  },
);

test(
  "MysqlKvStore.cas() with TTL",
  { skip: dbUrl == null },
  async () => {
    if (dbUrl == null) return;

    const { pool, store } = getStore();
    try {
      // CAS with TTL on non-existent key
      assert.strictEqual(
        await store.cas!(["ttl", "key"], undefined, "value", {
          ttl: Temporal.Duration.from({ hours: 1 }),
        }),
        true,
      );
      assert.deepStrictEqual(await store.get(["ttl", "key"]), "value");

      // CAS with zero TTL should effectively expire immediately
      assert.strictEqual(
        await store.cas!(["ttl", "key"], "value", "new-value", {
          ttl: Temporal.Duration.from({ seconds: 0 }),
        }),
        true,
      );
      // Wait a bit for expiry
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.strictEqual(await store.get(["ttl", "key"]), undefined);
    } finally {
      await store.drop();
      await pool.end();
    }
  },
);
