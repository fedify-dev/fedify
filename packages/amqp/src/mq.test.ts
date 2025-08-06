import { suite } from "@alinea/suite";
import { AmqpMessageQueue } from "@fedify/amqp/mq";
import * as temporal from "@js-temporal/polyfill";
import { assert, assertEquals, assertFalse, assertGreater } from "@std/assert";
import { delay } from "@std/async/delay";
// @deno-types="npm:@types/amqplib"
import { type ChannelModel, connect } from "amqplib";
import process from "node:process";

let Temporal: typeof temporal.Temporal;
if ("Temporal" in globalThis) {
  Temporal = globalThis.Temporal;
} else {
  Temporal = temporal.Temporal;
}

const AMQP_URL = process.env.AMQP_URL;
const test = AMQP_URL ? suite(import.meta) : suite(import.meta).skip;

function getConnection(): Promise<ChannelModel> {
  return connect(AMQP_URL!);
}

test("AmqpMessageQueue", {
  sanitizeOps: false,
  sanitizeExit: false,
  sanitizeResources: false,
}, async () => {
  const conn = await getConnection();
  const conn2 = await getConnection();
  const randomSuffix = Math.random().toString(36).substring(2);
  const queue = `fedify_queue_${randomSuffix}`;
  const delayedQueuePrefix = `fedify_delayed_${randomSuffix}_`;
  const mq = new AmqpMessageQueue(conn, { queue, delayedQueuePrefix });
  const mq2 = new AmqpMessageQueue(conn2, { queue, delayedQueuePrefix });

  const messages1: string[] = [];
  const messages2: string[] = [];
  const allMessages: string[] = [];
  const controller = new AbortController();
  const listening = mq.listen((message: string) => {
    messages1.push(message);
    allMessages.push(message);
  }, { signal: controller.signal });
  const listening2 = mq2.listen((message: string) => {
    messages2.push(message);
    allMessages.push(message);
  }, { signal: controller.signal });

  await mq.enqueue("Hello, world!");

  await waitFor(() => allMessages.length > 0, 15_000);

  assertEquals(allMessages.includes("Hello, world!"), true);

  // enqueue() with delay
  const started = Date.now();
  await mq.enqueue(
    "Delayed message",
    { delay: Temporal.Duration.from({ seconds: 3 }) },
  );

  await waitFor(() => allMessages.includes("Delayed message"), 15_000);

  // listen() with delay
  assertEquals(allMessages.includes("Delayed message"), true);
  assertGreater(Date.now() - started, 3_000);

  await mq.enqueueMany(["Message 1", "Message 2", "Message 3"]);

  await waitFor(() =>
    allMessages.includes("Message 1") &&
    allMessages.includes("Message 2") &&
    allMessages.includes("Message 3"), 15_000);

  // listen() after enqueueMany()
  assertEquals(allMessages.includes("Message 1"), true);
  assertEquals(allMessages.includes("Message 2"), true);
  assertEquals(allMessages.includes("Message 3"), true);

  // enqueueMany() with delay
  const manyStarted = Date.now();
  await mq.enqueueMany(
    ["Delayed batch 1", "Delayed batch 2"],
    { delay: Temporal.Duration.from({ seconds: 3 }) },
  );

  await waitFor(() =>
    allMessages.includes("Delayed batch 1") &&
    allMessages.includes("Delayed batch 2"), 15_000);

  // listen() after enqueueMany() with delay
  assertEquals(allMessages.includes("Delayed batch 1"), true);
  assertEquals(allMessages.includes("Delayed batch 2"), true);
  assertGreater(Date.now() - manyStarted, 3_000);

  controller.abort();
  await listening;
  await listening2;

  await conn.close();
  await conn2.close();
});

test(
  "AmqpMessageQueue [nativeRetrial: false]",
  { sanitizeOps: false, sanitizeExit: false, sanitizeResources: false },
  async () => {
    const conn = await getConnection();
    const randomSuffix = Math.random().toString(36).substring(2);
    const queue = `fedify_queue_${randomSuffix}`;
    const delayedQueuePrefix = `fedify_delayed_${randomSuffix}_`;
    const mq = new AmqpMessageQueue(conn, { queue, delayedQueuePrefix });
    assertFalse(mq.nativeRetrial);

    const controller = new AbortController();
    let i = 0;
    const listening = mq.listen((message: string) => {
      if (message !== "Hello, world!") return;
      if (i++ < 1) {
        throw new Error("Test error to check native retrial");
      }
    }, { signal: controller.signal });

    await mq.enqueue("Hello, world!");

    await waitFor(() => i >= 1, 15_000);
    assertEquals(i, 1);
    await delay(5_000);

    controller.abort();
    await listening;
    await conn.close();

    assertEquals(i, 1);
  },
);

test(
  "AmqpMessageQueue [nativeRetrial: true]",
  { sanitizeOps: false, sanitizeExit: false, sanitizeResources: false },
  async () => {
    const conn = await getConnection();
    const randomSuffix = Math.random().toString(36).substring(2);
    const queue = `fedify_queue_${randomSuffix}`;
    const delayedQueuePrefix = `fedify_delayed_${randomSuffix}_`;
    const mq = new AmqpMessageQueue(conn, {
      queue,
      delayedQueuePrefix,
      nativeRetrial: true,
    });
    assert(mq.nativeRetrial);

    const controller = new AbortController();
    let i = 0;
    const listening = mq.listen((message: string) => {
      if (message !== "Hello, world!") return;
      if (i++ < 1) {
        throw new Error("Test error to check native retrial");
      }
    }, { signal: controller.signal });

    await mq.enqueue("Hello, world!");

    await waitFor(() => i > 1, 15_000);

    controller.abort();
    await listening;
    await conn.close();

    assertGreater(i, 1);
  },
);

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
