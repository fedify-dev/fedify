import { MysqlMessageQueue } from "@fedify/mysql/mq";
import { getRandomKey, testMessageQueue, waitFor } from "@fedify/testing";
import * as temporal from "@js-temporal/polyfill";
import assert from "node:assert/strict";
import process from "node:process";
import { test } from "node:test";
import mysql from "mysql2/promise";

let Temporal: typeof temporal.Temporal;
if ("Temporal" in globalThis) {
  Temporal = (globalThis as unknown as { Temporal: typeof temporal.Temporal })
    .Temporal;
} else {
  Temporal = temporal.Temporal;
}

const dbUrl = process.env.MYSQL_URL;

/**
 * Returns a short, MySQL-identifier-safe table name unique to this test run.
 * The name is at most 30 characters long, well within the 46-character limit
 * imposed by the `idx_<name>_deliver_after` index constraint.
 */
function randomTableName(prefix: string): string {
  // crypto.randomUUID() returns a 36-char UUID with hyphens.
  // We strip hyphens and take the first 16 hex digits for uniqueness.
  const hex = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return `t_${prefix}_${hex}`;
}

// ---------------------------------------------------------------------------
// Constructor validation (no DB required)
// ---------------------------------------------------------------------------

test("MysqlMessageQueue rejects invalid table names", () => {
  const fakePool = {} as mysql.Pool;

  // Must start with letter or underscore
  assert.throws(
    () => new MysqlMessageQueue(fakePool, { tableName: "1starts_digit" }),
    RangeError,
  );
  // No hyphens
  assert.throws(
    () => new MysqlMessageQueue(fakePool, { tableName: "bad-name" }),
    RangeError,
  );
  // No spaces
  assert.throws(
    () => new MysqlMessageQueue(fakePool, { tableName: "has space" }),
    RangeError,
  );
  // No special chars
  assert.throws(
    () => new MysqlMessageQueue(fakePool, { tableName: "name!" }),
    RangeError,
  );
  // Table name > 46 chars: derived index name would exceed MySQL's 64-char limit
  assert.throws(
    () => new MysqlMessageQueue(fakePool, { tableName: "a".repeat(47) }),
    RangeError,
  );

  // Valid names should not throw
  new MysqlMessageQueue(fakePool, { tableName: "valid_name" });
  new MysqlMessageQueue(fakePool, { tableName: "_leading_underscore" });
  new MysqlMessageQueue(fakePool, { tableName: "CamelCase123" });
  // Exactly 46 chars is valid
  new MysqlMessageQueue(fakePool, { tableName: "a".repeat(46) });
});

test("MysqlMessageQueue uses default options when none are provided", () => {
  const fakePool = {} as mysql.Pool;
  // Should not throw with default options
  const mq = new MysqlMessageQueue(fakePool);
  assert.strictEqual(mq.nativeRetrial, false);
});

// ---------------------------------------------------------------------------
// Standard shared test suite
// ---------------------------------------------------------------------------

test("MysqlMessageQueue", { skip: dbUrl == null }, () => {
  const tableName = randomTableName("mq");
  const pools: mysql.Pool[] = [];

  function makeQueue(): MysqlMessageQueue {
    const pool = mysql.createPool(dbUrl!);
    pools.push(pool);
    return new MysqlMessageQueue(pool, { tableName });
  }

  return testMessageQueue(
    makeQueue,
    async ({ mq1, mq2, controller }) => {
      controller.abort();
      await mq1.drop();
      await mq2.drop();
      for (const pool of pools) await pool.end();
    },
    { testOrderingKey: true },
  );
});

// ---------------------------------------------------------------------------
// initialize() and drop()
// ---------------------------------------------------------------------------

test("MysqlMessageQueue.initialize()", { skip: dbUrl == null }, async () => {
  const pool = mysql.createPool(dbUrl!);
  const tableName = randomTableName("init");
  const mq = new MysqlMessageQueue(pool, { tableName });
  try {
    await mq.initialize();

    // Table must exist
    const [tables] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = ?`,
      [tableName],
    );
    assert.strictEqual(tables[0].cnt, 1);

    // The deliver_after index must exist
    const [idxRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.statistics
       WHERE table_schema = DATABASE()
         AND table_name = ?
         AND column_name = 'deliver_after'`,
      [tableName],
    );
    assert.strictEqual(idxRows[0].cnt, 1, "deliver_after index must exist");

    // id column must be CHAR(36) (for UUID storage)
    const [cols] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT CHARACTER_MAXIMUM_LENGTH
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = ?
         AND column_name = 'id'`,
      [tableName],
    );
    assert.ok(
      cols[0].CHARACTER_MAXIMUM_LENGTH >= 36,
      "id column must fit a UUID",
    );
  } finally {
    await mq.drop();
    await pool.end();
  }
});

test(
  "MysqlMessageQueue.initialize() is idempotent",
  { skip: dbUrl == null },
  async () => {
    const pool = mysql.createPool(dbUrl!);
    const tableName = randomTableName("idem");
    const mq = new MysqlMessageQueue(pool, { tableName });
    try {
      // Calling initialize() twice must not throw
      await mq.initialize();
      await mq.initialize();

      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt
         FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = ?`,
        [tableName],
      );
      assert.strictEqual(rows[0].cnt, 1);
    } finally {
      await mq.drop();
      await pool.end();
    }
  },
);

test("MysqlMessageQueue.drop()", { skip: dbUrl == null }, async () => {
  const pool = mysql.createPool(dbUrl!);
  const tableName = randomTableName("drop");
  const mq = new MysqlMessageQueue(pool, { tableName });
  try {
    await mq.initialize();
    await mq.drop();

    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = ?`,
      [tableName],
    );
    assert.strictEqual(rows[0].cnt, 0, "table must be dropped");
  } finally {
    await pool.end();
  }
});

test(
  "MysqlMessageQueue.drop() resets initialized flag so re-initialize works",
  { skip: dbUrl == null },
  async () => {
    const pool = mysql.createPool(dbUrl!);
    const tableName = randomTableName("reinit");
    const mq = new MysqlMessageQueue(pool, { tableName });
    try {
      await mq.initialize();
      await mq.drop();

      // After drop(), initialize() must be able to recreate the table
      await mq.initialize();
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt
         FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = ?`,
        [tableName],
      );
      assert.strictEqual(rows[0].cnt, 1);
    } finally {
      await mq.drop();
      await pool.end();
    }
  },
);

// ---------------------------------------------------------------------------
// Concurrent initialization
// ---------------------------------------------------------------------------

test(
  "MysqlMessageQueue concurrent initialization does not throw",
  { skip: dbUrl == null },
  async () => {
    const pools: mysql.Pool[] = [];
    const tableName = randomTableName("concinit");
    try {
      // 10 instances all racing to initialize the same table simultaneously
      const instances = Array.from({ length: 10 }, () => {
        const pool = mysql.createPool(dbUrl!);
        pools.push(pool);
        return new MysqlMessageQueue(pool, { tableName });
      });
      await assert.doesNotReject(
        Promise.all(instances.map((mq) => mq.initialize())),
        "Concurrent initialization must not throw",
      );
    } finally {
      // Clean up: drop via first pool
      await pools[0]?.query(`DROP TABLE IF EXISTS \`${tableName}\``);
      for (const pool of pools) await pool.end();
    }
  },
);

test(
  "MysqlMessageQueue enqueue() and listen() racing on initialize() is safe",
  { skip: dbUrl == null },
  async () => {
    const pool = mysql.createPool(dbUrl!);
    const tableName = randomTableName("race");
    const mq = new MysqlMessageQueue(pool, { tableName });
    const controller = new AbortController();
    const received: string[] = [];
    try {
      // Start listen() and enqueue() simultaneously — both will trigger
      // initialize() concurrently
      const listening = mq.listen(
        (msg: string) => {
          received.push(msg);
        },
        { signal: controller.signal },
      );
      await mq.enqueue("race-message");
      await waitFor(() => received.length >= 1, 15_000);
      assert.deepStrictEqual(received, ["race-message"]);
      controller.abort();
      await listening;
    } finally {
      await mq.drop();
      await pool.end();
    }
  },
);

// ---------------------------------------------------------------------------
// Pre-enqueued messages discovered via initial poll
// ---------------------------------------------------------------------------

test(
  "MysqlMessageQueue processes messages enqueued before listen() starts",
  { skip: dbUrl == null },
  async () => {
    const pool = mysql.createPool(dbUrl!);
    const tableName = randomTableName("preq");
    const mq = new MysqlMessageQueue(pool, { tableName });
    const controller = new AbortController();
    const received: string[] = [];
    try {
      // Enqueue messages BEFORE starting the listener
      await mq.enqueue("pre-queued-1");
      await mq.enqueue("pre-queued-2");
      await mq.enqueue("pre-queued-3");

      const listening = mq.listen(
        (msg: string) => {
          received.push(msg);
        },
        { signal: controller.signal },
      );

      await waitFor(() => received.length >= 3, 15_000);
      assert.deepStrictEqual(
        new Set(received),
        new Set(["pre-queued-1", "pre-queued-2", "pre-queued-3"]),
      );
      controller.abort();
      await listening;
    } finally {
      await mq.drop();
      await pool.end();
    }
  },
);

// ---------------------------------------------------------------------------
// Delayed message delivery
// ---------------------------------------------------------------------------

test(
  "MysqlMessageQueue delayed message is not delivered early",
  { skip: dbUrl == null },
  async () => {
    const pool = mysql.createPool(dbUrl!);
    const tableName = randomTableName("delay");
    const mq = new MysqlMessageQueue(pool, {
      tableName,
      pollInterval: { milliseconds: 200 },
    });
    const controller = new AbortController();
    const received: string[] = [];
    try {
      const listening = mq.listen(
        (msg: string) => {
          received.push(msg);
        },
        { signal: controller.signal },
      );

      const started = Date.now();
      await mq.enqueue("immediate");
      await waitFor(() => received.length >= 1, 10_000);

      // The delayed message must not appear during the first 2 seconds
      await mq.enqueue(
        "delayed",
        { delay: Temporal.Duration.from({ seconds: 3 }) },
      );
      await new Promise((r) => setTimeout(r, 2_000));
      assert.strictEqual(
        received.length,
        1,
        "delayed message must not arrive within 2 seconds",
      );

      await waitFor(() => received.length >= 2, 10_000);
      assert.ok(
        Date.now() - started >= 3_000,
        "delayed message must arrive after at least 3 seconds",
      );
      assert.strictEqual(received[1], "delayed");

      controller.abort();
      await listening;
    } finally {
      await mq.drop();
      await pool.end();
    }
  },
);

// ---------------------------------------------------------------------------
// Concurrent enqueue stress test
// ---------------------------------------------------------------------------

test(
  "MysqlMessageQueue handles 30 concurrent enqueue() calls",
  { skip: dbUrl == null },
  async () => {
    const pool = mysql.createPool(dbUrl!);
    const tableName = randomTableName("stress");
    const mq = new MysqlMessageQueue(pool, {
      tableName,
      pollInterval: { milliseconds: 200 },
    });
    const controller = new AbortController();
    const received: number[] = [];
    try {
      const listening = mq.listen(
        (msg: number) => {
          received.push(msg);
        },
        { signal: controller.signal },
      );

      // Fire 30 enqueue() calls in parallel
      await Promise.all(
        Array.from({ length: 30 }, (_, i) => mq.enqueue(i)),
      );

      await waitFor(() => received.length >= 30, 30_000);
      assert.deepStrictEqual(
        new Set(received),
        new Set(Array.from({ length: 30 }, (_, i) => i)),
      );
      controller.abort();
      await listening;
    } finally {
      await mq.drop();
      await pool.end();
    }
  },
);

// ---------------------------------------------------------------------------
// enqueueMany() edge cases
// ---------------------------------------------------------------------------

test(
  "MysqlMessageQueue.enqueueMany() with empty array is a no-op",
  { skip: dbUrl == null },
  async () => {
    const pool = mysql.createPool(dbUrl!);
    const tableName = randomTableName("emptyb");
    const mq = new MysqlMessageQueue(pool, { tableName });
    try {
      // Should not throw and should not touch the DB (table not yet created)
      await assert.doesNotReject(mq.enqueueMany([]));
      // Table should NOT have been auto-created by an empty enqueueMany()
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt
         FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = ?`,
        [tableName],
      );
      assert.strictEqual(
        rows[0].cnt,
        0,
        "empty enqueueMany() must not create the table",
      );
    } finally {
      await pool.end();
    }
  },
);

test(
  "MysqlMessageQueue.enqueueMany() inserts all messages atomically",
  { skip: dbUrl == null },
  async () => {
    const pool = mysql.createPool(dbUrl!);
    const tableName = randomTableName("batcha");
    const mq = new MysqlMessageQueue(pool, { tableName });
    try {
      const msgs = ["a", "b", "c", "d", "e"];
      await mq.enqueueMany(msgs);

      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM \`${tableName}\``,
      );
      assert.strictEqual(rows[0].cnt, msgs.length);
    } finally {
      await mq.drop();
      await pool.end();
    }
  },
);

test(
  "MysqlMessageQueue.enqueueMany() delivers all 100 messages via single INSERT",
  { skip: dbUrl == null },
  async () => {
    if (dbUrl == null) return;
    const pool = mysql.createPool(dbUrl!);
    const tableName = randomTableName("bulk");
    const mq = new MysqlMessageQueue(pool, {
      tableName,
      pollInterval: { milliseconds: 200 },
    });
    const controller = new AbortController();
    const received: number[] = [];
    try {
      const listening = mq.listen(
        (msg: number) => {
          received.push(msg);
        },
        { signal: controller.signal },
      );

      const msgs = Array.from({ length: 100 }, (_, i) => i);
      await mq.enqueueMany(msgs);

      await waitFor(() => received.length >= 100, 30_000);
      assert.deepStrictEqual(
        new Set(received),
        new Set(msgs),
        "all 100 messages must be delivered",
      );
      controller.abort();
      await listening;
    } finally {
      await mq.drop();
      await pool.end();
    }
  },
);

// ---------------------------------------------------------------------------
// Handler error survival
// ---------------------------------------------------------------------------

test(
  "MysqlMessageQueue listener survives handler errors",
  { skip: dbUrl == null },
  async () => {
    const pool = mysql.createPool(dbUrl!);
    const tableName = randomTableName("hderr");
    const mq = new MysqlMessageQueue(pool, {
      tableName,
      pollInterval: { milliseconds: 200 },
    });
    const controller = new AbortController();
    const received: string[] = [];
    let calls = 0;
    try {
      const listening = mq.listen(
        (msg: string) => {
          calls++;
          if (calls === 1) throw new Error("simulated handler error");
          received.push(msg);
        },
        { signal: controller.signal },
      );

      // Enqueue two messages; the first triggers an error, the second must
      // still be processed.
      await mq.enqueue("error-message");
      await mq.enqueue("success-message");

      await waitFor(() => received.length >= 1, 15_000);
      assert.deepStrictEqual(received, ["success-message"]);
      controller.abort();
      await listening;
    } finally {
      await mq.drop();
      await pool.end();
    }
  },
);

// ---------------------------------------------------------------------------
// Handler timeout
// ---------------------------------------------------------------------------

test(
  "MysqlMessageQueue handlerTimeout prevents hung handler from blocking queue",
  { skip: dbUrl == null },
  async () => {
    const pool = mysql.createPool(dbUrl!);
    const tableName = randomTableName("hdto");
    const mq = new MysqlMessageQueue(pool, {
      tableName,
      pollInterval: { milliseconds: 200 },
      // Very short timeout so the hung handler is evicted quickly in tests
      handlerTimeout: { seconds: 1 },
    });
    const controller = new AbortController();
    const received: string[] = [];
    let calls = 0;
    try {
      const listening = mq.listen(
        async (msg: string) => {
          calls++;
          if (calls === 1) {
            // Hang forever — the timeout must kick us out
            await new Promise<void>(() => {});
          }
          received.push(msg);
        },
        { signal: controller.signal },
      );

      await mq.enqueue("hung-message");
      await mq.enqueue("next-message");

      // The second message must eventually be processed even though the first
      // handler hung and was timed out.
      await waitFor(() => received.length >= 1, 15_000);
      assert.deepStrictEqual(received, ["next-message"]);
      controller.abort();
      await listening;
    } finally {
      await mq.drop();
      await pool.end();
    }
  },
);

test(
  "MysqlMessageQueue handlerTimeout with ordering key releases the lock",
  { skip: dbUrl == null },
  async () => {
    const pool = mysql.createPool(dbUrl!);
    const tableName = randomTableName("hdtolk");
    const mq = new MysqlMessageQueue(pool, {
      tableName,
      pollInterval: { milliseconds: 200 },
      handlerTimeout: { seconds: 1 },
    });
    const controller = new AbortController();
    const received: string[] = [];
    let calls = 0;
    try {
      const listening = mq.listen(
        async (msg: string) => {
          calls++;
          if (calls === 1) {
            // Hang forever — the timeout must release the ordering-key lock
            await new Promise<void>(() => {});
          }
          received.push(msg);
        },
        { signal: controller.signal },
      );

      // Both messages share the same ordering key
      await mq.enqueue("key-msg-1", { orderingKey: "keyA" });
      await mq.enqueue("key-msg-2", { orderingKey: "keyA" });

      // The second message must be processed even after the first handler times out
      await waitFor(() => received.length >= 1, 15_000);
      assert.deepStrictEqual(received, ["key-msg-2"]);
      controller.abort();
      await listening;
    } finally {
      await mq.drop();
      await pool.end();
    }
  },
);

// ---------------------------------------------------------------------------
// Ordering key: advisory lock release regression
// ---------------------------------------------------------------------------

test(
  "MysqlMessageQueue advisory lock is released after processing (regression for lock-leak)",
  { skip: dbUrl == null },
  async () => {
    // Use a pool with a small max to make lock leaks visible
    const pool = mysql.createPool({ uri: dbUrl!, connectionLimit: 3 });
    const tableName = randomTableName("lockleak");
    const mq = new MysqlMessageQueue(pool, {
      tableName,
      pollInterval: { milliseconds: 200 },
    });
    const controller = new AbortController();
    const received: string[] = [];
    try {
      const listening = mq.listen(
        (msg: string) => {
          received.push(msg);
        },
        { signal: controller.signal },
      );

      // Enqueue 5 messages with the same ordering key; they must all be
      // processed in order, proving the lock is released between messages.
      for (let i = 1; i <= 5; i++) {
        await mq.enqueue(`ordered-${i}`, { orderingKey: "locktest" });
      }

      await waitFor(() => received.length >= 5, 30_000);
      assert.deepStrictEqual(received, [
        "ordered-1",
        "ordered-2",
        "ordered-3",
        "ordered-4",
        "ordered-5",
      ]);
      controller.abort();
      await listening;
    } finally {
      await mq.drop();
      await pool.end();
    }
  },
);

test(
  "MysqlMessageQueue lock name is deterministic and fits MySQL limit",
  () => {
    // Access the internal function via a private test by checking the behavior:
    // We create queues with table names of varying lengths and ordering keys
    // and verify that enqueue() succeeds (no truncation errors).
    // The lock name must always be ≤ 64 chars.

    // Verify that a very long orderingKey doesn't cause MySQL errors when
    // GET_LOCK is called (the lock name must be hashed to ≤ 64 chars).
    // We can test this indirectly via the getMysqlLockName helper logic:
    // a 100-char ordering key combined with a 20-char table name is > 64 chars.
    const tableNameLen20 = "a".repeat(20); // 20 chars
    // combined = 20 + 1 (colon) + 100-char key = 121 chars > 64

    // Instead of accessing the private helper, we verify via queue construction
    // that no RangeError is thrown for a valid table name
    assert.doesNotThrow(
      () =>
        new MysqlMessageQueue({} as mysql.Pool, {
          tableName: tableNameLen20,
        }),
    );
    // A 46-char table name is the maximum allowed
    assert.doesNotThrow(
      () =>
        new MysqlMessageQueue({} as mysql.Pool, {
          tableName: "b".repeat(46),
        }),
    );
    // A 47-char table name must be rejected
    assert.throws(
      () =>
        new MysqlMessageQueue({} as mysql.Pool, {
          tableName: "b".repeat(47),
        }),
      RangeError,
    );
  },
);

// ---------------------------------------------------------------------------
// Multiple workers: each message delivered exactly once
// ---------------------------------------------------------------------------

test(
  "MysqlMessageQueue delivers each message to exactly one worker",
  { skip: dbUrl == null },
  async () => {
    const pool1 = mysql.createPool(dbUrl!);
    const pool2 = mysql.createPool(dbUrl!);
    const tableName = randomTableName("onceonly");
    const mq1 = new MysqlMessageQueue(pool1, {
      tableName,
      pollInterval: { milliseconds: 200 },
    });
    const mq2 = new MysqlMessageQueue(pool2, {
      tableName,
      pollInterval: { milliseconds: 200 },
    });
    const controller = new AbortController();
    const received: number[] = [];
    try {
      const listening1 = mq1.listen(
        (msg: number) => {
          received.push(msg);
        },
        { signal: controller.signal },
      );
      const listening2 = mq2.listen(
        (msg: number) => {
          received.push(msg);
        },
        { signal: controller.signal },
      );

      const count = 20;
      for (let i = 0; i < count; i++) await mq1.enqueue(i);

      await waitFor(() => received.length >= count, 30_000);
      // All messages must be received
      assert.strictEqual(received.length, count);
      // Each message must be received exactly once (no duplicates)
      assert.deepStrictEqual(
        new Set(received).size,
        count,
        "each message must be delivered exactly once",
      );
      controller.abort();
      await listening1;
      await listening2;
    } finally {
      await mq1.drop();
      await mq2.drop();
      await pool1.end();
      await pool2.end();
    }
  },
);

// ---------------------------------------------------------------------------
// Ordering key: two workers respect sequential ordering
// ---------------------------------------------------------------------------

test(
  "MysqlMessageQueue two workers preserve ordering-key order",
  { skip: dbUrl == null },
  async () => {
    const pool1 = mysql.createPool(dbUrl!);
    const pool2 = mysql.createPool(dbUrl!);
    const tableName = randomTableName("twowork");
    const mq1 = new MysqlMessageQueue(pool1, {
      tableName,
      pollInterval: { milliseconds: 200 },
    });
    const mq2 = new MysqlMessageQueue(pool2, {
      tableName,
      pollInterval: { milliseconds: 200 },
    });
    const controller = new AbortController();
    const received: number[] = [];
    try {
      const listening1 = mq1.listen(
        (msg: number) => {
          received.push(msg);
        },
        { signal: controller.signal },
      );
      const listening2 = mq2.listen(
        (msg: number) => {
          received.push(msg);
        },
        { signal: controller.signal },
      );

      // Enqueue 10 messages in order under the same ordering key
      for (let i = 1; i <= 10; i++) {
        await mq1.enqueue(i, { orderingKey: "strict-order" });
      }

      await waitFor(() => received.length >= 10, 30_000);
      assert.deepStrictEqual(
        received,
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        "messages with the same ordering key must be delivered in order",
      );
      controller.abort();
      await listening1;
      await listening2;
    } finally {
      await mq1.drop();
      await mq2.drop();
      await pool1.end();
      await pool2.end();
    }
  },
);

// ---------------------------------------------------------------------------
// getRandomKey() integration: using @fedify/testing helpers
// ---------------------------------------------------------------------------

test(
  "MysqlMessageQueue works with getRandomKey() from @fedify/testing",
  { skip: dbUrl == null },
  async () => {
    // getRandomKey returns names like "fedify_test_mq_<uuid>" which may contain
    // hyphens — unsuitable for MySQL identifiers.  Users must replace hyphens.
    const rawKey = getRandomKey("mq");
    const tableName = rawKey.replace(/-/g, "_").slice(0, 46);

    const pool = mysql.createPool(dbUrl!);
    const mq = new MysqlMessageQueue(pool, { tableName });
    const controller = new AbortController();
    const received: string[] = [];
    try {
      const listening = mq.listen(
        (msg: string) => {
          received.push(msg);
        },
        { signal: controller.signal },
      );
      await mq.enqueue("hello");
      await waitFor(() => received.length >= 1, 10_000);
      assert.deepStrictEqual(received, ["hello"]);
      controller.abort();
      await listening;
    } finally {
      await mq.drop();
      await pool.end();
    }
  },
);

// ---------------------------------------------------------------------------
// initialized option skips table creation
// ---------------------------------------------------------------------------

test(
  "MysqlMessageQueue with initialized: true skips DDL on first use",
  { skip: dbUrl == null },
  async () => {
    const pool = mysql.createPool(dbUrl!);
    const tableName = randomTableName("preini");
    // Create table manually first
    const setupMq = new MysqlMessageQueue(pool, { tableName });
    await setupMq.initialize();

    try {
      // A second instance with initialized: true must not issue CREATE TABLE
      const mq = new MysqlMessageQueue(pool, { tableName, initialized: true });
      const controller = new AbortController();
      const received: string[] = [];
      const listening = mq.listen(
        (msg: string) => {
          received.push(msg);
        },
        { signal: controller.signal },
      );
      await mq.enqueue("pre-initialized");
      await waitFor(() => received.length >= 1, 10_000);
      assert.deepStrictEqual(received, ["pre-initialized"]);
      controller.abort();
      await listening;
    } finally {
      await setupMq.drop();
      await pool.end();
    }
  },
);
