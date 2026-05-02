import { suite } from "@alinea/suite";
import { AmqpMessageQueue } from "@fedify/amqp/mq";
import { getRandomKey, testMessageQueue, waitFor } from "@fedify/testing";
import * as temporal from "@js-temporal/polyfill";
import { assert, assertEquals, assertFalse, assertGreater } from "@std/assert";
import { delay } from "@std/async/delay";
// @deno-types="npm:@types/amqplib"
import { type Channel, type ChannelModel, connect } from "amqplib";
import process from "node:process";

const Temporal = globalThis.Temporal ?? temporal.Temporal;

const AMQP_URL = process.env.AMQP_URL;
const unitTest = suite(import.meta);
const test = AMQP_URL ? unitTest : unitTest.skip;

class FakeDepthChannel {
  #closed = false;

  constructor(private readonly connection: FakeDepthConnection) {
  }

  on(): void {
  }

  assertQueue(
    queue: string,
    options?: { expires?: number },
  ): Promise<void> {
    if (this.#closed) {
      return Promise.reject(new Error("Channel is closed"));
    }
    if (
      options?.expires != null &&
      this.connection.preconditionOnExpires.has(queue)
    ) {
      this.#closed = true;
      this.connection.preconditionOnExpires.delete(queue);
      return Promise.reject(
        Object.assign(new Error("PRECONDITION_FAILED"), { code: 406 }),
      );
    }
    this.connection.queues.add(queue);
    if (options?.expires != null) {
      this.connection.queueExpires.set(queue, options.expires);
    }
    return Promise.resolve();
  }

  sendToQueue(queue: string): boolean {
    if (this.#closed) throw new Error("Channel is closed");
    this.connection.messageCounts.set(
      queue,
      (this.connection.messageCounts.get(queue) ?? 0) + 1,
    );
    return true;
  }

  async checkQueue(queue: string): Promise<{ messageCount: number }> {
    if (this.#closed) throw new Error("Channel is closed");
    this.connection.activeChecks++;
    this.connection.maxActiveChecks = Math.max(
      this.connection.maxActiveChecks,
      this.connection.activeChecks,
    );
    try {
      if (this.connection.checkDelayMs > 0) {
        await delay(this.connection.checkDelayMs);
      }
      return { messageCount: this.connection.messageCounts.get(queue) ?? 0 };
    } finally {
      this.connection.activeChecks--;
    }
  }

  close(): Promise<void> {
    this.#closed = true;
    return Promise.resolve();
  }
}

class FakeDepthConnection {
  readonly queues = new Set<string>();
  readonly queueExpires = new Map<string, number>();
  readonly messageCounts = new Map<string, number>();
  readonly preconditionOnExpires = new Set<string>();
  activeChecks = 0;
  channelCount = 0;
  maxActiveChecks = 0;

  constructor(readonly checkDelayMs: number = 25) {
  }

  createChannel(): Promise<Channel> {
    this.channelCount++;
    return Promise.resolve(new FakeDepthChannel(this) as unknown as Channel);
  }
}

unitTest(
  "AmqpMessageQueue.getDepth() probes delayed queues concurrently",
  async () => {
    const conn = new FakeDepthConnection();
    const mq = new AmqpMessageQueue(conn as unknown as ChannelModel, {
      queue: "ready",
      delayedQueuePrefix: "delayed_",
    });

    await mq.enqueue("first", {
      delay: Temporal.Duration.from({ milliseconds: 1_000 }),
    });
    await mq.enqueue("second", {
      delay: Temporal.Duration.from({ milliseconds: 2_000 }),
    });
    await mq.enqueue("third", {
      delay: Temporal.Duration.from({ milliseconds: 3_000 }),
    });

    assertEquals(await mq.getDepth(), {
      queued: 3,
      ready: 0,
      delayed: 3,
    });
    assertGreater(conn.maxActiveChecks, 1);
  },
);

unitTest("AmqpMessageQueue sets delayed queue expiry", async () => {
  const conn = new FakeDepthConnection();
  const mq = new AmqpMessageQueue(conn as unknown as ChannelModel, {
    queue: "ready",
    delayedQueuePrefix: "delayed_",
  });

  await mq.enqueue("delayed", {
    delay: Temporal.Duration.from({ milliseconds: 1_000 }),
  });

  assertEquals(conn.queueExpires.get("delayed_1000"), 61_000);
});

unitTest(
  "AmqpMessageQueue falls back for existing delayed queues without expiry",
  async () => {
    const conn = new FakeDepthConnection();
    conn.preconditionOnExpires.add("delayed_1000");
    const mq = new AmqpMessageQueue(conn as unknown as ChannelModel, {
      queue: "ready",
      delayedQueuePrefix: "delayed_",
    });

    await mq.enqueue("delayed", {
      delay: Temporal.Duration.from({ milliseconds: 1_000 }),
    });

    assertEquals(conn.messageCounts.get("delayed_1000"), 1);
    assertEquals(conn.queueExpires.get("delayed_1000"), undefined);
    assertGreater(conn.channelCount, 1);
  },
);

unitTest("AmqpMessageQueue reuses depth probe channels", async () => {
  const conn = new FakeDepthConnection(0);
  const mq = new AmqpMessageQueue(conn as unknown as ChannelModel, {
    queue: "ready",
    delayedQueuePrefix: "delayed_",
  });

  for (let milliseconds = 1; milliseconds <= 12; milliseconds++) {
    await mq.enqueue("delayed", {
      delay: Temporal.Duration.from({ milliseconds }),
    });
  }
  conn.channelCount = 0;

  assertEquals(await mq.getDepth(), {
    queued: 12,
    ready: 0,
    delayed: 12,
  });
  assert(
    conn.channelCount <= 9,
    `expected at most 9 depth probe channels, got ${conn.channelCount}`,
  );
});

unitTest(
  "AmqpMessageQueue keeps delayed queues past cleanup threshold",
  async () => {
    const conn = new FakeDepthConnection(0);
    const mq = new AmqpMessageQueue(conn as unknown as ChannelModel, {
      queue: "ready",
      delayedQueuePrefix: "delayed_",
    });

    for (let milliseconds = 1; milliseconds <= 4097; milliseconds++) {
      await mq.enqueue("delayed", {
        delay: Temporal.Duration.from({ milliseconds }),
      });
    }

    assertEquals(await mq.getDepth(), {
      queued: 4097,
      ready: 0,
      delayed: 4097,
    });
  },
);

unitTest(
  "AmqpMessageQueue.getDepth() keeps delayed queues past local expiry",
  async () => {
    const now = Date.now;
    const started = now();
    Date.now = () => started;
    try {
      const conn = new FakeDepthConnection();
      const mq = new AmqpMessageQueue(conn as unknown as ChannelModel, {
        queue: "ready",
        delayedQueuePrefix: "delayed_",
      });

      await mq.enqueue("delayed", {
        delay: Temporal.Duration.from({ milliseconds: 1_000 }),
      });
      Date.now = () => started + 62_000;

      assertEquals(await mq.getDepth(), {
        queued: 1,
        ready: 0,
        delayed: 1,
      });
    } finally {
      Date.now = now;
    }
  },
);

function getConnection(): Promise<ChannelModel> {
  return connect(AMQP_URL!);
}

const connections: ChannelModel[] = [];
const queue = getRandomKey("queue");
const delayedQueuePrefix = getRandomKey("delayed") + "_";

test(
  "AmqpMessageQueue",
  { sanitizeOps: false, sanitizeExit: false, sanitizeResources: false },
  () =>
    testMessageQueue(
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
    ),
);

test(
  "AmqpMessageQueue.getDepth()",
  { sanitizeOps: false, sanitizeExit: false, sanitizeResources: false },
  async () => {
    const conn = await getConnection();
    const queue = getRandomKey("depth_queue");
    const delayedQueuePrefix = getRandomKey("depth_delayed") + "_";
    const mq = new AmqpMessageQueue(conn, { queue, delayedQueuePrefix });
    try {
      assertEquals(await mq.getDepth(), {
        queued: 0,
        ready: 0,
        delayed: 0,
      });
      await mq.enqueue("ready");
      await mq.enqueue("delayed", {
        delay: Temporal.Duration.from({ seconds: 60 }),
      });
      const started = Date.now();
      while (Date.now() - started < 15_000) {
        const depth = await mq.getDepth();
        if (depth.queued === 2 && depth.ready === 1 && depth.delayed === 1) {
          break;
        }
        await delay(100);
      }
      assertEquals(await mq.getDepth(), {
        queued: 2,
        ready: 1,
        delayed: 1,
      });
    } finally {
      const channel = await conn.createChannel().catch(() => undefined);
      try {
        await channel?.deleteQueue(queue).catch(() => {});
        await channel?.deleteQueue(`${delayedQueuePrefix}60000`).catch(() => {
        });
      } finally {
        await channel?.close().catch(() => {});
        await conn.close().catch(() => {});
      }
    }
  },
);

// Test with ordering key support (requires rabbitmq_consistent_hash_exchange plugin)
const orderingConnections: ChannelModel[] = [];
const orderingQueue = getRandomKey("ordering_queue");
const orderingDelayedQueuePrefix = getRandomKey("ordering_delayed") + "_";
const orderingExchange = getRandomKey("ordering_exchange");
const orderingQueuePrefix = getRandomKey("ordering_partition") + "_";

// Only run ordering key tests if AMQP_ORDERING_TEST env var is set
// (requires rabbitmq_consistent_hash_exchange plugin to be enabled)
const orderingTest = process.env.AMQP_ORDERING_TEST
  ? test
  : suite(import.meta).skip;

orderingTest(
  "AmqpMessageQueue [ordering]",
  { sanitizeOps: false, sanitizeExit: false, sanitizeResources: false },
  () =>
    testMessageQueue(
      async () => {
        const conn = await getConnection();
        orderingConnections.push(conn);
        return new AmqpMessageQueue(conn, {
          queue: orderingQueue,
          delayedQueuePrefix: orderingDelayedQueuePrefix,
          ordering: {
            exchange: orderingExchange,
            queuePrefix: orderingQueuePrefix,
            partitions: 4,
          },
        });
      },
      async ({ controller }) => {
        controller.abort();
        for (const conn of orderingConnections) {
          await conn.close();
        }
      },
      { testOrderingKey: true },
    ),
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
