import { RedisMessageQueue } from "@fedify/redis/mq";
import * as temporal from "@js-temporal/polyfill";
import { delay } from "@std/async/delay";
import { Redis } from "ioredis";
import assert from "node:assert/strict";
import process from "node:process";
import { test } from "node:test";

let Temporal: typeof temporal.Temporal;
if ("Temporal" in globalThis) {
  Temporal = globalThis.Temporal;
} else {
  Temporal = temporal.Temporal;
}

const redisUrl = process.env.REDIS_URL;

test("RedisMessageQueue", { skip: redisUrl == null }, async () => {
  const channelKey = `fedify_test_channel_${crypto.randomUUID()}`;
  const queueKey = `fedify_test_queue_${crypto.randomUUID()}`;
  const lockKey = `fedify_test_lock_${crypto.randomUUID()}`;
  const mq = new RedisMessageQueue(() => new Redis(redisUrl!), {
    pollInterval: { seconds: 1 },
    channelKey,
    queueKey,
    lockKey,
  });
  const mq2 = new RedisMessageQueue(() => new Redis(redisUrl!), {
    pollInterval: { seconds: 1 },
    channelKey,
    queueKey,
    lockKey,
  });

  const messages: (string | number)[] = [];
  const controller = new AbortController();
  const listening = mq.listen((message: string | number) => {
    messages.push(message);
  }, controller);
  const listening2 = mq2.listen((message: string | number) => {
    messages.push(message);
  }, controller);

  try {
    // enqueue()
    await mq.enqueue("Hello, world!");

    await waitFor(() => messages.length > 0, 15_000);

    // listen()
    assert.deepStrictEqual(messages, ["Hello, world!"]);

    // enqueue() with delay
    let started = 0;
    started = Date.now();
    await mq.enqueue(
      "Delayed message",
      { delay: Temporal.Duration.from({ seconds: 3 }) },
    );

    await waitFor(() => messages.length > 1, 15_000);

    // listen() with delay
    assert.deepStrictEqual(messages, ["Hello, world!", "Delayed message"]);
    assert.ok(Date.now() - started > 3_000);

    // enqueue() [bulk]
    for (let i = 0; i < 1_000; i++) await mq.enqueue(i);

    await waitFor(() => messages.length > 1_001, 30_000);

    // listen() [bulk]
    const numbers: Set<number> = new Set();
    for (let i = 0; i < 1_000; i++) numbers.add(i);
    assert.deepStrictEqual(new Set(messages.slice(2)), numbers);

    // Reset messages array for the next test:
    while (messages.length > 0) messages.pop();

    // enqueueMany()
    const bulkMessages = Array.from({ length: 500 }, (_, i) => `bulk-${i}`);
    await mq.enqueueMany(bulkMessages);

    await waitFor(() => messages.length >= 500, 30_000);

    // listen() after enqueueMany()
    const expectedMessages = new Set(
      Array.from({ length: 500 }, (_, i) => `bulk-${i}`),
    );
    assert.deepStrictEqual(new Set(messages), expectedMessages);
  } finally {
    controller.abort();
    await listening;
    await listening2;
    mq[Symbol.dispose]();
    mq2[Symbol.dispose]();
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
