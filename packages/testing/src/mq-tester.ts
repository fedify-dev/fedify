import type { MessageQueue } from "@fedify/fedify";
import { delay } from "es-toolkit";
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";

/**
 * Options for {@link testMessageQueue}.
 */
export interface TestMessageQueueOptions {
  /**
   * Whether to test ordering key support.  If `true`, tests will verify that
   * messages with the same ordering key are processed in order, while messages
   * with different ordering keys can be processed in parallel.
   *
   * Set this to `true` only if your message queue implementation supports
   * the `orderingKey` option.
   *
   * @default false
   */
  readonly testOrderingKey?: boolean;
}

/**
 * Tests a {@link MessageQueue} implementation with a standard set of tests.
 *
 * This function runs tests for:
 * - `enqueue()`: Basic message enqueueing
 * - `enqueue()` with delay: Delayed message enqueueing
 * - `enqueueMany()`: Bulk message enqueueing
 * - `enqueueMany()` with delay: Delayed bulk message enqueueing
 * - Multiple listeners: Ensures messages are processed by only one listener
 * - Ordering key support (optional): Ensures messages with the same ordering
 *   key are processed in order
 *
 * @example
 * ```typescript ignore
 * import { test } from "@fedify/fixture";
 * import { testMessageQueue } from "@fedify/testing";
 * import { MyMessageQueue } from "./my-mq.ts";
 *
 * test("MyMessageQueue", () =>
 *   testMessageQueue(
 *     () => new MyMessageQueue(),
 *     async ({ mq1, mq2, controller }) => {
 *       controller.abort();
 *       await mq1.close();
 *       await mq2.close();
 *     },
 *     { testOrderingKey: true },  // Enable ordering key tests
 *   )
 * );
 * ```
 *
 * @param getMessageQueue A factory function that creates a new message queue
 *                        instance.  It should return a new instance each time
 *                        to ensure test isolation, but both instances should
 *                        share the same underlying storage/channel.
 * @param onFinally A cleanup function called after all tests complete.
 *                  It receives both message queue instances and the abort
 *                  controller used for the listeners.
 * @param options Optional configuration for the test suite.
 * @returns A promise that resolves when all tests pass.
 */
export default async function testMessageQueue<
  MQ extends MessageQueue,
>(
  getMessageQueue: () => MQ | Promise<MQ>,
  onFinally: ({
    mq1,
    mq2,
    controller,
  }: {
    mq1: MQ;
    mq2: MQ;
    controller: AbortController;
  }) => Promise<void> | void,
  options: TestMessageQueueOptions = {},
): Promise<void> {
  const mq1 = await getMessageQueue();
  const mq2 = await getMessageQueue();
  const controller = new AbortController();
  try {
    // Set up message collection and listeners
    const messages: string[] = [];
    const listening1 = mq1.listen((message: string) => {
      messages.push(message);
    }, { signal: controller.signal });
    const listening2 = mq2.listen((message: string) => {
      messages.push(message);
    }, { signal: controller.signal });

    // Test: enqueue()
    await mq1.enqueue("Hello, world!");
    await waitFor(() => messages.length > 0, 15_000);
    deepStrictEqual(messages, ["Hello, world!"]);

    let started = Date.now();
    await mq1.enqueue(
      "Delayed message",
      { delay: Temporal.Duration.from({ seconds: 3 }) },
    );
    await waitFor(() => messages.length > 1, 15_000);
    deepStrictEqual(messages, ["Hello, world!", "Delayed message"]);
    ok(
      Date.now() - started >= 3_000,
      "Delayed message should be delivered after at least 3 seconds",
    );

    // Test: enqueueMany() (skip if not supported)
    if (mq1.enqueueMany != null) {
      while (messages.length > 0) messages.pop();
      const batchMessages: string[] = [
        "First batch message",
        "Second batch message",
        "Third batch message",
      ];
      await mq1.enqueueMany(batchMessages);
      await waitFor(() => messages.length >= batchMessages.length, 15_000);
      deepStrictEqual(new Set(messages), new Set(batchMessages));

      // Test: enqueueMany() with delay
      while (messages.length > 0) messages.pop();
      started = Date.now();
      const delayedBatchMessages: string[] = [
        "Delayed batch 1",
        "Delayed batch 2",
      ];
      await mq1.enqueueMany(
        delayedBatchMessages,
        { delay: Temporal.Duration.from({ seconds: 2 }) },
      );
      await waitFor(
        () => messages.length >= delayedBatchMessages.length,
        15_000,
      );
      deepStrictEqual(new Set(messages), new Set(delayedBatchMessages));
      ok(
        Date.now() - started >= 2_000,
        "Delayed batch messages should be delivered after at least 2 seconds",
      );
    }

    // Test: bulk enqueue (stress test)
    while (messages.length > 0) messages.pop();
    const bulkCount = 100;
    for (let i = 0; i < bulkCount; i++) await mq1.enqueue(`message-${i}`);
    await waitFor(() => messages.length >= bulkCount, 30_000);
    const expectedMessages = new Set(
      Array.from({ length: bulkCount }, (_, i) => `message-${i}`),
    );
    deepStrictEqual(new Set(messages), expectedMessages);

    // Test: ordering key support (optional)
    if (options.testOrderingKey) {
      while (messages.length > 0) messages.pop();

      // Track the order of message processing per ordering key
      const orderTracker: Record<string, number[]> = {
        keyA: [],
        keyB: [],
        noKey: [],
      };

      // Restart listeners with order tracking
      controller.abort();
      await listening1;
      await listening2;

      const orderController = new AbortController();
      const orderMessages: { key: string | null; value: number }[] = [];
      const orderListening1 = mq1.listen(
        (message: { key: string | null; value: number }) => {
          orderMessages.push(message);
          const trackKey = message.key ?? "noKey";
          if (trackKey in orderTracker) {
            orderTracker[trackKey].push(message.value);
          }
        },
        { signal: orderController.signal },
      );
      const orderListening2 = mq2.listen(
        (message: { key: string | null; value: number }) => {
          orderMessages.push(message);
          const trackKey = message.key ?? "noKey";
          if (trackKey in orderTracker) {
            orderTracker[trackKey].push(message.value);
          }
        },
        { signal: orderController.signal },
      );

      // Enqueue messages with different ordering keys
      // Messages with the same key should be processed in order
      await mq1.enqueue({ key: "keyA", value: 1 }, { orderingKey: "keyA" });
      await mq1.enqueue({ key: "keyB", value: 1 }, { orderingKey: "keyB" });
      await mq1.enqueue({ key: "keyA", value: 2 }, { orderingKey: "keyA" });
      await mq1.enqueue({ key: "keyB", value: 2 }, { orderingKey: "keyB" });
      await mq1.enqueue({ key: "keyA", value: 3 }, { orderingKey: "keyA" });
      await mq1.enqueue({ key: "keyB", value: 3 }, { orderingKey: "keyB" });
      await mq1.enqueue({ key: null, value: 1 }); // No ordering key
      await mq1.enqueue({ key: null, value: 2 }); // No ordering key

      await waitFor(() => orderMessages.length >= 8, 30_000);

      // Verify that messages with the same ordering key are processed in order
      deepStrictEqual(
        orderTracker.keyA,
        [1, 2, 3],
        "Messages with orderingKey 'keyA' should be processed in order",
      );
      deepStrictEqual(
        orderTracker.keyB,
        [1, 2, 3],
        "Messages with orderingKey 'keyB' should be processed in order",
      );

      // Messages without ordering key should all be received (order not guaranteed)
      strictEqual(
        orderTracker.noKey.length,
        2,
        "Messages without ordering key should all be received",
      );
      ok(
        orderTracker.noKey.includes(1) && orderTracker.noKey.includes(2),
        "Messages without ordering key should contain values 1 and 2",
      );

      orderController.abort();
      await orderListening1;
      await orderListening2;
    } else {
      // Cleanup listeners
      controller.abort();
      await listening1;
      await listening2;
    }
  } finally {
    await onFinally({ mq1, mq2, controller });
  }
}

export async function waitFor(
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

export const getRandomKey = (prefix: string): string =>
  `fedify_test_${prefix}_${crypto.randomUUID()}`;
