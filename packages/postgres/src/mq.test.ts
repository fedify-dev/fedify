import { PostgresMessageQueue } from "@fedify/postgres/mq";
import * as temporal from "@js-temporal/polyfill";
import { delay } from "@std/async/delay";
import process from "node:process";
import assert from "node:assert/strict";
import { test } from "node:test";
import postgres from "postgres";

let Temporal: typeof temporal.Temporal;
if ("Temporal" in globalThis) {
  Temporal = globalThis.Temporal;
} else {
  Temporal = temporal.Temporal;
}

const dbUrl = process.env.DATABASE_URL;

test("PostgresMessageQueue", { skip: dbUrl == null }, async () => {
  if (dbUrl == null) return; // Bun does not support skip option
  const sql = postgres(dbUrl!);
  const sql2 = postgres(dbUrl!);
  const tableName = `fedify_message_test_${
    Math.random().toString(36).slice(5)
  }`;
  const channelName = `fedify_channel_test_${
    Math.random().toString(36).slice(5)
  }`;
  const mq = new PostgresMessageQueue(sql, { tableName, channelName });
  const mq2 = new PostgresMessageQueue(sql2, { tableName, channelName });

  try {
    const messages: string[] = [];
    const controller = new AbortController();
    await mq.initialize();
    const listening = mq.listen((message: string) => {
      messages.push(message);
    }, { signal: controller.signal });
    const listening2 = mq2.listen((message: string) => {
      messages.push(message);
    }, { signal: controller.signal });

    // enqueue()
    await mq.enqueue("Hello, world!");

    await waitFor(() => messages.length > 0, 15_000);

    // listen()
    assert.deepStrictEqual(messages, ["Hello, world!"]);

    // enqueue() with delay
    let started = 0;
    started = Date.now();
    await mq.enqueue(
      { msg: "Delayed message" },
      { delay: Temporal.Duration.from({ seconds: 3 }) },
    );

    await waitFor(() => messages.length > 1, 15_000);

    // listen() with delay
    assert.deepStrictEqual(messages, ["Hello, world!", {
      msg: "Delayed message",
    }]);
    assert.ok(Date.now() - started > 3_000);

    // enqueueMany()
    while (messages.length > 0) messages.pop();
    const batchMessages = [
      "First batch message",
      { text: "Second batch message" },
      { text: "Third batch message", priority: "high" },
    ];
    await mq.enqueueMany(batchMessages);
    await waitFor(() => messages.length === batchMessages.length, 15_000);
    assert.deepStrictEqual(messages, batchMessages);

    // enqueueMany() with delay
    while (messages.length > 0) messages.pop();
    started = Date.now();
    const delayedBatchMessages = [
      "Delayed batch 1",
      "Delayed batch 2",
    ];
    await mq.enqueueMany(
      delayedBatchMessages,
      { delay: Temporal.Duration.from({ seconds: 2 }) },
    );
    await waitFor(
      () => messages.length === delayedBatchMessages.length,
      15_000,
    );
    assert.deepStrictEqual(messages, delayedBatchMessages);
    assert.ok(Date.now() - started > 2_000);

    controller.abort();
    await listening;
    await listening2;
  } finally {
    await mq.drop();
    await sql.end();
    await sql2.end();
  }
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    await delay(500);
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timeout");
    }
  }
}
