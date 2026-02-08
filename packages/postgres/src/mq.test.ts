import { test } from "@fedify/fixture";
import { PostgresMessageQueue } from "@fedify/postgres/mq";
import { getRandomKey, testMessageQueue } from "@fedify/testing";
import { deepStrictEqual } from "node:assert/strict";
import process from "node:process";
import { test as nodeTest } from "node:test";
import postgres from "postgres";

const dbUrl = process.env.POSTGRES_URL;

test("PostgresMessageQueue", { ignore: dbUrl == null }, () => {
  if (dbUrl == null) return; // Bun does not support skip option

  const tableName = getRandomKey("message");
  const channelName = getRandomKey("channel");
  const sqls: postgres.Sql[] = [];

  function createSql() {
    const sql = postgres(dbUrl!);
    sqls.push(sql);
    return sql;
  }

  return testMessageQueue(
    () =>
      new PostgresMessageQueue(
        createSql(),
        { tableName, channelName },
      ),
    async ({ mq1, mq2, controller }) => {
      controller.abort();
      await mq1.drop();
      await mq2.drop();
      for (const sql of sqls) {
        await sql.end();
      }
    },
    { testOrderingKey: true },
  );
});

// Regression test for advisory lock not being fully released after processing
// a message with an ordering key.  This test verifies that after processing
// a message through PostgresMessageQueue.listen(), the advisory lock is fully
// released and another session can immediately acquire it.
//
// The original bug: pg_try_advisory_lock() in a WHERE clause was called
// multiple times during query execution (once per row with the same
// ordering_key), causing the lock's reentrant counter to be > 1.  But
// pg_advisory_unlock() was only called once, leaving the lock partially held.
//
// To reproduce the bug, we need MULTIPLE messages with the SAME ordering key.
// This causes the WHERE clause to evaluate pg_try_advisory_lock() for each row,
// incrementing the lock counter multiple times.
//
// See: https://github.com/fedify-dev/fedify/issues/538
nodeTest(
  "PostgresMessageQueue advisory lock release",
  { skip: dbUrl == null },
  async () => {
    if (dbUrl == null) return; // Bun does not support skip option

    const tableName = getRandomKey("message");
    const channelName = getRandomKey("channel");

    // Use two separate connections to verify lock behavior across sessions
    const sql1 = postgres(dbUrl!);
    const sql2 = postgres(dbUrl!);

    const mq = new PostgresMessageQueue(sql1, {
      tableName,
      channelName,
      pollInterval: { milliseconds: 100 },
    });

    try {
      await mq.initialize();

      // CRITICAL: Enqueue MULTIPLE messages with the SAME ordering key.
      // This is what triggers the bug - the WHERE clause evaluates
      // pg_try_advisory_lock() for each row, incrementing the lock counter
      // multiple times, but pg_advisory_unlock() is only called once.
      const orderingKey = "test-ordering-key";
      await mq.enqueue({ value: 1 }, { orderingKey });
      await mq.enqueue({ value: 2 }, { orderingKey });
      await mq.enqueue({ value: 3 }, { orderingKey });

      // Track when the FIRST message is processed
      let firstMessageProcessed = false;
      let lockReleasedAfterProcessing = false;

      const controller = new AbortController();

      // Start listening - we only care about processing the FIRST message
      const listening = mq.listen(
        () => {
          if (!firstMessageProcessed) {
            firstMessageProcessed = true;
            // Abort after processing first message to stop the listener
            controller.abort();
          }
        },
        { signal: controller.signal },
      );

      // Wait for the first message to be processed
      const startTime = Date.now();
      while (!firstMessageProcessed && Date.now() - startTime < 10000) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      deepStrictEqual(
        firstMessageProcessed,
        true,
        "First message should be processed",
      );

      // Wait for listener to fully stop and release locks
      await listening;
      await new Promise((resolve) => setTimeout(resolve, 200));

      // THE KEY TEST: After processing ONE message (with multiple messages
      // having the same ordering key in the queue), the advisory lock should
      // be FULLY released.  With the bug, the lock counter would be > 0
      // because pg_try_advisory_lock was called N times but pg_advisory_unlock
      // was only called once.
      const lockAfterProcessing = await sql2`
        SELECT pg_try_advisory_lock(
          hashtext(${tableName}),
          hashtext(${orderingKey})
        ) AS acquired
      `;
      lockReleasedAfterProcessing = lockAfterProcessing[0].acquired;

      // Release the lock we just acquired in sql2
      if (lockReleasedAfterProcessing) {
        await sql2`
          SELECT pg_advisory_unlock(
            hashtext(${tableName}),
            hashtext(${orderingKey})
          )
        `;
      }

      // THE FIX: After processing, the lock should be fully released
      // and another session should be able to acquire it
      deepStrictEqual(
        lockReleasedAfterProcessing,
        true,
        "Lock should be fully released after message processing " +
          "(bug: lock counter was incremented multiple times but only " +
          "decremented once)",
      );
    } finally {
      await mq.drop();
      await sql1.end();
      await sql2.end();
    }
  },
);

// Regression test for concurrent initialize() calls.  When listen() and
// enqueue() are called without awaiting listen() first, both code paths enter
// initialize() concurrently.  Without proper promise caching, the DDL runs
// multiple times in parallel, which can cause race conditions.
//
// This test verifies that concurrent initialization is safe: start listen()
// (which internally calls initialize()) without awaiting it, then immediately
// call enqueue() (which also calls initialize()).  The message must still be
// delivered successfully.
nodeTest(
  "PostgresMessageQueue concurrent initialization",
  { skip: dbUrl == null },
  async () => {
    if (dbUrl == null) return; // Bun does not support skip option

    const tableName = getRandomKey("message");
    const channelName = getRandomKey("channel");

    const sql = postgres(dbUrl!);
    const mq = new PostgresMessageQueue(sql, {
      tableName,
      channelName,
      pollInterval: { milliseconds: 100 },
    });

    try {
      // Do NOT call initialize() ahead of time — let listen() and enqueue()
      // race to initialize concurrently.
      const messages: string[] = [];
      const controller = new AbortController();

      // Start listen() WITHOUT awaiting — it will call initialize() internally
      const listening = mq.listen(
        (message: string) => {
          messages.push(message);
        },
        { signal: controller.signal },
      );

      // Immediately enqueue — this also calls initialize(), racing with
      // listen()'s initialize().  With the bug (no promise caching), both
      // would run DDL concurrently.
      await mq.enqueue("concurrent-init-test");

      // Wait for the message to be delivered
      const start = Date.now();
      while (messages.length < 1 && Date.now() - start < 15_000) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      deepStrictEqual(
        messages,
        ["concurrent-init-test"],
        "Message should be delivered despite concurrent initialization",
      );

      controller.abort();
      await listening;
    } finally {
      await mq.drop();
      await sql.end();
    }
  },
);

// Regression test for poll serialization ensuring no messages are lost.
// When multiple messages are enqueued BEFORE listen() starts, there are no
// NOTIFY signals to trigger immediate polling — the listener must discover
// all messages through its periodic poll cycle alone.
//
// This is a deterministic test: by inserting messages before listen() starts,
// we completely eliminate NOTIFY timing as a variable.  If poll() ever skips
// messages (e.g., due to incorrect serialization or debouncing), this test
// will fail consistently.
nodeTest(
  "PostgresMessageQueue processes pre-enqueued messages via polling",
  { skip: dbUrl == null },
  async () => {
    if (dbUrl == null) return; // Bun does not support skip option

    const tableName = getRandomKey("message");
    const channelName = getRandomKey("channel");

    const sql = postgres(dbUrl!);
    const mq = new PostgresMessageQueue(sql, {
      tableName,
      channelName,
      pollInterval: { milliseconds: 100 },
    });

    try {
      await mq.initialize();

      // Enqueue messages BEFORE starting the listener — no NOTIFY will be
      // received by the listener for these messages.
      const count = 20;
      for (let i = 0; i < count; i++) {
        await mq.enqueue(`pre-enqueued-${i}`);
      }

      // Now start listening — messages can only be found through polling
      const messages: string[] = [];
      const controller = new AbortController();

      const listening = mq.listen(
        (message: string) => {
          messages.push(message);
        },
        { signal: controller.signal },
      );

      // With pollInterval=100ms, 20 messages should be processed well
      // within 15 seconds even without NOTIFY
      const start = Date.now();
      while (messages.length < count && Date.now() - start < 15_000) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      deepStrictEqual(
        new Set(messages),
        new Set(Array.from({ length: count }, (_, i) => `pre-enqueued-${i}`)),
        `All ${count} pre-enqueued messages should be processed via polling`,
      );

      controller.abort();
      await listening;
    } finally {
      await mq.drop();
      await sql.end();
    }
  },
);

// Regression test for concurrent enqueue + listen not dropping messages.
// This test fires off multiple enqueue() calls concurrently while a listener
// is active.  Each enqueue sends a NOTIFY, creating a burst of notifications
// that exercises the poll serialization logic.
//
// With the old debouncing bug, concurrent NOTIFY handlers would set a
// "pollAgain" flag and return immediately without waiting for the actual
// poll to complete.  This could cause messages to be missed if the timing
// was wrong.  The promise-chain serialization ensures every NOTIFY results
// in an actual poll() execution.
nodeTest(
  "PostgresMessageQueue concurrent enqueue with active listener",
  { skip: dbUrl == null },
  async () => {
    if (dbUrl == null) return; // Bun does not support skip option

    const tableName = getRandomKey("message");
    const channelName = getRandomKey("channel");

    const sql = postgres(dbUrl!);
    const mq = new PostgresMessageQueue(sql, {
      tableName,
      channelName,
      pollInterval: { milliseconds: 100 },
    });

    try {
      await mq.initialize();

      const messages: string[] = [];
      const controller = new AbortController();

      const listening = mq.listen(
        (message: string) => {
          messages.push(message);
        },
        { signal: controller.signal },
      );

      // Wait for the listener to establish its LISTEN subscription
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Fire off many enqueue() calls concurrently — each one sends a
      // NOTIFY, creating a burst that stresses the serialization logic
      const count = 30;
      const enqueues: Promise<void>[] = [];
      for (let i = 0; i < count; i++) {
        enqueues.push(mq.enqueue(`concurrent-${i}`));
      }
      await Promise.all(enqueues);

      // Wait for all messages to be processed
      const start = Date.now();
      while (messages.length < count && Date.now() - start < 15_000) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      deepStrictEqual(
        new Set(messages),
        new Set(Array.from({ length: count }, (_, i) => `concurrent-${i}`)),
        `All ${count} concurrently enqueued messages should be processed`,
      );

      controller.abort();
      await listening;
    } finally {
      await mq.drop();
      await sql.end();
    }
  },
);

// Regression test for advisory lock leak due to connection pool.
//
// PostgreSQL advisory locks are session-level: pg_try_advisory_lock() binds
// the lock to the physical connection that runs the query.  The postgres.js
// driver uses a connection pool internally, so consecutive queries may run on
// *different* pooled connections.  When pg_try_advisory_lock() and
// pg_advisory_unlock() execute on different connections, the unlock silently
// fails (PostgreSQL WARNING: "you don't own a lock of type ExclusiveLock")
// and the lock leaks permanently, blocking all future processing for that
// ordering key.
//
// This test deterministically reproduces the bug by:
// 1. Enqueueing ordering key messages and processing them with a listener
//    while simultaneously saturating the connection pool with concurrent
//    queries, forcing the pool to rotate connections between the lock and
//    unlock calls.
// 2. After all messages are processed, explicitly checking that NO advisory
//    locks remain held for the ordering keys used.
//
// The pool saturation technique (concurrent pg_sleep queries) ensures that
// lock() and unlock() are almost always routed to different connections,
// making the test fail deterministically without the fix (sql.reserve()).
//
// See: https://github.com/fedify-dev/fedify/issues/538
nodeTest(
  "PostgresMessageQueue advisory lock not leaked across pooled connections",
  { skip: dbUrl == null },
  async () => {
    if (dbUrl == null) return; // Bun does not support skip option

    const tableName = getRandomKey("message");
    const channelName = getRandomKey("channel");

    // Use a SMALL pool (max: 3) so that concurrent pg_sleep queries can
    // easily saturate it and force connection rotation.
    const sql = postgres(dbUrl!, { max: 3 });
    const sqlCheck = postgres(dbUrl!);

    const mq = new PostgresMessageQueue(sql, {
      tableName,
      channelName,
      pollInterval: { milliseconds: 100 },
    });

    try {
      await mq.initialize();

      // Enqueue several messages with ordering keys.  Multiple messages per
      // key ensures the poll() loop calls lock→delete→unlock repeatedly.
      const keyA = "pool-leak-key-A";
      const keyB = "pool-leak-key-B";
      for (let i = 1; i <= 3; i++) {
        await mq.enqueue({ key: keyA, value: i }, { orderingKey: keyA });
        await mq.enqueue({ key: keyB, value: i }, { orderingKey: keyB });
      }

      const processed: { key: string | null; value: number }[] = [];
      const controller = new AbortController();

      // Start a listener that processes messages while we saturate the pool.
      const listening = mq.listen(
        (msg: { key: string | null; value: number }) => {
          processed.push(msg);
        },
        { signal: controller.signal },
      );

      // Continuously saturate the connection pool with concurrent queries.
      // This forces postgres.js to use all available pooled connections,
      // making it highly likely that the advisory lock and unlock queries
      // land on different connections.
      let saturating = true;
      const saturate = async () => {
        while (saturating) {
          try {
            await Promise.all([
              sql`SELECT pg_sleep(0.01)`,
              sql`SELECT pg_sleep(0.01)`,
            ]);
          } catch {
            // Ignore errors from pool closing
            break;
          }
        }
      };
      const saturationTask = saturate();

      // Wait for all 6 messages to be processed
      const start = Date.now();
      while (processed.length < 6 && Date.now() - start < 15_000) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      saturating = false;
      controller.abort();
      await listening;
      await saturationTask;

      deepStrictEqual(
        processed.length,
        6,
        "All 6 messages should be processed",
      );

      // THE KEY ASSERTION: verify that no advisory locks remain held.
      // If the lock leaked (lock/unlock on different pooled connections),
      // pg_try_advisory_lock from a separate session will return false.
      for (const key of [keyA, keyB]) {
        const lockResult = await sqlCheck`
          SELECT pg_try_advisory_lock(
            hashtext(${tableName}),
            hashtext(${key})
          ) AS acquired
        `;
        deepStrictEqual(
          lockResult[0].acquired,
          true,
          `Advisory lock for ordering key "${key}" should be fully released ` +
            "(leaked lock indicates lock/unlock ran on different pooled " +
            "connections)",
        );
        // Release the lock we just acquired for the check
        await sqlCheck`
          SELECT pg_advisory_unlock(
            hashtext(${tableName}),
            hashtext(${key})
          )
        `;
      }
    } finally {
      await mq.drop();
      await sql.end();
      await sqlCheck.end();
    }
  },
);

// cspell: ignore sqls
