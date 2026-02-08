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

// cspell: ignore sqls
