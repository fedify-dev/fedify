import { test } from "@fedify/fixture";
import { RedisMessageQueue } from "@fedify/redis/mq";
import { getRandomKey, testMessageQueue } from "@fedify/testing";
import * as temporal from "@js-temporal/polyfill";
import assert from "node:assert/strict";
import process from "node:process";

import { Redis } from "ioredis";

const Temporal = globalThis.Temporal ?? temporal.Temporal;

const dbUrl = process.env.REDIS_URL;

async function disposeMessageQueue(mq: object): Promise<void> {
  if (Symbol.asyncDispose in mq) {
    const dispose = mq[Symbol.asyncDispose];
    if (typeof dispose === "function") {
      await dispose.call(mq);
      return;
    }
  }
  if (Symbol.dispose in mq) {
    const dispose = mq[Symbol.dispose];
    if (typeof dispose === "function") dispose.call(mq);
  }
}

test("RedisMessageQueue", { ignore: dbUrl == null }, () => {
  const channelKey = getRandomKey("channel");
  const queueKey = getRandomKey("queue");
  const lockKey = getRandomKey("lock");
  return testMessageQueue(
    () =>
      new RedisMessageQueue(() => new Redis(dbUrl!), {
        pollInterval: { seconds: 1 },
        channelKey,
        queueKey,
        lockKey,
      }),
    async ({ mq1, mq2, controller }) => {
      controller.abort();
      await disposeMessageQueue(mq1);
      await disposeMessageQueue(mq2);
    },
    { testOrderingKey: true },
  );
});

test("RedisMessageQueue.getDepth()", { ignore: dbUrl == null }, async () => {
  if (dbUrl == null) return; // Bun does not support skip option
  const channelKey = getRandomKey("channel_depth");
  const queueKey = getRandomKey("queue_depth");
  const lockKey = getRandomKey("lock_depth");
  const mq = new RedisMessageQueue(() => new Redis(dbUrl), {
    channelKey,
    queueKey,
    lockKey,
  });
  try {
    assert.deepStrictEqual(await mq.getDepth(), {
      queued: 0,
      ready: 0,
      delayed: 0,
    });
    await mq.enqueue("ready");
    await mq.enqueue("delayed", {
      delay: Temporal.Duration.from({ hours: 1 }),
    });
    assert.deepStrictEqual(await mq.getDepth(), {
      queued: 2,
      ready: 1,
      delayed: 1,
    });
  } finally {
    await disposeMessageQueue(mq);
  }
});
