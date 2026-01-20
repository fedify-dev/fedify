import { test } from "@fedify/fixture";
import { RedisMessageQueue } from "@fedify/redis/mq";
import { getRandomKey, testMessageQueue } from "@fedify/testing";
import process from "node:process";

import { Redis } from "ioredis";

const dbUrl = process.env.REDIS_URL;

test("RedisMessageQueue", { ignore: dbUrl == null }, () =>
  testMessageQueue(
    () =>
      new RedisMessageQueue(() => new Redis(dbUrl!), {
        pollInterval: { seconds: 1 },
        channelKey: getRandomKey("channel"),
        queueKey: getRandomKey("queue"),
        lockKey: getRandomKey("lock"),
      }),
    ({ mq1, mq2, controller }) => {
      controller.abort();
      mq1[Symbol.dispose]();
      mq2[Symbol.dispose]();
    },
  ));
