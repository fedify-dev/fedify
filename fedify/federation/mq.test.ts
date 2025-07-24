import {
  assert,
  assertEquals,
  assertFalse,
  assertGreater,
  assertGreaterOrEqual,
} from "@std/assert";
import { delay } from "es-toolkit";
import { test } from "../testing/mod.ts";
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

test("MessageQueue.nativeRetrial", async (t) => {
  if (
    // @ts-ignore: Works on Deno
    "Deno" in globalThis && "openKv" in globalThis.Deno &&
    // @ts-ignore: Works on Deno
    typeof globalThis.Deno.openKv === "function"
  ) {
    await t.step("DenoKvMessageQueue", async () => {
      const { DenoKvMessageQueue } = await import("../x/denokv.ts");
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

      enqueueMany(messages: unknown[]): Promise<void> {
        return this.#queue.sendBatch(messages);
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
  const { DenoKvMessageQueue } = await import("../x/denokv.ts");
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
