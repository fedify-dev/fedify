import { PlatformDatabase } from "#sqlite";
import { SqliteKvStore } from "@fedify/sqlite/kv";
import * as temporal from "@js-temporal/polyfill";
import { delay } from "@std/async/delay";
import assert from "node:assert/strict";
import { test } from "node:test";

let Temporal: typeof temporal.Temporal;
if ("Temporal" in globalThis) {
  Temporal = globalThis.Temporal;
} else {
  Temporal = temporal.Temporal;
}

function getStore(): {
  db: PlatformDatabase;
  tableName: string;
  store: SqliteKvStore;
} {
  const db = new PlatformDatabase(":memory:");
  const tableName = `fedify_kv_test_${Math.random().toString(36).slice(5)}`;
  return {
    db,
    tableName,
    store: new SqliteKvStore(db, { tableName }),
  };
}

test("SqliteKvStore.initialize()", async () => {
  const { db, tableName, store } = getStore();
  try {
    await store.initialize();
    const result = await db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name=?
    `).get(tableName);
    assert(result !== undefined);
  } finally {
    await store.drop();
    await db.close();
  }
});

test("SqliteKvStore.get()", async () => {
  const { db, tableName, store } = getStore();
  try {
    await store.initialize();
    const now = Temporal.Now.instant().epochMilliseconds;
    db.prepare(`
      INSERT INTO ${tableName} (key, value, created)
      VALUES (?, ?, ?)
    `).run(JSON.stringify(["foo", "bar"]), JSON.stringify(["foobar"]), now);
    assert.deepStrictEqual(await store.get(["foo", "bar"]), ["foobar"]);

    db.prepare(`
      INSERT INTO ${tableName} (key, value, expires, created)
      VALUES (?, ?, ?, ?)
    `).run(
      JSON.stringify(["foo", "bar", "ttl"]),
      JSON.stringify(["foobar"]),
      now + 500,
      Temporal.Now.instant().epochMilliseconds,
    );
    await delay(500);
    assert.strictEqual(await store.get(["foo", "bar", "ttl"]), undefined);
  } finally {
    await store.drop();
    await db.close();
  }
});

test("SqliteKvStore.set()", async () => {
  const { db, tableName, store } = getStore();
  try {
    await store.set(["foo", "baz"], "baz");

    const result = db.prepare(`
      SELECT * FROM ${tableName}
      WHERE key = ?
    `).all(JSON.stringify(["foo", "baz"])) as {
      key: string;
      value: string;
      created: number;
      expires: number | null;
    }[];

    assert.strictEqual(result.length, 1);
    assert.deepStrictEqual(JSON.parse(result[0].key), ["foo", "baz"]);
    assert.strictEqual(JSON.parse(result[0].value), "baz");
    assert.strictEqual(result[0].expires, null);

    await store.set(["foo", "qux"], "qux", {
      ttl: Temporal.Duration.from({ days: 1 }),
    });
    const result2 = db.prepare(`
      SELECT * FROM ${tableName}
      WHERE key = ?
    `).all(JSON.stringify(["foo", "qux"])) as {
      key: string;
      value: string;
      created: number;
      expires: number | null;
    }[];
    assert.strictEqual(result2.length, 1);
    assert.deepStrictEqual(JSON.parse(result2[0].key), ["foo", "qux"]);
    assert.strictEqual(JSON.parse(result2[0].value), "qux");
    assert(
      result2[0].expires && result2[0].expires >= result2[0].created + 86400000,
    );

    await store.set(["foo", "quux"], true);
    const result3 = db.prepare(`
      SELECT * FROM ${tableName}
      WHERE key = ?
    `).all(JSON.stringify(["foo", "quux"])) as {
      key: string;
      value: string;
      created: number;
      expires: number | null;
    }[];
    assert.strictEqual(result3.length, 1);
    assert.deepStrictEqual(JSON.parse(result3[0].key), ["foo", "quux"]);
    assert.strictEqual(JSON.parse(result3[0].value), true);
    assert.strictEqual(result3[0].expires, null);
  } finally {
    await store.drop();
    await db.close();
  }
});

test("SqliteKvStore.set() - upsert functionality", async () => {
  const { db, tableName, store } = getStore();
  try {
    await store.set(["upsert"], "initial");
    assert.strictEqual(await store.get(["upsert"]), "initial");
    await store.set(["upsert"], "updated");
    assert.strictEqual(await store.get(["upsert"]), "updated");
    const result = db.prepare(`
      SELECT COUNT(*) as count FROM ${tableName} WHERE key = ?
    `).get(JSON.stringify(["upsert"]));
    assert.strictEqual((result as { count: number }).count, 1);
  } finally {
    await store.drop();
    await db.close();
  }
});

test("SqliteKvStore.delete()", async () => {
  const { db, tableName, store } = getStore();
  try {
    await store.delete(["foo", "qux"]);
    const result = db.prepare(`
      SELECT * FROM ${tableName}
      WHERE key = ?
    `).all(JSON.stringify(["foo", "qux"]));
    assert.strictEqual(result.length, 0);

    db.prepare(`
      INSERT INTO ${tableName} (key, value, created)
      VALUES (?, ?, ?)
    `).run(
      JSON.stringify(["foo", "qux"]),
      JSON.stringify(["qux"]),
      Temporal.Now.instant().epochMilliseconds,
    );
    await store.delete(["foo", "qux"]);
    const result2 = db.prepare(`
      SELECT * FROM ${tableName}
      WHERE key = ?
    `).all(JSON.stringify(["foo", "qux"]));
    assert.strictEqual(result2.length, 0);
  } finally {
    await store.drop();
    await db.close();
  }
});

test("SqliteKvStore.drop()", async () => {
  const { db, tableName, store } = getStore();
  try {
    await store.drop();
    const result = await db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name=?
    `).get(tableName);
    // Bun returns null, Node returns undefined
    assert(result === undefined || result === null);
  } finally {
    await db.close();
  }
});

test("SqliteKvStore.cas()", async () => {
  const { db, store } = getStore();
  try {
    await store.set(["foo", "bar"], "foobar");
    assert.strictEqual(await store.cas(["foo", "bar"], "bar", "baz"), false);
    assert.strictEqual(await store.get(["foo", "bar"]), "foobar");
    assert.strictEqual(await store.cas(["foo", "bar"], "foobar", "baz"), true);
    assert.strictEqual(await store.get(["foo", "bar"]), "baz");
    await store.delete(["foo", "bar"]);
    assert.strictEqual(await store.cas(["foo", "bar"], "foobar", "baz"), false);
    assert.strictEqual(await store.get(["foo", "bar"]), undefined);
    assert.strictEqual(await store.cas(["foo", "bar"], undefined, "baz"), true);
    assert.strictEqual(await store.get(["foo", "bar"]), "baz");
    assert.strictEqual(await store.cas(["foo", "bar"], "baz", undefined), true);
    assert.strictEqual(await store.get(["foo", "bar"]), undefined);
  } finally {
    await store.drop();
    await db.close();
  }
});

test("SqliteKvStore - complex values", async () => {
  const { db, store } = getStore();
  try {
    await store.set(["complex"], {
      nested: {
        value: "test",
      },
    });
    assert.deepStrictEqual(await store.get(["complex"]), {
      nested: {
        value: "test",
      },
    });

    await store.set(["undefined"], undefined);
    assert.strictEqual(await store.get(["undefined"]), undefined);
    assert.strictEqual(await store.cas(["undefined"], undefined, "baz"), true);
    assert.strictEqual(await store.get(["undefined"]), "baz");

    await store.set(["null"], null);
    assert.strictEqual(await store.get(["null"]), null);
    assert.strictEqual(await store.cas(["null"], null, "baz"), true);
    assert.strictEqual(await store.get(["null"]), "baz");

    await store.set(["empty string"], "");
    assert.strictEqual(await store.get(["empty string"]), "");
    assert.strictEqual(await store.cas(["empty string"], "", "baz"), true);
    assert.strictEqual(await store.get(["empty string"]), "baz");

    await store.set(["array"], [1, 2, 3]);
    assert.deepStrictEqual(await store.get(["array"]), [1, 2, 3]);
    assert.strictEqual(
      await store.cas(["array"], [1, 2, 3], [1, 2, 3, 4]),
      true,
    );
    assert.deepStrictEqual(await store.get(["array"]), [1, 2, 3, 4]);

    await store.set(["object"], { a: 1, b: 2 });
    assert.deepStrictEqual(await store.get(["object"]), { b: 2, a: 1 });
    assert.strictEqual(
      await store.cas(["object"], { a: 1, b: 2 }, { a: 1, b: 2, c: 3 }),
      true,
    );
    assert.deepStrictEqual(await store.get(["object"]), { a: 1, b: 2, c: 3 });

    await store.set(["falsy", "false"], false);
    assert.strictEqual(await store.get(["falsy", "false"]), false);
    assert.strictEqual(await store.cas(["falsy", "false"], false, true), true);
    assert.strictEqual(await store.get(["falsy", "false"]), true);

    await store.set(["falsy", "0"], 0);
    assert.strictEqual(await store.get(["falsy", "0"]), 0);
    assert.strictEqual(await store.cas(["falsy", "0"], 0, 1), true);
    assert.strictEqual(await store.get(["falsy", "0"]), 1);
  } finally {
    await store.drop();
    await db.close();
  }
});

test("SqliteKvStore.set() - preserves created timestamp on update", async () => {
  const { db, tableName, store } = getStore();
  try {
    await store.set(["timestamp-test"], "initial");
    const initialResult = db.prepare(`
      SELECT created, expires FROM ${tableName}
      WHERE key = ?
    `).get(JSON.stringify(["timestamp-test"]));

    const initialCreated = (initialResult as { created: number }).created;
    assert(
      initialCreated !== undefined,
      "Initial created timestamp should be set",
    );
    assert.strictEqual(
      (initialResult as { expires: number | null }).expires,
      null,
    );

    await delay(100);

    const ttl = Temporal.Duration.from({ seconds: 30 });
    await store.set(["timestamp-test"], "updated", { ttl });

    const updatedResult = db.prepare(`
      SELECT created, expires FROM ${tableName}
      WHERE key = ?
    `).get(JSON.stringify(["timestamp-test"]));

    assert.strictEqual(
      (updatedResult as { created: number }).created,
      initialCreated,
      "Created timestamp should remain unchanged after update",
    );
  } finally {
    await store.drop();
    await db.close();
  }
});

test("SqliteKvStore.list()", async () => {
  const { db, store } = getStore();
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
    assert(
      entries.some((e) => e.key[1] === "a" && e.value === "value-a"),
    );
    assert(entries.some((e) => e.key[1] === "b"));
    assert(entries.some((e) => e.key[1] === "nested"));
  } finally {
    await store.drop();
    await db.close();
  }
});

test("SqliteKvStore.list() - excludes expired", async () => {
  const { db, tableName, store } = getStore();
  try {
    await store.initialize();
    const now = Temporal.Now.instant().epochMilliseconds;

    // Insert expired entry directly
    db.prepare(`
      INSERT INTO "${tableName}" (key, value, created, expires)
      VALUES (?, ?, ?, ?)
    `).run(
      JSON.stringify(["list-test", "expired"]),
      JSON.stringify("expired-value"),
      now - 1000,
      now - 500,
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
    await db.close();
  }
});

test("SqliteKvStore.list() - single element key", async () => {
  const { db, store } = getStore();
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
    await db.close();
  }
});

test("SqliteKvStore.list() - empty prefix", async () => {
  const { db, store } = getStore();
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
    await db.close();
  }
});
