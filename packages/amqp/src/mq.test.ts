import { suite } from "@alinea/suite";
import { AmqpMessageQueue } from "@fedify/amqp/mq";
import { getRandomKey, testMessageQueue, waitFor } from "@fedify/testing";
import { assert, assertEquals, assertFalse, assertGreater } from "@std/assert";
import { delay } from "@std/async/delay";
// @deno-types="npm:@types/amqplib"
import { type ChannelModel, connect } from "amqplib";
import process from "node:process";

const AMQP_URL = process.env.AMQP_URL;
const test = AMQP_URL ? suite(import.meta) : suite(import.meta).skip;

function getConnection(): Promise<ChannelModel> {
  return connect(AMQP_URL!);
}

const connections: ChannelModel[] = [];
const queue = getRandomKey("queue");
const delayedQueuePrefix = getRandomKey("delayed") + "_";

testMessageQueue(
  "AmqpMessageQueue",
  async () => {
    const conn = await getConnection();
    connections.push(conn);
    return new AmqpMessageQueue(conn, { queue, delayedQueuePrefix });
  },
  async ({ controller }) => {
    controller.abort();
    for (const conn of connections) {
      await conn.close();
    }
  },
  {
    test: (name, fn) =>
      test(name, {
        sanitizeOps: false,
        sanitizeExit: false,
        sanitizeResources: false,
      }, fn),
  },
);

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
