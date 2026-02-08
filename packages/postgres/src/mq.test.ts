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

// cspell: ignore sqls
