// Database setup and assertion sequences deliberately run in order.
/* oxlint-disable eslint/no-await-in-loop */
import { PlatformDatabase } from "#sqlite";
import type { KvKey, KvStoreCasEntry, KvStoreSetEntry } from "@fedify/fedify";
import { isAtomicKvStore } from "@fedify/fedify";
import { SqliteKvStore } from "@fedify/sqlite/kv";
import { testAtomicKvStore, testKvStore } from "@fedify/testing";
import * as temporal from "@js-temporal/polyfill";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import "temporal-polyfill/global";

const Temporal = globalThis.Temporal ?? temporal.Temporal;
type Journal = "DELETE" | "WAL";

function pair(journal: Journal = "DELETE") {
  const directory = mkdtempSync(join(tmpdir(), "fedify-sqlite-atomic-"));
  const file = join(directory, "kv.sqlite");
  let a: PlatformDatabase | undefined;
  let b: PlatformDatabase | undefined;
  try {
    a = new PlatformDatabase(file);
    a.exec(`PRAGMA journal_mode=${journal}`);
    a.exec("PRAGMA busy_timeout=5000");
    b = new PlatformDatabase(file);
    b.exec("PRAGMA busy_timeout=5000");
    const first = new SqliteKvStore(a);
    const second = new SqliteKvStore(b);
    return {
      file,
      a,
      b,
      first,
      second,
      dispose() {
        try {
          a!.close();
        } finally {
          try {
            b!.close();
          } finally {
            rmSync(directory, { recursive: true, force: true });
          }
        }
      },
    };
  } catch (error) {
    a?.close();
    b?.close();
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

interface Hooks {
  exec?: (sql: string) => void;
  read?: (parameters: readonly unknown[]) => void;
  run?: (sql: string, parameters: readonly unknown[]) => void;
}

interface NativeStatement {
  get(...parameters: unknown[]): unknown;
  run(...parameters: unknown[]): unknown;
  all(...parameters: unknown[]): unknown[];
}

interface NativeDatabase {
  prepare(sql: string): NativeStatement;
  query?(sql: string): NativeStatement;
}

// All calls still execute against the actual native database/statement. Hooks
// place competing SQL at a precise boundary or inject an explicit client fault.
function instrument(db: PlatformDatabase, hooks: Hooks): PlatformDatabase {
  return new Proxy(db, {
    get(target, property) {
      if (property === "exec") {
        return (sql: string) => {
          hooks.exec?.(sql);
          return target.exec(sql);
        };
      }
      if (property === "prepare" || property === "query") {
        return (sql: string) => {
          const native = target as unknown as NativeDatabase;
          const statement =
            property === "query" && native.query !== undefined
              ? native.query(sql)
              : native.prepare(sql);
          return new Proxy(statement, {
            get(statementTarget, method) {
              if (method === "get") {
                return (...parameters: unknown[]) => {
                  const result = statementTarget.get(...parameters);
                  if (sql.includes("SELECT value")) hooks.read?.(parameters);
                  return result;
                };
              }
              if (method === "run") {
                return (...parameters: unknown[]) => {
                  hooks.run?.(sql, parameters);
                  return statementTarget.run(...parameters);
                };
              }
              const member = statementTarget[method as keyof NativeStatement];
              return typeof member === "function"
                ? member.bind(statementTarget)
                : member;
            },
          });
        };
      }
      const member = target[property as keyof PlatformDatabase];
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
}

function busy(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const value = error as {
    code?: unknown;
    errno?: unknown;
    errcode?: unknown;
    message?: unknown;
  };
  return (
    value.code === "SQLITE_BUSY" ||
    value.errno === 5 ||
    value.errcode === 5 ||
    /SQLITE_BUSY|database(?: table)? is locked/i.test(String(value.message))
  );
}

function unlocked(a: PlatformDatabase, b: PlatformDatabase): void {
  for (const db of [a, b]) {
    db.exec("BEGIN IMMEDIATE");
    db.exec("ROLLBACK");
  }
}

function rows(db: PlatformDatabase): unknown[] {
  return db
    .prepare("SELECT key, value, created, expires FROM fedify_kv ORDER BY key")
    .all();
}

for (const journal of ["DELETE", "WAL"] as const) {
  // The shared helper calls synchronous clients on one thread. Bun WAL is
  // intentionally confined to this posture because its pinned engine is old.
  test(`SqliteKvStore atomic conformance (${journal}, independent file handles)`, () =>
    testAtomicKvStore(() => pair(journal), { objectKeyOrder: "ignored" }));

  test(`SqliteKvStore deterministic writer reservation (${journal})`, async () => {
    const fixture = pair(journal);
    try {
      await fixture.first.setMany([
        { key: ["a"], value: 1 },
        { key: ["b"], value: 1 },
      ]);
      fixture.a.exec("PRAGMA busy_timeout=0");
      fixture.b.exec("PRAGMA busy_timeout=0");
      let reads = 0;
      const cutoffs: unknown[] = [];
      const store = new SqliteKvStore(
        instrument(fixture.a, {
          read(parameters) {
            reads++;
            cutoffs.push(parameters[1]);
            assert.throws(() => fixture.b.exec("BEGIN IMMEDIATE"), busy);
          },
        }),
        { initialized: true },
      );
      assert.deepStrictEqual(
        await store.getMany([["a"], ["b"], ["a"]]),
        [1, 1, 1],
      );
      assert.equal(reads, 3, "hook must run between actual per-key reads");
      assert.equal(new Set(cutoffs).size, 1);
      reads = 0;
      assert.equal(
        await store.casMany([
          { key: ["absent-a"], expectedValue: undefined, newValue: 2 },
          { key: ["absent-b"], expectedValue: undefined, newValue: 2 },
        ]),
        true,
      );
      assert.equal(reads, 2);
      unlocked(fixture.a, fixture.b);
      assert.equal(isAtomicKvStore(store), true);
    } finally {
      fixture.dispose();
    }
  });
}

test("SqliteKvStore ordinary conformance", () =>
  testKvStore(
    () => {
      const fixture = pair();
      return Object.assign(fixture.first, { dispose: fixture.dispose });
    },
    ({ store }) => store.dispose(),
  ));

test("SqliteKvStore validates the complete input before SQL, including on mismatch", async () => {
  const fixture = pair();
  try {
    await fixture.first.setMany([
      { key: ["a"], value: 1 },
      { key: ["b"], value: 2 },
    ]);
    const before = rows(fixture.a);
    let statements = 0;
    const store = new SqliteKvStore(
      instrument(fixture.a, {
        exec() {
          statements++;
        },
      }),
      { initialized: true },
    );
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    for (const value of [
      undefined,
      1n,
      cyclic,
      () => 1,
      Symbol("unsupported"),
    ]) {
      await assert.rejects(() =>
        store.setMany([
          { key: ["a"], value: 3 },
          { key: ["b"], value },
        ]),
      );
      if (value !== undefined) {
        await assert.rejects(() =>
          store.casMany([
            { key: ["a"], expectedValue: "mismatch", newValue: 3 },
            { key: ["b"], expectedValue: 2, newValue: value },
          ]),
        );
      }
    }
    const fakeTtl = (total: number) =>
      ({ total: () => total }) as unknown as Temporal.Duration;
    for (const ttl of [
      Temporal.Duration.from({ months: 1 }),
      fakeTtl(NaN),
      fakeTtl(Infinity),
      fakeTtl(8.64e15 + 1),
    ]) {
      await assert.rejects(() =>
        store.setMany([
          { key: ["a"], value: 3 },
          { key: ["b"], value: 4, options: { ttl } },
        ]),
      );
      await assert.rejects(() =>
        store.casMany([
          { key: ["a"], expectedValue: "mismatch", newValue: 3 },
          { key: ["b"], expectedValue: 2, newValue: 4, options: { ttl } },
        ]),
      );
    }
    await assert.rejects(() => store.set(["a"], undefined));
    for (const key of [
      [],
      [1],
      new Array(1),
      "not-an-array",
    ] as unknown as KvKey[]) {
      await assert.rejects(() => store.getMany([["a"], key]));
      await assert.rejects(() => store.deleteMany([["a"], key]));
    }
    for (const operation of [
      () => store.getMany(undefined as unknown as KvKey[]),
      () => store.setMany(undefined as unknown as KvStoreSetEntry[]),
      () => store.deleteMany(undefined as unknown as KvKey[]),
      () => store.casMany(undefined as unknown as KvStoreCasEntry[]),
    ])
      await assert.rejects(operation);
    assert.equal(
      statements,
      0,
      "validation must happen before BEGIN/initialization",
    );
    assert.deepStrictEqual(rows(fixture.a), before);
  } finally {
    fixture.dispose();
  }
});

test("SqliteKvStore empty batches bypass even a closed database", async () => {
  const db = new PlatformDatabase(":memory:");
  db.close();
  const store = new SqliteKvStore(db);
  assert.deepStrictEqual(await store.getMany([]), []);
  await store.setMany([]);
  await store.deleteMany([]);
  assert.equal(await store.casMany([]), true);
});

for (const action of ["ABORT", "ROLLBACK"] as const) {
  for (const operation of ["set", "delete", "cas"] as const) {
    test(`SqliteKvStore rolls back an early ${operation} after RAISE(${action})`, async () => {
      const fixture = pair();
      try {
        const ttl = Temporal.Duration.from({ hours: 1 });
        await fixture.first.setMany([
          { key: ["a"], value: 1, options: { ttl } },
          { key: ["b"], value: 2, options: { ttl } },
        ]);
        const before = rows(fixture.a);
        const event = operation === "set" ? "UPDATE" : "DELETE";
        fixture.a.exec(`CREATE TRIGGER fail_late BEFORE ${event} ON fedify_kv
          WHEN OLD.key = '["b"]' BEGIN SELECT RAISE(${action}, 'atomic injected failure'); END`);
        if (operation === "set") {
          await assert.rejects(
            () =>
              fixture.first.setMany([
                { key: ["a"], value: 3 },
                { key: ["b"], value: 4 },
              ]),
            /atomic injected failure/,
          );
        } else if (operation === "delete") {
          await assert.rejects(
            () => fixture.first.deleteMany([["a"], ["b"]]),
            /atomic injected failure/,
          );
        } else {
          await assert.rejects(
            () =>
              fixture.first.casMany([
                { key: ["a"], expectedValue: 1, newValue: 3 },
                { key: ["b"], expectedValue: 2, newValue: undefined },
              ]),
            /atomic injected failure/,
          );
        }
        assert.deepStrictEqual(rows(fixture.a), before);
        unlocked(fixture.a, fixture.b);
        fixture.a.exec("DROP TRIGGER fail_late");
        await fixture.first.set(["after"], "usable");
      } finally {
        fixture.dispose();
      }
    });
  }
}

test("SqliteKvStore cleanup failure rolls back requested writes; mismatch skips cleanup", async () => {
  const fixture = pair();
  try {
    await fixture.first.set(["a"], 1);
    fixture.a
      .prepare(
        "INSERT INTO fedify_kv(key,value,created,expires) VALUES(?,?,?,?)",
      )
      .run('["expired"]', '"old"', 0, 0);
    fixture.a.exec(`CREATE TRIGGER fail_cleanup BEFORE DELETE ON fedify_kv
      WHEN OLD.key = '["expired"]' BEGIN SELECT RAISE(ABORT, 'cleanup failure'); END`);
    const before = rows(fixture.a);
    assert.equal(await fixture.first.cas(["a"], 0, 2), false);
    assert.deepStrictEqual(rows(fixture.a), before);
    await assert.rejects(() => fixture.first.set(["a"], 2), /cleanup failure/);
    assert.deepStrictEqual(rows(fixture.a), before);
    unlocked(fixture.a, fixture.b);
    fixture.a.exec("DROP TRIGGER fail_cleanup");
    await fixture.first.set(["a"], 3);
  } finally {
    fixture.dispose();
  }
});

test("SqliteKvStore does not roll back caller transactions or poison lazy initialization", async () => {
  const fixture = pair();
  try {
    fixture.a.exec("CREATE TABLE caller(value INTEGER)");
    fixture.a.exec("BEGIN IMMEDIATE");
    fixture.a.exec("INSERT INTO caller VALUES(7)");
    for (const operation of [
      () => fixture.first.cas(["a"], undefined, 1),
      () => fixture.first.getMany([["a"]]),
      () => fixture.first.set(["a"], 1),
      () => fixture.first.delete(["a"]),
    ])
      await assert.rejects(operation, /transaction within a transaction/i);
    assert.equal(
      (fixture.a.prepare("SELECT value FROM caller").get() as { value: number })
        .value,
      7,
    );
    fixture.a.exec("ROLLBACK");
    await fixture.first.set(["a"], 1);
    assert.equal(await fixture.second.get(["a"]), 1);
    unlocked(fixture.a, fixture.b);
  } finally {
    fixture.dispose();
  }
});

test("SqliteKvStore first-use mismatch commits only schema and a missing initialized table releases ownership", async () => {
  const fixture = pair();
  try {
    assert.equal(await fixture.first.cas(["missing"], "wrong", 1), false);
    assert.deepStrictEqual(rows(fixture.a), []);
    unlocked(fixture.a, fixture.b);
    await fixture.first.set(["a"], 1);
    const missing = new SqliteKvStore(fixture.b, {
      tableName: "not_created",
      initialized: true,
    });
    await assert.rejects(() => missing.getMany([["a"]]), /no such table/i);
    unlocked(fixture.a, fixture.b);
  } finally {
    fixture.dispose();
  }
});

test("SqliteKvStore retains the primary exception if rollback itself fails", async () => {
  const db = new PlatformDatabase(":memory:");
  const primary = new Error("commit injection");
  let fail = true;
  const store = new SqliteKvStore(
    instrument(db, {
      exec(sql) {
        if (!fail) return;
        if (sql === "COMMIT") throw primary;
        if (sql === "ROLLBACK") {
          db.exec("ROLLBACK");
          throw new Error("secondary rollback injection");
        }
      },
    }),
  );
  try {
    await assert.rejects(
      () => store.set(["a"], 1),
      (error) => error === primary,
    );
    assert.equal(
      db
        .prepare("SELECT name FROM sqlite_master WHERE name='fedify_kv'")
        .get() == null,
      true,
    );
    db.exec("BEGIN");
    db.exec("ROLLBACK");
    fail = false;
    await store.set(["a"], 2);
    assert.equal(await store.get(["a"]), 2);
  } finally {
    db.close();
  }
});

for (const operation of ["set", "get", "mismatch", "first-mismatch"] as const) {
  test(`SqliteKvStore COMMIT busy rejects and rolls back (${operation})`, async () => {
    const fixture = pair();
    try {
      await fixture.first.set(["a"], 1);
      fixture.a.exec("PRAGMA busy_timeout=0");
      fixture.b.exec("PRAGMA busy_timeout=0");
      let commits = 0;
      const store = new SqliteKvStore(
        instrument(fixture.a, {
          exec(sql) {
            if (sql === "COMMIT") commits++;
          },
        }),
        {
          initialized: operation !== "first-mismatch",
          tableName: operation === "first-mismatch" ? "fresh_kv" : "fedify_kv",
        },
      );
      fixture.b.exec("BEGIN");
      fixture.b.prepare("SELECT value FROM fedify_kv").all();
      try {
        const invoke =
          operation === "set"
            ? () => store.set(["a"], 2)
            : operation === "get"
              ? () => store.getMany([["a"]])
              : () => store.cas(["a"], "wrong", 2);
        await assert.rejects(invoke, busy);
        assert.equal(
          commits,
          1,
          "failure must occur at COMMIT, not an earlier statement",
        );
      } finally {
        fixture.b.exec("ROLLBACK");
      }
      assert.equal(await fixture.first.get(["a"]), 1);
      unlocked(fixture.a, fixture.b);
      if (operation === "first-mismatch") {
        assert.equal(
          fixture.a
            .prepare("SELECT name FROM sqlite_master WHERE name='fresh_kv'")
            .get() == null,
          true,
        );
        assert.equal(await store.cas(["a"], "wrong", 2), false);
      }
    } finally {
      fixture.dispose();
    }
  });
}

test("SqliteKvStore deferred foreign-key failure happens at COMMIT and rolls back every change", async () => {
  const fixture = pair();
  try {
    await fixture.first.set(["a"], 1);
    fixture.a.exec("PRAGMA foreign_keys=ON");
    assert.equal(
      (
        fixture.a.prepare("PRAGMA foreign_keys").get() as {
          foreign_keys: number;
        }
      ).foreign_keys,
      1,
    );
    fixture.a.exec(`CREATE TABLE parent(id INTEGER PRIMARY KEY);
      CREATE TABLE child(id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED);
      CREATE TRIGGER deferred_failure AFTER INSERT ON fedify_kv
      WHEN NEW.key = '["b"]' BEGIN INSERT INTO child VALUES(999); END;`);
    const before = rows(fixture.a);
    let commits = 0;
    const store = new SqliteKvStore(
      instrument(fixture.a, {
        exec(sql) {
          if (sql === "COMMIT") commits++;
        },
      }),
      { initialized: true },
    );
    await assert.rejects(
      () =>
        store.setMany([
          { key: ["a"], value: 2 },
          { key: ["b"], value: 3 },
        ]),
      /FOREIGN KEY constraint failed/i,
    );
    assert.equal(commits, 1);
    assert.deepStrictEqual(rows(fixture.a), before);
    assert.deepStrictEqual(fixture.a.prepare("SELECT * FROM child").all(), []);
    unlocked(fixture.a, fixture.b);
  } finally {
    fixture.dispose();
  }
});

test("SqliteKvStore writable guard changes no rows and fires no row trigger", async () => {
  const fixture = pair();
  try {
    await fixture.first.set(["a"], 1, {
      ttl: Temporal.Duration.from({ hours: 1 }),
    });
    const before = rows(fixture.a);
    const total = fixture.a
      .prepare("SELECT total_changes() AS changes")
      .get() as { changes: number };
    fixture.a.exec(
      "CREATE TRIGGER no_delete BEFORE DELETE ON fedify_kv BEGIN SELECT RAISE(ABORT, 'no row deletion'); END",
    );
    assert.deepStrictEqual(await fixture.first.getMany([["a"], ["a"]]), [1, 1]);
    assert.equal(await fixture.first.cas(["a"], "wrong", 2), false);
    assert.deepStrictEqual(rows(fixture.a), before);
    assert.equal(
      (
        fixture.a.prepare("SELECT total_changes() AS changes").get() as {
          changes: number;
        }
      ).changes,
      total.changes,
    );
  } finally {
    fixture.dispose();
  }
});

test("SqliteKvStore rejects readonly and query_only batches without leaking transactions", async () => {
  const fixture = pair();
  try {
    await fixture.first.set(["a"], 1);
    const options: { readonly?: boolean; readOnly?: boolean } = process.versions
      .bun
      ? { readonly: true }
      : { readOnly: true };
    const readOnly = new PlatformDatabase(fixture.file, options);
    try {
      for (const db of [readOnly, fixture.b]) {
        if (db === fixture.b) db.exec("PRAGMA query_only=ON");
        const store = new SqliteKvStore(db, { initialized: true });
        assert.equal(await store.get(["a"]), 1);
        for (const operation of [
          () => store.getMany([["a"]]),
          () => store.cas(["a"], "wrong", 2),
          () =>
            store.casMany([
              { key: ["a"], expectedValue: "wrong", newValue: 2 },
            ]),
          () => store.set(["a"], 2),
          () => store.deleteMany([["a"]]),
        ]) {
          await assert.rejects(
            operation,
            /readonly|read-only|SQLITE_READONLY/i,
          );
          db.exec("BEGIN");
          db.exec("ROLLBACK");
        }
        if (db === fixture.b) db.exec("PRAGMA query_only=OFF");
      }
    } finally {
      readOnly.close();
    }
    assert.equal(await fixture.first.get(["a"]), 1);
  } finally {
    fixture.dispose();
  }
});

test("SqliteKvStore one expiry cutoff, boundaries, fractional TTL, clearing, and codec expectations", async () => {
  const fixture = pair();
  const clock = globalThis.Temporal.Now;
  const original = Object.getOwnPropertyDescriptor(clock, "instant")!;
  const now = clock.instant().epochMilliseconds;
  Object.defineProperty(clock, "instant", {
    ...original,
    value: () => globalThis.Temporal.Instant.fromEpochMilliseconds(now),
  });
  try {
    await fixture.first.setMany([
      {
        key: ["a"],
        value: { nested: { a: 1, b: 2 } },
        options: { ttl: Temporal.Duration.from({ microseconds: 1500 }) },
      },
      {
        key: ["b"],
        value: null,
        options: { ttl: Temporal.Duration.from({ milliseconds: 10 }) },
      },
      {
        key: ["zero"],
        value: 1,
        options: { ttl: Temporal.Duration.from({ milliseconds: 0 }) },
      },
      {
        key: ["negative"],
        value: 1,
        options: { ttl: Temporal.Duration.from({ milliseconds: -1 }) },
      },
    ]);
    const record = fixture.a
      .prepare("SELECT created,expires FROM fedify_kv WHERE key=?")
      .get('["a"]') as { created: number; expires: number };
    assert.equal(record.created, now);
    assert.equal(record.expires, now + 1.5);
    assert.deepStrictEqual(
      await fixture.second.getMany([["zero"], ["negative"]]),
      [undefined, undefined],
    );
    fixture.a
      .prepare(
        "INSERT INTO fedify_kv(key,value,created,expires) VALUES(?,?,?,?)",
      )
      .run('["boundary"]', '"old"', 0, now);
    assert.deepStrictEqual(await fixture.second.getMany([["boundary"]]), [
      undefined,
    ]);
    assert.equal(await fixture.first.cas(["boundary"], "old", 1), false);
    assert.equal(
      (
        fixture.a
          .prepare("SELECT COUNT(*) AS count FROM fedify_kv WHERE key=?")
          .get('["boundary"]') as { count: number }
      ).count,
      1,
    );
    assert.equal(await fixture.first.cas(["boundary"], undefined, 2), true);
    assert.equal(await fixture.second.get(["boundary"]), 2);
    assert.equal(
      await fixture.first.cas(["a"], { nested: { b: 2, a: 1 } }, 3),
      true,
    );
    const after = fixture.a
      .prepare("SELECT created,expires FROM fedify_kv WHERE key=?")
      .get('["a"]') as { created: number; expires: number | null };
    assert.equal(after.created, now);
    assert.equal(after.expires, null);
    const date = new Date("2020-01-01T00:00:00Z");
    await fixture.first.set(["date"], date);
    assert.equal(await fixture.first.cas(["date"], date, 1), false);
    assert.equal(await fixture.first.cas(["date"], date.toJSON(), 1), true);
    await fixture.first.set(["object"], { omitted: undefined });
    assert.equal(
      await fixture.first.cas(["object"], { omitted: undefined }, 1),
      false,
    );
    assert.equal(await fixture.first.cas(["object"], {}, 1), true);
  } finally {
    Object.defineProperty(clock, "instant", original);
    fixture.dispose();
  }
});

test("SqliteKvStore expiry overflow rejects before comparisons or mutation", async () => {
  const fixture = pair();
  const clock = globalThis.Temporal.Now;
  const original = Object.getOwnPropertyDescriptor(clock, "instant")!;
  try {
    await fixture.first.set(["a"], 1);
    Object.defineProperty(clock, "instant", {
      ...original,
      value: () => globalThis.Temporal.Instant.fromEpochMilliseconds(8.64e15),
    });
    const ttl = { total: () => 8.64e15 } as unknown as Temporal.Duration;
    await assert.rejects(
      () =>
        fixture.first.casMany([
          { key: ["a"], expectedValue: "wrong", newValue: 2 },
          {
            key: ["b"],
            expectedValue: undefined,
            newValue: 3,
            options: { ttl },
          },
        ]),
      RangeError,
    );
    assert.equal(await fixture.first.get(["a"]), 1);
    unlocked(fixture.a, fixture.b);
  } finally {
    Object.defineProperty(clock, "instant", original);
    fixture.dispose();
  }
});

test("SqliteKvStore 33000-entry batches use fixed parameters and one commit each", async () => {
  const fixture = pair();
  try {
    let begins = 0;
    let commits = 0;
    let writes = 0;
    let reads = 0;
    let deletes = 0;
    const store = new SqliteKvStore(
      instrument(fixture.a, {
        exec(sql) {
          if (sql === "BEGIN IMMEDIATE") begins++;
          if (sql === "COMMIT") commits++;
        },
        read(parameters) {
          reads++;
          assert.equal(parameters.length, 2);
        },
        run(sql, parameters) {
          if (sql.includes("INSERT INTO")) {
            writes++;
            assert.equal(parameters.length, 4);
          }
          if (sql.includes("WHERE key = ?") && sql.includes("DELETE")) {
            deletes++;
            assert.equal(parameters.length, 1);
          }
        },
      }),
    );
    const entries = Array.from({ length: 33000 }, (_, index) => ({
      key: [String(index)] as KvKey,
      value: index,
    }));
    const keys = entries.map((entry) => entry.key);
    await store.setMany(entries);
    assert.equal(begins, 1);
    assert.equal(commits, 1);
    assert.equal(writes, entries.length);
    assert.deepStrictEqual(
      await store.getMany(keys),
      entries.map((entry) => entry.value),
    );
    assert.equal(begins, 2);
    assert.equal(commits, 2);
    assert.equal(reads, entries.length);
    assert.equal(
      await store.casMany(
        entries.map((entry) => ({
          key: entry.key,
          expectedValue: entry.value,
          newValue: entry.value + 1,
        })),
      ),
      true,
    );
    assert.equal(begins, 3);
    assert.equal(commits, 3);
    assert.equal(reads, entries.length * 2);
    assert.equal(writes, entries.length * 2);
    assert.deepStrictEqual(
      await fixture.second.getMany([keys[32999], keys[0], ["missing"]]),
      [33000, 1, undefined],
    );
    await store.deleteMany(keys);
    assert.equal(begins, 4);
    assert.equal(commits, 4);
    assert.equal(deletes, entries.length);
    assert.deepStrictEqual(rows(fixture.a), []);
  } finally {
    fixture.dispose();
  }
});

test("SqliteKvStore atomic changes persist after all handles close and the file reopens", async () => {
  const directory = mkdtempSync(join(tmpdir(), "fedify-sqlite-reopen-"));
  const file = join(directory, "kv.sqlite");
  try {
    const first = new PlatformDatabase(file);
    try {
      const store = new SqliteKvStore(first);
      await store.setMany([
        { key: ["a"], value: 1 },
        { key: ["b"], value: 2 },
      ]);
      assert.equal(
        await store.casMany([
          { key: ["a"], expectedValue: 1, newValue: 3 },
          { key: ["b"], expectedValue: 2, newValue: undefined },
        ]),
        true,
      );
    } finally {
      first.close();
    }
    const reopened = new PlatformDatabase(file);
    try {
      assert.deepStrictEqual(
        await new SqliteKvStore(reopened).getMany([["a"], ["b"]]),
        [3, undefined],
      );
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
