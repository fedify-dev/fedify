// Transaction schedules and lifecycle cleanup must run sequentially.
/* oxlint-disable eslint/no-await-in-loop */
import {
  isAtomicKvStore,
  type KvKey,
  type KvStoreCasEntry,
  type KvStoreSetEntry,
} from "@fedify/fedify";
import { MysqlKvStore } from "@fedify/mysql/kv";
import { testAtomicKvStore, testKvStore } from "@fedify/testing";
import * as temporal from "@js-temporal/polyfill";
import assert from "node:assert/strict";
import process from "node:process";
import { test } from "node:test";
import mysql from "mysql2/promise";

const Temporal = globalThis.Temporal ?? temporal.Temporal;
const dbUrl = process.env.MYSQL_URL;
const live = { skip: dbUrl == null, timeout: 180_000 };
const stamp = (): string => `atomic_${crypto.randomUUID().replace(/-/g, "")}`;
const key = (value: string): KvKey => [value];

async function pair(isolation?: string) {
  const firstPool = mysql.createPool(dbUrl!);
  const secondPool = mysql.createPool(dbUrl!);
  const tableName = stamp();
  const wrap = (pool: mysql.Pool) => ({
    query: pool.query.bind(pool),
    async getConnection() {
      const conn = await pool.getConnection();
      if (isolation != null)
        await conn.query(
          `SET SESSION TRANSACTION ISOLATION LEVEL ${isolation}`,
        );
      return conn;
    },
  });
  const first = new MysqlKvStore(wrap(firstPool), {
    tableName,
    expireCleanupRate: 0,
  });
  const second = new MysqlKvStore(wrap(secondPool), {
    tableName,
    expireCleanupRate: 0,
  });
  const dispose = async () => {
    try {
      await first.drop();
    } finally {
      await Promise.all([firstPool.end(), secondPool.end()]);
    }
  };
  try {
    await first.initialize();
    await second.initialize();
    return { first, second, firstPool, secondPool, tableName, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

test("MysqlKvStore AtomicKvStore conformance", live, async () => {
  for (const isolation of [undefined, "READ COMMITTED", "READ UNCOMMITTED"]) {
    await testAtomicKvStore(() => pair(isolation), {
      objectKeyOrder: "ignored",
    });
  }
});

test("MysqlKvStore ordinary KV conformance", live, async () => {
  const p = await pair();
  await testKvStore(
    () => p.first,
    () => p.dispose(),
  );
});

test("MysqlKvStore validates complete batches before I/O", async () => {
  const store = new MysqlKvStore({
    query() {
      throw new Error("Unexpected I/O");
    },
    getConnection() {
      throw new Error("Unexpected I/O");
    },
  } as unknown as mysql.Pool);
  assert.ok(isAtomicKvStore(store));
  const k = key("a");
  await assert.rejects(store.set(k, undefined), TypeError);
  await assert.rejects(
    store.setMany([
      { key: k, value: 1 },
      { key: k, value: 2 },
    ]),
    TypeError,
  );
  await assert.rejects(store.deleteMany([k, k]), TypeError);
  await assert.rejects(
    store.casMany([
      { key: k, expectedValue: "mismatch", newValue: 2 },
      { key: k, expectedValue: undefined, newValue: 1 },
    ]),
    TypeError,
  );
  await assert.rejects(
    store.cas(k, "mismatch", undefined, {
      ttl: Temporal.Duration.from({ seconds: 1 }),
    }),
    TypeError,
  );
  await assert.rejects(
    store.setMany([
      { key: k, value: 1 },
      { key: key("b"), value: undefined },
    ]),
    TypeError,
  );
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  for (const value of [undefined, () => 1, Symbol("bad"), 1n, cycle]) {
    await assert.rejects(store.set(k, value), TypeError);
  }
  for (const entries of [new Array(1), [k, , k]]) {
    await assert.rejects(store.getMany(entries as KvKey[]), TypeError);
    await assert.rejects(store.deleteMany(entries as KvKey[]), TypeError);
  }
  await assert.rejects(store.setMany(new Array<KvStoreSetEntry>(2)), TypeError);
  await assert.rejects(store.casMany(new Array<KvStoreCasEntry>(2)), TypeError);
  await assert.rejects(
    store.getMany(Array.from({ length: 1001 }, () => k)),
    RangeError,
  );
  const oversized = Array.from({ length: 1001 }, (_, i) => key(String(i)));
  await assert.rejects(
    store.setMany(oversized.map((key) => ({ key, value: 1 }))),
    RangeError,
  );
  await assert.rejects(store.deleteMany(oversized), RangeError);
  await assert.rejects(
    store.casMany(
      oversized.map((key) => ({ key, expectedValue: undefined, newValue: 1 })),
    ),
    RangeError,
  );
  await assert.rejects(store.set(["x".repeat(765)], 1), RangeError);
  await assert.rejects(
    store.cas(k, "mismatch", 1, {
      ttl: Temporal.Duration.from({ years: 1000 }),
    }),
    RangeError,
  );
  assert.deepEqual(await store.getMany([]), []);
  await store.setMany([]);
  await store.deleteMany([]);
  assert.equal(await store.casMany([]), true);
});

test(
  "MysqlKvStore rolls back real writes and retains expiry on a later failure",
  live,
  async () => {
    const p = await pair();
    try {
      await p.first.setMany([
        {
          key: key("a"),
          value: 1,
          options: { ttl: Temporal.Duration.from({ hours: 1 }) },
        },
        { key: key("b"), value: 2 },
      ]);
      const [before] = await p.firstPool.query<mysql.RowDataPacket[]>(
        `SELECT DATE_FORMAT(expires, '%Y-%m-%d %H:%i:%s.%f') AS expires FROM \`${p.tableName}\` WHERE \`key\`=?`,
        [JSON.stringify(key("a"))],
      );
      let writes = 0;
      let mutation = "INSERT";
      const failing = new MysqlKvStore(
        {
          query: p.firstPool.query.bind(p.firstPool),
          async getConnection() {
            const conn = await p.firstPool.getConnection();
            return {
              async query<T>(
                sql: string,
                values?: unknown,
              ): Promise<[T, unknown]> {
                if (sql.startsWith(mutation) && ++writes === 2)
                  throw new Error("injected second write");
                return (await conn.query(sql, parameters(values))) as [
                  T,
                  unknown,
                ];
              },
              beginTransaction: conn.beginTransaction.bind(conn),
              commit: conn.commit.bind(conn),
              rollback: conn.rollback.bind(conn),
              release: conn.release.bind(conn),
              destroy: conn.destroy.bind(conn),
            };
          },
        },
        { tableName: p.tableName, initialized: true, expireCleanupRate: 0 },
      );
      await assert.rejects(
        failing.setMany([
          { key: key("a"), value: 10 },
          { key: key("b"), value: 20 },
        ]),
        /injected second write/,
      );
      assert.deepEqual(await p.second.getMany([key("a"), key("b")]), [1, 2]);
      writes = 0;
      await assert.rejects(
        failing.casMany([
          { key: key("a"), expectedValue: 1, newValue: 10 },
          { key: key("b"), expectedValue: 2, newValue: 20 },
        ]),
        /injected second write/,
      );
      writes = 0;
      mutation = "DELETE";
      await assert.rejects(
        failing.deleteMany([key("a"), key("b")]),
        /injected second write/,
      );
      assert.deepEqual(await p.second.getMany([key("a"), key("b")]), [1, 2]);
      const [after] = await p.firstPool.query<mysql.RowDataPacket[]>(
        `SELECT DATE_FORMAT(expires, '%Y-%m-%d %H:%i:%s.%f') AS expires FROM \`${p.tableName}\` WHERE \`key\`=?`,
        [JSON.stringify(key("a"))],
      );
      assert.deepEqual(after, before);
    } finally {
      await p.dispose();
    }
  },
);

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test(
  "MysqlKvStore holds an absent range even for a CAS that never inserts that key",
  live,
  async () => {
    const p = await pair();
    const locked = gate();
    const resume = gate();
    let operation: Promise<boolean> | undefined;
    let writer: Promise<void> | undefined;
    try {
      await p.first.set(key("b"), 1);
      const paused = new MysqlKvStore(
        {
          query: p.firstPool.query.bind(p.firstPool),
          async getConnection() {
            const conn = await p.firstPool.getConnection();
            return {
              async query<T>(
                sql: string,
                values?: unknown,
              ): Promise<[T, unknown]> {
                if (sql.startsWith("SELECT DATE_FORMAT(NOW")) {
                  locked.resolve();
                  await resume.promise;
                }
                return (await conn.query(sql, parameters(values))) as [
                  T,
                  unknown,
                ];
              },
              beginTransaction: conn.beginTransaction.bind(conn),
              commit: conn.commit.bind(conn),
              rollback: conn.rollback.bind(conn),
              release: conn.release.bind(conn),
              destroy: conn.destroy.bind(conn),
            };
          },
        },
        { tableName: p.tableName, initialized: true, expireCleanupRate: 0 },
      );
      operation = paused.casMany([
        { key: key("a"), expectedValue: undefined, newValue: undefined },
        { key: key("b"), expectedValue: 1, newValue: 2 },
      ]);
      await Promise.race([locked.promise, operation]);
      let settled = false;
      writer = p.second.set(key("a"), "writer").finally(() => {
        settled = true;
      });
      await new Promise((done) => setTimeout(done, 300));
      assert.equal(
        settled,
        false,
        "independent writer must wait for the absent-range lock",
      );
      const [processes] = await p.firstPool.query<mysql.RowDataPacket[]>(
        "SHOW FULL PROCESSLIST",
      );
      assert.ok(
        processes.some((row) =>
          String(row.Info).includes(`INSERT INTO \`${p.tableName}\``),
        ),
        "writer query must actually have reached the server",
      );
      resume.resolve();
      assert.equal(await operation, true);
      await writer;
      assert.deepEqual(await p.first.getMany([key("a"), key("b")]), [
        "writer",
        2,
      ]);
    } finally {
      resume.resolve();
      await Promise.allSettled([operation, writer]);
      await p.dispose();
    }
  },
);

test(
  "MysqlKvStore one-slot pools release before cleanup and keep committed success on cleanup failure",
  live,
  async () => {
    const pool = mysql.createPool({ uri: dbUrl!, connectionLimit: 1 });
    const tableName = stamp();
    const store = new MysqlKvStore(pool, { tableName });
    try {
      await store.set(key("a"), 1, {
        ttl: Temporal.Duration.from({ hours: 1 }),
      });
      assert.equal(
        await store.casMany([{ key: key("a"), expectedValue: 1, newValue: 2 }]),
        true,
      );
      const brokenCleanup = new MysqlKvStore(
        {
          async query<T>(sql: string, values?: unknown): Promise<[T, unknown]> {
            if (sql.startsWith("DELETE") && sql.includes("NOW(6)"))
              throw new Error("cleanup failure");
            return (await pool.query(sql, parameters(values))) as [T, unknown];
          },
          getConnection: pool.getConnection.bind(pool),
        },
        { tableName, initialized: true },
      );
      await brokenCleanup.set(key("a"), 3);
      assert.equal(await store.get(key("a")), 3);
    } finally {
      await store.drop();
      await pool.end();
    }
  },
);

test(
  "MysqlKvStore rejects incompatible precreated tables without altering them",
  live,
  async () => {
    const p = await pair();
    const names: string[] = [];
    try {
      for (const definition of [
        {
          engine: "MyISAM",
          value: "JSON NOT NULL",
          primary: "PRIMARY KEY (`key`(100))",
          expiry: "DATETIME(6) NULL",
        },
        {
          engine: "InnoDB",
          value: "LONGTEXT CHARACTER SET latin1 NOT NULL",
          primary: "PRIMARY KEY (`key`)",
          expiry: "DATETIME(6) NULL",
        },
        {
          engine: "InnoDB",
          value: "LONGTEXT CHARACTER SET utf8mb3 NOT NULL",
          primary: "PRIMARY KEY (`key`)",
          expiry: "DATETIME(6) NULL",
        },
        {
          engine: "InnoDB",
          value: "JSON NOT NULL",
          primary: "PRIMARY KEY (`key`(100))",
          expiry: "DATETIME(6) NULL",
        },
        {
          engine: "InnoDB",
          value: "JSON NOT NULL",
          primary: "PRIMARY KEY (`key`), UNIQUE (expires)",
          expiry: "DATETIME(6) NULL",
        },
        {
          engine: "InnoDB",
          value: "JSON NOT NULL",
          primary: "PRIMARY KEY (`key`)",
          expiry: "DATETIME(6) NOT NULL",
        },
      ]) {
        const name = stamp();
        names.push(name);
        await p.firstPool.query(
          `CREATE TABLE \`${name}\` (\`key\` VARCHAR(768) NOT NULL, value ${definition.value}, expires ${definition.expiry}, ${definition.primary}) ENGINE=${definition.engine} DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
        );
        const [before] = await p.firstPool.query(
          `SHOW CREATE TABLE \`${name}\``,
        );
        for (const initialized of [true, false]) {
          const store = new MysqlKvStore(p.firstPool, {
            tableName: name,
            initialized,
          });
          await assert.rejects(store.set(key("a"), 1), TypeError);
        }
        const [after] = await p.firstPool.query(
          `SHOW CREATE TABLE \`${name}\``,
        );
        assert.deepEqual(
          after,
          before,
          "rejection must not alter an existing schema",
        );
        const [rows] = await p.firstPool.query<mysql.RowDataPacket[]>(
          `SELECT COUNT(*) AS count FROM \`${name}\``,
        );
        assert.equal(Number(rows[0].count), 0);
      }
    } finally {
      for (const name of names)
        await p.firstPool.query(`DROP TABLE IF EXISTS \`${name}\``);
      await p.dispose();
    }
  },
);

test(
  "MysqlKvStore JSON, Unicode key boundary, TTL precision and raw expected semantics",
  live,
  async () => {
    const p = await pair();
    try {
      const boundary: KvKey = ["😀".repeat(764)]; // Four JSON punctuation characters.
      assert.equal([...JSON.stringify(boundary)].length, 768);
      await p.first.set(boundary, {
        text: "🦄한글",
        nested: [null, '"json"', 0.1],
      });
      assert.deepEqual(await p.second.get(boundary), {
        text: "🦄한글",
        nested: [null, '"json"', 0.1],
      });
      await assert.rejects(p.first.set(["😀".repeat(765)], 1), RangeError);
      const listed = [];
      for await (const entry of p.second.list()) listed.push(entry.value);
      assert.deepEqual(listed, [
        { text: "🦄한글", nested: [null, '"json"', 0.1] },
      ]);
      const date = new Date("2020-01-01T00:00:00Z");
      await p.first.set(key("date"), date);
      assert.equal(await p.first.cas(key("date"), date, 1), false);
      assert.equal(await p.first.cas(key("date"), date.toJSON(), 1), true);
      await p.first.set(key("micro"), 1, {
        ttl: Temporal.Duration.from({ microseconds: 500001, nanoseconds: 999 }),
      });
      await p.first.set(key("micro"), 2);
      const [rows] = await p.firstPool.query<mysql.RowDataPacket[]>(
        `SELECT expires FROM \`${p.tableName}\` WHERE \`key\`=?`,
        [JSON.stringify(key("micro"))],
      );
      assert.equal(rows[0].expires, null);
      await p.first.set(key("zero"), 1, {
        ttl: Temporal.Duration.from({ nanoseconds: 999 }),
      });
      assert.equal(await p.second.get(key("zero")), undefined);
    } finally {
      await p.dispose();
    }
  },
);

interface FakeOptions {
  query?: (sql: string, values: unknown, attempt: number) => unknown[] | void;
  begin?: () => void;
  commit?: () => void;
  rollback?: () => void;
  metadata?: (sql: string) => unknown[] | undefined;
}

function fakePool(options: FakeOptions = {}) {
  const events: string[] = [];
  let attempts = 0;
  const pool = {
    query<T>(sql: string): Promise<[T, unknown]> {
      events.push(`pool:${sql}`);
      let rows = options.metadata?.(sql);
      if (rows == null) {
        if (sql.includes("information_schema.TABLES"))
          rows = [{ engine: "InnoDB", table_type: "BASE TABLE" }];
        else if (sql.includes("information_schema.COLUMNS"))
          rows = [
            {
              name: "key",
              type: "varchar",
              nullable: "NO",
              length: 768,
              charset: "utf8mb4",
              collation: "utf8mb4_bin",
            },
            { name: "value", type: "json", nullable: "NO", charset: null },
            {
              name: "expires",
              type: "datetime",
              nullable: "YES",
              precision: 6,
            },
          ];
        else if (sql.includes("information_schema.STATISTICS"))
          rows = [
            {
              name: "PRIMARY",
              column_name: "key",
              position: 1,
              prefix: null,
              type: "BTREE",
            },
          ];
        else rows = [];
      }
      return Promise.resolve<[T, unknown]>([rows as T, undefined]);
    },
    getConnection() {
      const attempt = ++attempts;
      events.push("acquire");
      return Promise.resolve({
        query<T>(sql: string, values?: unknown): Promise<[T, unknown]> {
          events.push(sql);
          let rows = options.query?.(sql, values, attempt);
          if (rows == null)
            rows = sql.startsWith("SELECT DATE_FORMAT(NOW")
              ? [{ cutoff: "2026-11-12 12:00:00.123456" }]
              : [];
          return Promise.resolve<[T, unknown]>([rows as T, undefined]);
        },
        beginTransaction() {
          events.push("begin");
          options.begin?.();
          return Promise.resolve();
        },
        commit() {
          events.push("commit");
          options.commit?.();
          return Promise.resolve();
        },
        rollback() {
          events.push("rollback");
          options.rollback?.();
          return Promise.resolve();
        },
        release() {
          events.push("release");
        },
        destroy() {
          events.push("destroy");
        },
      });
    },
  };
  return {
    pool,
    events,
    get attempts() {
      return attempts;
    },
  };
}

for (const conflict of [1213, 1020]) {
  test(`MysqlKvStore retries ${conflict} from a fresh transaction and rechecks expectations`, async () => {
    const f = fakePool({
      query(sql, _values, attempt) {
        if (sql.includes("FOR UPDATE")) {
          if (attempt === 1)
            throw Object.assign(new Error("retry conflict"), {
              errno: conflict,
            });
          return [{ key: '["a"]', value: '"winner"', expires: null }];
        }
      },
    });
    const store = new MysqlKvStore(f.pool, {
      initialized: true,
      expireCleanupRate: 0,
    });
    assert.equal(await store.cas(key("a"), undefined, "loser"), false);
    assert.equal(f.attempts, 2);
    assert.equal(
      f.events.filter(
        (e) => e === "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ",
      ).length,
      2,
    );
    assert.equal(f.events.filter((e) => e === "rollback").length, 2);
    assert.equal(f.events.filter((e) => e === "release").length, 2);
    assert.ok(f.events.indexOf("release") < f.events.lastIndexOf("acquire"));
    assert.equal(
      f.events.some((e) => e.startsWith("INSERT")),
      false,
    );
  });
}

test("MysqlKvStore bounds conflict retries and rejects lock timeouts without retry", async () => {
  for (const errno of [1213, 1020, 1205]) {
    const problem = Object.assign(new Error(`server ${errno}`), { errno });
    const f = fakePool({
      query(sql) {
        if (sql.startsWith("INSERT")) throw problem;
      },
    });
    const store = new MysqlKvStore(f.pool, {
      initialized: true,
      expireCleanupRate: 0,
    });
    await assert.rejects(store.set(key("a"), 1), (error) => error === problem);
    assert.equal(f.attempts, errno === 1205 ? 1 : 5);
    assert.equal(f.events.filter((e) => e === "rollback").length, f.attempts);
    assert.equal(f.events.filter((e) => e === "release").length, f.attempts);
    assert.equal(f.events.includes("destroy"), false);
  }
});

test("MysqlKvStore preserves rollback errors and discards poisoned connections", async () => {
  const primary = new Error("write failure"),
    rollback = new Error("rollback failure");
  const f = fakePool({
    query(sql) {
      if (sql.startsWith("INSERT")) throw primary;
    },
    rollback() {
      throw rollback;
    },
  });
  await assert.rejects(
    new MysqlKvStore(f.pool, { initialized: true }).set(key("a"), 1),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [primary, rollback]);
      return true;
    },
  );
  assert.equal(f.attempts, 1);
  assert.ok(f.events.includes("destroy"));
  assert.equal(f.events.includes("release"), false);
});

test("MysqlKvStore does not retry an ambiguous commit, failed setup or mismatch rollback", async () => {
  const fault = new Error("connection failure");
  for (const mode of [
    "commit",
    "begin",
    "isolation",
    "mismatch-rollback",
  ] as const) {
    const f = fakePool({
      query(sql) {
        if (mode === "isolation" && sql.startsWith("SET TRANSACTION"))
          throw fault;
        if (mode === "mismatch-rollback" && sql.includes("FOR UPDATE"))
          return [{ key: '["a"]', value: "1", expires: null }];
      },
      begin() {
        if (mode === "begin") throw fault;
      },
      commit() {
        if (mode === "commit") throw fault;
      },
      rollback() {
        if (mode === "mismatch-rollback") throw fault;
      },
    });
    const store = new MysqlKvStore(f.pool, {
      initialized: true,
      expireCleanupRate: 0,
    });
    const call =
      mode === "mismatch-rollback"
        ? store.cas(key("a"), undefined, 2)
        : store.set(key("a"), 1);
    await assert.rejects(call, (error) => error === fault);
    assert.equal(f.attempts, 1);
    assert.ok(f.events.includes("destroy"));
    assert.equal(f.events.includes("release"), false);
    if (mode === "commit") assert.equal(f.events.includes("rollback"), false);
  }
});

test("MysqlKvStore locks sorted physical keys before one cutoff and compares everything before writes", async () => {
  const locks: unknown[] = [];
  const writes: unknown[] = [];
  const f = fakePool({
    query(sql, values) {
      if (sql.includes("FOR UPDATE")) {
        assert.equal(sql.includes("expires` >"), false);
        locks.push((values as string[])[0]);
        return [
          {
            key: (values as string[])[0],
            value: "1",
            expires: "2026-11-12 12:00:00.123456",
          },
        ];
      }
      if (sql.startsWith("INSERT")) writes.push(values);
    },
  });
  const store = new MysqlKvStore(f.pool, {
    initialized: true,
    expireCleanupRate: 0,
  });
  assert.equal(
    await store.casMany([
      { key: key("b"), expectedValue: undefined, newValue: 2 },
      { key: key("a"), expectedValue: undefined, newValue: 3 },
    ]),
    true,
  );
  assert.deepEqual(locks, ['["a"]', '["b"]']);
  assert.equal(
    f.events.filter((e) => e.startsWith("SELECT DATE_FORMAT(NOW")).length,
    1,
  );
  assert.ok(
    f.events.findIndex((e) => e.startsWith("SELECT DATE_FORMAT(NOW")) >
      f.events.findLastIndex((e) => e.includes("FOR UPDATE")),
  );
  assert.equal(writes.length, 2);
});

test("MysqlKvStore validates derived TTLs even on mismatch and truncates microseconds", async () => {
  let captured: unknown;
  const f = fakePool({
    query(sql, values) {
      if (sql.includes("FOR UPDATE"))
        return [{ key: '["a"]', value: "1", expires: null }];
      if (sql.startsWith("SELECT DATE_FORMAT(DATE_ADD")) {
        captured = values;
        return [{ e0: null }];
      }
    },
  });
  const store = new MysqlKvStore(f.pool, {
    initialized: true,
    expireCleanupRate: 0,
  });
  await assert.rejects(
    store.cas(key("a"), "mismatch", 2, {
      ttl: Temporal.Duration.from({ microseconds: 10, nanoseconds: 999 }),
    }),
    RangeError,
  );
  assert.deepEqual(captured, ["2026-11-12 12:00:00.123456", 10]);
  assert.equal(
    f.events.some((e) => e.startsWith("INSERT")),
    false,
  );
  assert.ok(f.events.includes("rollback"));
});

test("MysqlKvStore retries initialization after failure and invalidates after failed drop", async () => {
  let failInitialization = true,
    failDrop = false;
  const problem = new Error("metadata unavailable");
  const f = fakePool({
    metadata(sql) {
      if (sql.includes("information_schema.TABLES") && failInitialization) {
        failInitialization = false;
        throw problem;
      }
      if (sql.startsWith("DROP") && failDrop) throw problem;
    },
  });
  const store = new MysqlKvStore(f.pool, {
    initialized: true,
    expireCleanupRate: 0,
  });
  await assert.rejects(store.initialize(), (error) => error === problem);
  await Promise.all([store.initialize(), store.initialize()]);
  assert.equal(
    f.events.filter((e) => e.includes("information_schema.TABLES")).length,
    2,
  );
  assert.equal(
    f.events.some((e) => e.startsWith("pool:CREATE")),
    false,
  );
  failDrop = true;
  await assert.rejects(store.drop(), (error) => error === problem);
  await store.initialize();
  assert.equal(
    f.events.filter((e) => e.includes("information_schema.TABLES")).length,
    3,
  );
  assert.ok(f.events.some((e) => e.startsWith("pool:CREATE TABLE")));
});

test("MysqlKvStore rejects unsafe gap configuration and accepts compatible JSON alias metadata", async () => {
  const unsafe = fakePool({
    metadata(sql) {
      if (sql.startsWith("SHOW VARIABLES")) return [{ Value: "ON" }];
    },
  });
  await assert.rejects(
    new MysqlKvStore(unsafe.pool, { initialized: true }).initialize(),
    /gap locking/,
  );
  const valid = fakePool({
    metadata(sql) {
      if (sql.includes("information_schema.COLUMNS"))
        return [
          {
            name: "key",
            type: "varchar",
            nullable: "NO",
            length: 768,
            charset: "utf8mb4",
            collation: "utf8mb4_bin",
          },
          {
            name: "value",
            type: "longtext",
            nullable: "NO",
            charset: "utf8mb4",
          },
          { name: "expires", type: "datetime", nullable: "YES", precision: 6 },
        ];
    },
  });
  await new MysqlKvStore(valid.pool, { initialized: true }).initialize();
});

test(
  "MysqlKvStore distinct absent-key contention has bounded, all-or-nothing outcomes",
  live,
  async () => {
    const p = await pair();
    try {
      for (const count of [4, 16]) {
        const pools = Array.from({ length: count }, () =>
          mysql.createPool(dbUrl!),
        );
        const stores = pools.map(
          (pool) =>
            new MysqlKvStore(pool, {
              tableName: p.tableName,
              initialized: true,
              expireCleanupRate: 0,
            }),
        );
        const keys = stores.map((_, i) => key(`contender-${i}`));
        try {
          await Promise.all(stores.map((store) => store.initialize()));
          const results = await Promise.allSettled(
            stores.map((store, i) => store.cas(keys[i], undefined, i)),
          );
          const expected = results.map((result, i) => {
            if (result.status === "fulfilled") {
              assert.equal(result.value, true);
              return i;
            }
            assert.ok(
              [1213, 1020].includes(result.reason?.errno),
              "only documented conflict exhaustion may reject",
            );
            return undefined;
          });
          if (count === 4)
            assert.equal(
              results.every((r) => r.status === "fulfilled"),
              true,
            );
          assert.ok(results.some((r) => r.status === "fulfilled"));
          assert.deepEqual(await p.first.getMany(keys), expected);
          await p.first.deleteMany(keys);
        } finally {
          await Promise.all(pools.map((pool) => pool.end()));
        }
      }
    } finally {
      await p.dispose();
    }
  },
);

function parameters(value: unknown) {
  if (value !== undefined && !Array.isArray(value))
    throw new TypeError("Expected adapter query parameters.");
  return value;
}

test(
  "MysqlKvStore accepts the batch boundary and rejects oversized operations without partial writes",
  live,
  async () => {
    const p = await pair();
    try {
      const keys = Array.from({ length: 1000 }, (_, i) => key(`limit-${i}`));
      await p.first.setMany(keys.map((key, i) => ({ key, value: i })));
      assert.deepEqual(
        await p.second.getMany(keys),
        keys.map((_, i) => i),
      );
      const over = [...keys, key("overflow")];
      await assert.rejects(p.first.getMany(over), RangeError);
      await assert.rejects(
        p.first.setMany(over.map((key) => ({ key, value: "changed" }))),
        RangeError,
      );
      await assert.rejects(p.first.deleteMany(over), RangeError);
      await assert.rejects(
        p.first.casMany(
          over.map((key, i) => ({
            key,
            expectedValue: i < 1000 ? i : undefined,
            newValue: "changed",
          })),
        ),
        RangeError,
      );
      assert.deepEqual(
        await p.second.getMany(keys),
        keys.map((_, i) => i),
      );
      assert.equal(await p.second.get(key("overflow")), undefined);
      await p.first.deleteMany(keys);
      assert.deepEqual(
        await p.second.getMany(keys),
        keys.map(() => undefined),
      );
    } finally {
      await p.dispose();
    }
  },
);

test(
  "MysqlKvStore metadata respects mixed-case names and case-sensitive twins",
  live,
  async () => {
    const pool = mysql.createPool(dbUrl!);
    const name = `Atomic_${crypto.randomUUID().replace(/-/g, "")}`;
    const mixed = new MysqlKvStore(pool, {
      tableName: name,
      expireCleanupRate: 0,
    });
    let twin: MysqlKvStore | undefined;
    try {
      await mixed.set(key("a"), 1);
      const [config] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT @@lower_case_table_names AS mode",
      );
      if (Number(config[0].mode) === 0) {
        twin = new MysqlKvStore(pool, {
          tableName: name.toLowerCase(),
          expireCleanupRate: 0,
        });
        await twin.set(key("a"), 2);
        assert.equal(await mixed.get(key("a")), 1);
        assert.equal(await twin.get(key("a")), 2);
      } else {
        const alias = new MysqlKvStore(pool, {
          tableName: name.toLowerCase(),
          initialized: true,
          expireCleanupRate: 0,
        });
        assert.equal(await alias.get(key("a")), 1);
      }
    } finally {
      try {
        await mixed.drop();
        if (twin != null) await twin.drop();
      } finally {
        await pool.end();
      }
    }
  },
);

test("MysqlKvStore captures keys, JSON and TTL before asynchronous initialization", async () => {
  const ready = gate();
  let written: unknown;
  let ttl: unknown;
  const f = fakePool({
    query(sql, values) {
      if (sql.startsWith("INSERT")) written = values;
      if (sql.startsWith("SELECT DATE_FORMAT(DATE_ADD")) {
        ttl = values;
        return [{ e0: "2026-11-12 12:00:00.123457" }];
      }
    },
  });
  const store = new MysqlKvStore(
    {
      async query<T>(sql: string): Promise<[T, unknown]> {
        await ready.promise;
        return await f.pool.query<T>(sql);
      },
      getConnection: f.pool.getConnection,
    },
    { initialized: true, expireCleanupRate: 0 },
  );
  const parts: [string] = ["original"];
  const value = { count: 1 };
  const options = { ttl: Temporal.Duration.from({ microseconds: 1 }) };
  const pending = store.set(parts, value, options);
  parts[0] = "changed";
  value.count = 2;
  options.ttl = Temporal.Duration.from({ hours: 1 });
  ready.resolve();
  await pending;
  assert.deepEqual(ttl, ["2026-11-12 12:00:00.123456", 1]);
  assert.deepEqual(written, [
    '["original"]',
    '{"count":1}',
    "2026-11-12 12:00:00.123457",
    '{"count":1}',
    "2026-11-12 12:00:00.123457",
  ]);
});

test(
  "MysqlKvStore snapshot reads exclude a paused partial batch under READ UNCOMMITTED",
  live,
  async () => {
    const p = await pair();
    const changed = gate(),
      resume = gate();
    let writer: Promise<void> | undefined;
    try {
      await p.first.setMany([
        { key: key("a"), value: 0 },
        { key: key("b"), value: 0 },
      ]);
      const reader = new MysqlKvStore(
        {
          query: p.secondPool.query.bind(p.secondPool),
          async getConnection() {
            const conn = await p.secondPool.getConnection();
            await conn.query(
              "SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED",
            );
            return conn;
          },
        },
        { tableName: p.tableName, initialized: true, expireCleanupRate: 0 },
      );
      await reader.initialize();
      const paused = new MysqlKvStore(
        {
          query: p.firstPool.query.bind(p.firstPool),
          async getConnection() {
            const conn = await p.firstPool.getConnection();
            let writes = 0;
            return {
              async query<T>(
                sql: string,
                values?: unknown,
              ): Promise<[T, unknown]> {
                const result = await conn.query(sql, parameters(values));
                if (sql.startsWith("INSERT") && ++writes === 1) {
                  changed.resolve();
                  await resume.promise;
                }
                return result as [T, unknown];
              },
              beginTransaction: conn.beginTransaction.bind(conn),
              commit: conn.commit.bind(conn),
              rollback: conn.rollback.bind(conn),
              release: conn.release.bind(conn),
              destroy: conn.destroy.bind(conn),
            };
          },
        },
        { tableName: p.tableName, initialized: true, expireCleanupRate: 0 },
      );
      writer = paused.setMany([
        { key: key("a"), value: 1 },
        { key: key("b"), value: 1 },
      ]);
      await Promise.race([changed.promise, writer]);
      assert.deepEqual(await reader.getMany([key("a"), key("b")]), [0, 0]);
      const listed = async (prefix?: KvKey) => {
        const entries = [];
        for await (const entry of reader.list(prefix)) entries.push(entry);
        return entries;
      };
      assert.deepEqual(await listed(), [
        { key: key("a"), value: 0 },
        { key: key("b"), value: 0 },
      ]);
      assert.deepEqual(await listed(key("a")), [{ key: key("a"), value: 0 }]);
      resume.resolve();
      await writer;
      assert.deepEqual(await reader.getMany([key("a"), key("b")]), [1, 1]);
      assert.deepEqual(await listed(), [
        { key: key("a"), value: 1 },
        { key: key("b"), value: 1 },
      ]);
      assert.deepEqual(await listed(key("a")), [{ key: key("a"), value: 1 }]);
    } finally {
      resume.resolve();
      await Promise.allSettled([writer]);
      await p.dispose();
    }
  },
);
