import { test } from "@fedify/fixture";
import { RedisMessageQueue } from "@fedify/redis/mq";
import { getRandomKey, testMessageQueue } from "@fedify/testing";
import process from "node:process";

import { Redis } from "ioredis";

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
