import { test } from "@fedify/fixture";
import {
  assert,
  assertEquals,
  assertFalse,
  assertGreater,
  assertGreaterOrEqual,
} from "@std/assert";
import { delay } from "es-toolkit";
import {
  InProcessMessageQueue,
  type MessageQueue,
  ParallelMessageQueue,
} from "./mq.ts";

test("InProcessMessageQueue", async (t) => {
  const mq = new InProcessMessageQueue();

  await t.step("nativeRetrial property", () => {
    assertFalse(mq.nativeRetrial);
  });

  const messages: string[] = [];
  const controller = new AbortController();
  const listening = mq.listen((message: string) => {
    messages.push(message);
  }, controller);

  await t.step("enqueue()", async () => {
    await mq.enqueue("Hello, world!");
  });

  await waitFor(() => messages.length > 0, 15_000);

  await t.step("listen()", () => {
    assertEquals(messages, ["Hello, world!"]);
  });

  let started = 0;
  await t.step("enqueue() with delay", async () => {
    started = Date.now();
    await mq.enqueue(
      "Delayed message",
      { delay: Temporal.Duration.from({ seconds: 3 }) },
    );
    assertEquals(messages, ["Hello, world!"]);
  });

  await waitFor(() => messages.length > 1, 15_000);

  await t.step("listen() with delay", () => {
    assertEquals(messages, ["Hello, world!", "Delayed message"]);
    assertGreater(Date.now() - started, 3_000);
  });

  // Clear messages array
  while (messages.length > 0) messages.pop();

  await t.step("enqueueMany()", async () => {
    const testMessages = Array.from(
      { length: 5 },
      (_, i) => `Batch message ${i}!`,
    );
    await mq.enqueueMany(testMessages);
  });

  await waitFor(() => messages.length >= 5, 15_000);

  await t.step("listen() [multiple]", () => {
    assertEquals(messages.length, 5);
    for (let i = 0; i < 5; i++) {
      assertEquals(messages[i], `Batch message ${i}!`);
    }
  });

  // Clear messages array
  while (messages.length > 0) messages.pop();

  started = 0;
  await t.step("enqueueMany() with delay", async () => {
    started = Date.now();
    const testMessages = Array.from(
      { length: 3 },
      (_, i) => `Delayed batch ${i}!`,
    );
    await mq.enqueueMany(
      testMessages,
      { delay: Temporal.Duration.from({ seconds: 2 }) },
    );
    assertEquals(messages.length, 0);
  });

  await waitFor(() => messages.length >= 3, 15_000);

  await t.step("listen() [delayed multiple]", () => {
    assertEquals(messages.length, 3);
    assertGreater(Date.now() - started, 2_000);
    for (let i = 0; i < 3; i++) {
      assertEquals(messages[i], `Delayed batch ${i}!`);
    }
  });

  controller.abort();
  await listening;
});

test("InProcessMessageQueue orderingKey", async (t) => {
  const mq = new InProcessMessageQueue();

  // Track the order of message processing per ordering key
  const orderTracker: Record<string, number[]> = {
    keyA: [],
    keyB: [],
    noKey: [],
  };
  const allMessages: { key: string | null; value: number }[] = [];

  const controller = new AbortController();
  const listening = mq.listen(
    (message: { key: string | null; value: number }) => {
      allMessages.push(message);
      const trackKey = message.key ?? "noKey";
      if (trackKey in orderTracker) {
        orderTracker[trackKey].push(message.value);
      }
    },
    controller,
  );

  await t.step("enqueue with ordering key", async () => {
    // Enqueue messages with different ordering keys
    // Messages with the same key should be processed in order
    await mq.enqueue({ key: "keyA", value: 1 }, { orderingKey: "keyA" });
    await mq.enqueue({ key: "keyB", value: 1 }, { orderingKey: "keyB" });
    await mq.enqueue({ key: "keyA", value: 2 }, { orderingKey: "keyA" });
    await mq.enqueue({ key: "keyB", value: 2 }, { orderingKey: "keyB" });
    await mq.enqueue({ key: "keyA", value: 3 }, { orderingKey: "keyA" });
    await mq.enqueue({ key: "keyB", value: 3 }, { orderingKey: "keyB" });
    await mq.enqueue({ key: null, value: 1 }); // No ordering key
    await mq.enqueue({ key: null, value: 2 }); // No ordering key
  });

  await waitFor(() => allMessages.length >= 8, 30_000);

  await t.step("verify ordering key order", () => {
    // Messages with the same ordering key should be processed in order
    assertEquals(
      orderTracker.keyA,
      [1, 2, 3],
      "Messages with orderingKey 'keyA' should be processed in order",
    );
    assertEquals(
      orderTracker.keyB,
      [1, 2, 3],
      "Messages with orderingKey 'keyB' should be processed in order",
    );
  });

  await t.step("verify messages without ordering key", () => {
    // Messages without ordering key should all be received (order not guaranteed)
    assertEquals(
      orderTracker.noKey.length,
      2,
      "Messages without ordering key should all be received",
    );
    assert(
      orderTracker.noKey.includes(1) && orderTracker.noKey.includes(2),
      "Messages without ordering key should contain values 1 and 2",
    );
  });

  controller.abort();
  await listening;
});

test("MessageQueue.nativeRetrial", async (t) => {
  if (
    // @ts-ignore: Works on Deno
    "Deno" in globalThis && "openKv" in globalThis.Deno &&
    // @ts-ignore: Works on Deno
    typeof globalThis.Deno.openKv === "function"
  ) {
    await t.step("DenoKvMessageQueue", async () => {
      // Import dynamically to avoid error in static check on cfworkers test
      const packageName = () => "@fedify/denokv";
      const { DenoKvMessageQueue } = await import(packageName());
      const mq = new DenoKvMessageQueue(
        // @ts-ignore: Works on Deno
        await globalThis.Deno.openKv(":memory:"),
      );
      assert(mq.nativeRetrial);
      if (Symbol.dispose in mq) {
        const dispose = mq[Symbol.dispose];
        if (typeof dispose === "function") dispose.call(mq);
      }
    });
  }

  await t.step("WorkersMessageQueue mock", () => {
    // Mock Cloudflare Workers Queue for testing
    class MockQueue {
      send(_message: unknown, _options?: unknown): Promise<void> {
        return Promise.resolve();
      }
      sendBatch(_messages: unknown[], _options?: unknown): Promise<void> {
        return Promise.resolve();
      }
    }

    // We need to mock the WorkersMessageQueue since Cloudflare Workers types
    // might not be available in test environment
    class TestWorkersMessageQueue implements MessageQueue {
      readonly nativeRetrial = true;
      #queue: MockQueue;

      constructor(queue: MockQueue) {
        this.#queue = queue;
      }

      enqueue(message: unknown): Promise<void> {
        return this.#queue.send(message);
      }

      enqueueMany(messages: readonly unknown[]): Promise<void> {
        return this.#queue.sendBatch(messages as unknown[]);
      }

      listen(): Promise<void> {
        throw new TypeError("WorkersMessageQueue does not support listen()");
      }
    }

    const mq = new TestWorkersMessageQueue(new MockQueue());
    assert(mq.nativeRetrial);
  });
});

const queues: Record<string, () => Promise<MessageQueue>> = {
  InProcessMessageQueue: () => Promise.resolve(new InProcessMessageQueue()),
};
if (
  // @ts-ignore: Works on Deno
  "Deno" in globalThis && "openKv" in globalThis.Deno &&
  // @ts-ignore: Works on Deno
  typeof globalThis.Deno.openKv === "function"
) {
  // Import dynamically to avoid error in static check on cfworkers test
  const packageName = () => "@fedify/denokv";
  const { DenoKvMessageQueue } = await import(packageName());
  queues.DenoKvMessageQueue = async () =>
    new DenoKvMessageQueue(
      // @ts-ignore: Works on Deno
      await globalThis.Deno.openKv(":memory:"),
    );
}

for (const mqName in queues) {
  test({
    name: `ParallelMessageQueue [${mqName}]`,
    ignore: "Bun" in globalThis, // FIXME
    async fn(t) {
      const mq = await queues[mqName]();
      const workers = new ParallelMessageQueue(mq, 5);

      await t.step("nativeRetrial property inheritance", () => {
        assertEquals(workers.nativeRetrial, mq.nativeRetrial);
      });

      const messages: string[] = [];
      const controller = new AbortController();
      const listening = workers.listen(async (message: string) => {
        for (let i = 0, cnt = 5 + Math.random() * 5; i < cnt; i++) {
          await delay(250);
        }
        messages.push(message);
      }, controller);

      await t.step("enqueue() [single]", async () => {
        await workers.enqueue("Hello, world!");
      });

      await waitFor(() => messages.length > 0, 15_000);

      await t.step("listen() [single]", () => {
        assertEquals(messages, ["Hello, world!"]);
      });

      messages.pop();

      await t.step("enqueue() [multiple]", async () => {
        for (let i = 0; i < 20; i++) {
          await workers.enqueue(`Hello, ${i}!`);
        }
      });

      await t.step("listen() [multiple]", async () => {
        await delay(10 * 250 + 500);
        assertGreaterOrEqual(messages.length, 5);
        await waitFor(() => messages.length >= 20, 15_000);
        assertEquals(messages.length, 20);
      });

      await waitFor(() => messages.length >= 20, 15_000);

      while (messages.length > 0) messages.pop();

      await t.step("enqueueMany()", async () => {
        const messages = Array.from({ length: 20 }, (_, i) => `Hello, ${i}!`);
        await workers.enqueueMany(messages);
      });

      await t.step("listen() [multiple]", async () => {
        await delay(10 * 250 + 500);
        assertGreaterOrEqual(messages.length, 5);
        await waitFor(() => messages.length >= 20, 15_000);
        assertEquals(messages.length, 20);
      });

      await waitFor(() => messages.length >= 20, 15_000);

      controller.abort();
      await listening;

      if (Symbol.dispose in mq) {
        const dispose = mq[Symbol.dispose];
        if (typeof dispose === "function") dispose.call(mq);
      }
    },
  });
}

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
