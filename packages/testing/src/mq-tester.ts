import type { MessageQueue } from "@fedify/fedify";
import { delay } from "es-toolkit";
import { deepStrictEqual, ok } from "node:assert/strict";

/**
 * Tests a {@link MessageQueue} implementation with a standard set of tests.
 *
 * This function runs tests for:
 * - `enqueue()`: Basic message enqueueing
 * - `enqueue()` with delay: Delayed message enqueueing
 * - `enqueueMany()`: Bulk message enqueueing
 * - `enqueueMany()` with delay: Delayed bulk message enqueueing
 * - Multiple listeners: Ensures messages are processed by only one listener
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
): Promise<void> {
  const mq1 = await getMessageQueue();
  const mq2 = await getMessageQueue();
  const controller = new AbortController();
  try {
    // Set up message collection and listeners
    const messages: string[] = [];
    const listening1 = mq1.listen((message: string) => {
      messages.push(message);
    }, controller);
    const listening2 = mq2.listen((message: string) => {
      messages.push(message);
    }, controller);

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

    // Cleanup listeners
    controller.abort();
    await listening1;
    await listening2;
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
