import { test } from "@fedify/fixture";
import { delay } from "es-toolkit";
import { deepStrictEqual, ok, rejects, strictEqual } from "node:assert/strict";
import {
  baseOptions,
  makeSchema,
  MockQueue,
  numberSchema,
  stringSchema,
} from "../../testing/mod.ts";
import {
  type KvKey,
  type KvStore,
  type KvStoreListEntry,
  type KvStoreSetOptions,
  MemoryKvStore,
} from "../kv.ts";
import { createFederation } from "../middleware.ts";
import type { MessageQueue, MessageQueueEnqueueOptions } from "../mq.ts";
import type { TaskMessage } from "../queue.ts";

/**
 * A {@link KvStore} that delegates to an in-memory store but deliberately
 * omits `cas`, so that `kv.cas == null`.  This drives the deduplication
 * fallback branches that fire when no conditional-write primitive exists.
 */
class CaslessKvStore implements KvStore {
  readonly inner = new MemoryKvStore();
  get<T = unknown>(key: KvKey): Promise<T | undefined> {
    return this.inner.get<T>(key);
  }
  set(key: KvKey, value: unknown, options?: KvStoreSetOptions): Promise<void> {
    return this.inner.set(key, value, options);
  }
  delete(key: KvKey): Promise<void> {
    return this.inner.delete(key);
  }
  list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
    return this.inner.list(prefix);
  }
  // No `cas`: the fallback branch is reached precisely when `kv.cas == null`.
}

async function collectKeys(kv: KvStore, prefix: KvKey): Promise<KvKey[]> {
  const keys: KvKey[] = [];
  for await (const { key } of kv.list(prefix)) keys.push(key);
  return keys;
}

const TASK_DEDUP_PREFIX: KvKey = ["_fedify", "taskDeduplication"];
const ACTIVITY_IDEMPOTENCE_PREFIX: KvKey = ["_fedify", "activityIdempotence"];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test("enqueueTasks() validation and dispatch", async (t) => {
  await t.step("rejects an invalid payload at enqueue", async () => {
    const queue = new MockQueue();
    const federation = createFederation<void>({
      ...baseOptions,
      queue: { task: queue },
    });
    const task = federation.defineTask("strictly-typed", {
      schema: numberSchema,
      handler: () => {},
    });
    const ctx = federation.createContext(
      new URL("https://example.com/"),
      undefined,
    );
    await rejects(
      // deno-lint-ignore no-explicit-any
      () => ctx.enqueueTask(task, "not a number" as any),
      { name: "TypeError", message: /Task data failed schema validation/ },
    );
    strictEqual(queue.enqueued.length, 0);
  });

  await t.step("stamps the message envelope", async () => {
    const queue = new MockQueue();
    const federation = createFederation<void>({
      ...baseOptions,
      queue: { task: queue },
    });
    const task = federation.defineTask("envelope", {
      schema: stringSchema,
      handler: () => {},
    });
    const ctx = federation.createContext(
      new URL("https://example.com/"),
      undefined,
    );
    await ctx.enqueueTask(task, "payload");
    strictEqual(queue.enqueued.length, 1);
    const { message } = queue.enqueued[0];
    strictEqual(message.type, "task");
    strictEqual(message.taskName, "envelope");
    // encodeTaskMessage stamps the context's origin (no trailing slash).
    strictEqual(message.baseUrl, "https://example.com");
    strictEqual(message.attempt, 0);
    ok(UUID_RE.test(message.id));
    ok(typeof message.data === "string" && message.data.length > 0);
    // `started` is a serialized Temporal.Instant.
    ok(Temporal.Instant.from(message.started) instanceof Temporal.Instant);
    // propagation.inject always populates a (possibly empty) carrier object.
    ok(
      typeof message.traceContext === "object" && message.traceContext != null,
    );
  });

  await t.step("passes delay and orderingKey through", async () => {
    const queue = new MockQueue();
    const federation = createFederation<void>({
      ...baseOptions,
      queue: { task: queue },
    });
    const task = federation.defineTask("delayed", {
      schema: stringSchema,
      handler: () => {},
    });
    const ctx = federation.createContext(
      new URL("https://example.com/"),
      undefined,
    );
    await ctx.enqueueTask(task, "payload", {
      delay: { seconds: 30 },
      orderingKey: "user:alice",
    });
    strictEqual(queue.enqueued.length, 1);
    const { message, options } = queue.enqueued[0];
    strictEqual(message.taskName, "delayed");
    strictEqual(message.orderingKey, "user:alice");
    strictEqual(message.attempt, 0);
    ok(options?.delay instanceof Temporal.Duration);
    strictEqual(options.delay.total("second"), 30);
    strictEqual(options.orderingKey, "user:alice");
  });

  await t.step(
    "starts the task worker on first enqueue without startQueue()",
    async () => {
      const queue = new MockQueue();
      const federation = createFederation<void>({
        ...baseOptions,
        manuallyStartQueue: false,
        queue: { task: queue },
      });
      const task = federation.defineTask("auto-start", {
        schema: stringSchema,
        handler: () => {},
      });
      const ctx = federation.createContext(
        new URL("https://example.com/"),
        undefined,
      );
      // An app that only uses the custom task API never sends an activity,
      // so enqueueTask() itself must start the worker like the other
      // enqueue paths do; otherwise tasks pile up unprocessed forever.
      await ctx.enqueueTask(task, "first");
      strictEqual(queue.listenCount, 1);
      // The started flag keeps a second enqueue from re-listening.
      await ctx.enqueueTask(task, "second");
      strictEqual(queue.listenCount, 1);
      strictEqual(queue.enqueued.length, 2);
    },
  );

  await t.step("throws when the resolved task queue is null", async () => {
    // No queue is configured at all, so resolveTaskQueue() returns null and
    // the enqueue pipeline must fail fast before encoding any payload.
    const federation = createFederation<void>({ ...baseOptions });
    const task = federation.defineTask("queueless", {
      schema: stringSchema,
      handler: () => {},
    });
    const ctx = federation.createContext(
      new URL("https://example.com/"),
      undefined,
    );
    await rejects(
      () => ctx.enqueueTask(task, "data"),
      { name: "TypeError", message: /No message queue is configured/ },
    );
  });

  await t.step(
    "rejects a handle from another federation at enqueue",
    async () => {
      const queue = new MockQueue();
      const federation = createFederation<void>({
        ...baseOptions,
        queue: { task: queue },
      });
      const other = createFederation<void>({
        ...baseOptions,
        queue: { task: new MockQueue() },
      });
      const foreignTask = other.defineTask("foreign", {
        schema: stringSchema,
        handler: () => {},
      });
      const ctx = federation.createContext(
        new URL("https://example.com/"),
        undefined,
      );
      await rejects(
        () => ctx.enqueueTask(foreignTask, "data"),
        { name: "TypeError", message: /is not defined on this federation/ },
      );
      strictEqual(queue.enqueued.length, 0);
    },
  );

  await t.step(
    "rejects a same-named handle from another federation",
    async () => {
      // Name lookup alone cannot tell a foreign handle apart once both
      // instances define the same task name: the local context would
      // encode under the *schema carried by the foreign handle*, so a
      // payload the local schema rejects would enqueue anyway, only to be
      // dropped by the worker decoding under the local schema.  Both
      // instances share TContextData = void, so the phantom-brand check
      // cannot reject this at compile time; the handle-identity guard is
      // the only defense.
      const queue = new MockQueue();
      const federation = createFederation<void>({
        ...baseOptions,
        queue: { task: queue },
      });
      let called = 0;
      federation.defineTask("rename", {
        schema: numberSchema, // the local "rename" takes a number…
        handler: () => {
          called++;
        },
      });
      const other = createFederation<void>({
        ...baseOptions,
        queue: { task: new MockQueue() },
      });
      // …while the other instance's "rename" takes a string:
      const foreignTask = other.defineTask("rename", {
        schema: stringSchema,
        handler: () => {},
      });
      const ctx = federation.createContext(
        new URL("https://example.com/"),
        undefined,
      );
      await rejects(
        () => ctx.enqueueTask(foreignTask, "not a number"),
        { name: "TypeError", message: /is not defined on this federation/ },
      );
      strictEqual(queue.enqueued.length, 0);
      strictEqual(called, 0);
    },
  );

  await t.step(
    "enqueueTaskMany() uses enqueueMany when available",
    async () => {
      const queue = new MockQueue({ supportsEnqueueMany: true });
      const federation = createFederation<void>({
        ...baseOptions,
        queue: { task: queue },
      });
      const task = federation.defineTask("bulk", {
        schema: stringSchema,
        handler: () => {},
      });
      const ctx = federation.createContext(
        new URL("https://example.com/"),
        undefined,
      );
      await ctx.enqueueTaskMany(task, ["a", "b", "c"]);
      strictEqual(queue.enqueued.length, 0);
      strictEqual(queue.enqueuedMany.length, 1);
      strictEqual(queue.enqueuedMany[0].messages.length, 3);
    },
  );

  await t.step(
    "enqueueTaskMany() falls back to parallel enqueues",
    async () => {
      const queue = new MockQueue();
      const federation = createFederation<void>({
        ...baseOptions,
        queue: { task: queue },
      });
      const task = federation.defineTask("bulk-fallback", {
        schema: stringSchema,
        handler: () => {},
      });
      const ctx = federation.createContext(
        new URL("https://example.com/"),
        undefined,
      );
      await ctx.enqueueTaskMany(task, ["a", "b"]);
      strictEqual(queue.enqueued.length, 2);
    },
  );

  await t.step(
    "enqueueTaskMany() with no payloads touches no queue",
    async () => {
      const queue = new MockQueue({ supportsEnqueueMany: true });
      const federation = createFederation<void>({
        ...baseOptions,
        queue: { task: queue },
      });
      const task = federation.defineTask("bulk-empty", {
        schema: stringSchema,
        handler: () => {},
      });
      const ctx = federation.createContext(
        new URL("https://example.com/"),
        undefined,
      );
      await ctx.enqueueTaskMany(task, []);
      strictEqual(queue.enqueued.length, 0);
      strictEqual(queue.enqueuedMany.length, 0);
    },
  );
});

test("task deduplication", async (t) => {
  await t.step(
    "forwards the key to a nativeDeduplication queue without writing KV",
    async () => {
      const queue = new MockQueue({ nativeDeduplication: true });
      const kv = new MemoryKvStore();
      const federation = createFederation<void>({
        ...baseOptions,
        kv,
        queue: { task: queue },
      });
      const task = federation.defineTask("native-dedup", {
        schema: stringSchema,
        handler: () => {},
      });
      const ctx = federation.createContext(
        new URL("https://example.com/"),
        undefined,
      );
      await ctx.enqueueTask(task, "payload", { deduplicationKey: "k" });
      strictEqual(queue.enqueued.length, 1);
      strictEqual(queue.enqueued[0].options?.deduplicationKey, "k");
      // The backend owns the check, so Fedify must not write any KV marker.
      strictEqual((await collectKeys(kv, TASK_DEDUP_PREFIX)).length, 0);
    },
  );

  await t.step(
    "skips a second enqueue with the same key within the TTL",
    async () => {
      const queue = new MockQueue();
      const federation = createFederation<void>({
        ...baseOptions,
        kv: new MemoryKvStore(),
        queue: { task: queue },
      });
      const task = federation.defineTask("kv-dedup", {
        schema: stringSchema,
        handler: () => {},
      });
      const ctx = federation.createContext(
        new URL("https://example.com/"),
        undefined,
      );
      await ctx.enqueueTask(task, "first", { deduplicationKey: "k" });
      await ctx.enqueueTask(task, "second", { deduplicationKey: "k" });
      strictEqual(queue.enqueued.length, 1);
      strictEqual(queue.enqueued[0].message.taskName, "kv-dedup");
      // A non-native queue never receives a key it would ignore.
      strictEqual(queue.enqueued[0].options?.deduplicationKey, undefined);
    },
  );

  await t.step(
    "re-enqueues with the same key after the TTL expires",
    async () => {
      const queue = new MockQueue();
      const federation = createFederation<void>({
        ...baseOptions,
        kv: new MemoryKvStore(),
        queue: { task: queue },
        taskDeduplicationTtl: { milliseconds: 100 },
      });
      const task = federation.defineTask("kv-dedup-ttl", {
        schema: stringSchema,
        handler: () => {},
      });
      const ctx = federation.createContext(
        new URL("https://example.com/"),
        undefined,
      );
      await ctx.enqueueTask(task, "first", { deduplicationKey: "k" });
      strictEqual(queue.enqueued.length, 1);
      // Wait comfortably past the 100 ms TTL so the marker expires.
      await delay(300);
      await ctx.enqueueTask(task, "second", { deduplicationKey: "k" });
      strictEqual(queue.enqueued.length, 2);
    },
  );

  await t.step(
    'rejects with TypeError when fallback is "closed" and no cas exists',
    async () => {
      const queue = new MockQueue();
      const federation = createFederation<void>({
        ...baseOptions,
        kv: new CaslessKvStore(),
        queue: { task: queue },
        taskDeduplicationFallback: "closed",
      });
      const task = federation.defineTask("closed-fallback", {
        schema: stringSchema,
        handler: () => {},
      });
      const ctx = federation.createContext(
        new URL("https://example.com/"),
        undefined,
      );
      await rejects(
        () => ctx.enqueueTask(task, "payload", { deduplicationKey: "k" }),
        { name: "TypeError" },
      );
      strictEqual(queue.enqueued.length, 0);
    },
  );

  await t.step(
    'proceeds when fallback is "open" and no cas exists',
    async () => {
      const queue = new MockQueue();
      const federation = createFederation<void>({
        ...baseOptions,
        kv: new CaslessKvStore(),
        queue: { task: queue },
        taskDeduplicationFallback: "open",
      });
      const task = federation.defineTask("open-fallback", {
        schema: stringSchema,
        handler: () => {},
      });
      const ctx = federation.createContext(
        new URL("https://example.com/"),
        undefined,
      );
      await ctx.enqueueTask(task, "payload", { deduplicationKey: "k" });
      strictEqual(queue.enqueued.length, 1);
      // Best-effort fallback never forwards the key to a non-native queue.
      strictEqual(queue.enqueued[0].options?.deduplicationKey, undefined);
    },
  );

  await t.step(
    "writes only under taskDeduplication, never activityIdempotence",
    async () => {
      const queue = new MockQueue();
      const kv = new MemoryKvStore();
      const federation = createFederation<void>({
        ...baseOptions,
        kv,
        queue: { task: queue },
      });
      const task = federation.defineTask("prefix-isolation", {
        schema: stringSchema,
        handler: () => {},
      });
      const ctx = federation.createContext(
        new URL("https://example.com/"),
        undefined,
      );
      await ctx.enqueueTask(task, "payload", { deduplicationKey: "k" });
      strictEqual((await collectKeys(kv, TASK_DEDUP_PREFIX)).length, 1);
      strictEqual(
        (await collectKeys(kv, ACTIVITY_IDEMPOTENCE_PREFIX)).length,
        0,
      );
    },
  );

  await t.step("applies one batch-level key to enqueueTaskMany", async () => {
    const queue = new MockQueue({ supportsEnqueueMany: true });
    const federation = createFederation<void>({
      ...baseOptions,
      kv: new MemoryKvStore(),
      queue: { task: queue },
    });
    const task = federation.defineTask("batch-dedup", {
      schema: stringSchema,
      handler: () => {},
    });
    const ctx = federation.createContext(
      new URL("https://example.com/"),
      undefined,
    );
    await ctx.enqueueTaskMany(task, ["a", "b", "c"], {
      deduplicationKey: "batch",
    });
    await ctx.enqueueTaskMany(task, ["a", "b", "c"], {
      deduplicationKey: "batch",
    });
    // First batch enqueues all three; the second is skipped entirely.
    strictEqual(queue.enqueuedMany.length, 1);
    strictEqual(queue.enqueuedMany[0].messages.length, 3);
  });
});

test(
  "task deduplication validates every payload before reserving the key",
  async () => {
    const queue = new MockQueue();
    const kv = new MemoryKvStore();
    const federation = createFederation<void>({
      ...baseOptions,
      kv,
      queue: { task: queue },
    });
    const task = federation.defineTask("dedup-validation", {
      schema: stringSchema,
      handler: () => {},
    });
    const ctx = federation.createContext(
      new URL("https://example.com/"),
      undefined,
    );

    // A rejected payload must neither enqueue nor consume the key.
    await rejects(() =>
      ctx.enqueueTask(task, 123 as unknown as string, {
        deduplicationKey: "k",
      })
    );
    strictEqual(queue.enqueued.length, 0);
    deepStrictEqual(await collectKeys(kv, TASK_DEDUP_PREFIX), []);

    // The same key must remain usable by the first valid enqueue.
    await ctx.enqueueTask(task, "valid", { deduplicationKey: "k" });
    strictEqual(queue.enqueued.length, 1);
    deepStrictEqual(
      await collectKeys(kv, TASK_DEDUP_PREFIX),
      [[...TASK_DEDUP_PREFIX, "k"]],
    );

    // Once the valid enqueue reserves it, the same key must deduplicate.
    await ctx.enqueueTask(task, "duplicate", { deduplicationKey: "k" });
    strictEqual(queue.enqueued.length, 1);
  },
);

test(
  "native task batch deduplication is one enqueueMany operation per call",
  async () => {
    class NativeBatchDeduplicatingQueue implements MessageQueue {
      readonly nativeDeduplication = true;
      readonly #seen = new Set<string>();
      readonly attempts: {
        messages: readonly TaskMessage[];
        options?: MessageQueueEnqueueOptions;
      }[] = [];
      readonly accepted: {
        messages: readonly TaskMessage[];
        options?: MessageQueueEnqueueOptions;
      }[] = [];

      enqueue(): Promise<void> {
        throw new Error("A multi-item native batch must use enqueueMany().");
      }

      enqueueMany(
        messages: readonly TaskMessage[],
        options?: MessageQueueEnqueueOptions,
      ): Promise<void> {
        const key = options?.deduplicationKey;
        if (key == null) {
          throw new TypeError(
            "Native batch enqueue requires a deduplication key.",
          );
        }
        this.attempts.push({ messages, options });
        if (this.#seen.has(key)) return Promise.resolve();
        this.#seen.add(key);
        this.accepted.push({ messages, options });
        return Promise.resolve();
      }

      listen(): Promise<void> {
        return Promise.resolve();
      }
    }

    const queue = new NativeBatchDeduplicatingQueue();
    const kv = new MemoryKvStore();
    const federation = createFederation<void>({
      ...baseOptions,
      kv,
      queue: { task: queue },
    });
    const task = federation.defineTask("native-batch-dedup", {
      schema: stringSchema,
      handler: () => {},
    });
    const ctx = federation.createContext(
      new URL("https://example.com/"),
      undefined,
    );

    await ctx.enqueueTaskMany(task, ["a1", "a2", "a3"], {
      deduplicationKey: "batch-a",
    });
    await ctx.enqueueTaskMany(
      task,
      ["duplicate1", "duplicate2", "duplicate3"],
      {
        deduplicationKey: "batch-a",
      },
    );
    await ctx.enqueueTaskMany(task, ["b1", "b2", "b3"], {
      deduplicationKey: "batch-b",
    });

    // Every API call reaches the backend exactly once, with one key governing
    // all three messages.  The backend accepts complete batches or none.
    strictEqual(queue.attempts.length, 3);
    deepStrictEqual(
      queue.attempts.map(({ messages }) => messages.length),
      [3, 3, 3],
    );
    deepStrictEqual(
      queue.attempts.map(({ options }) => options?.deduplicationKey),
      ["batch-a", "batch-a", "batch-b"],
    );
    strictEqual(queue.accepted.length, 2);
    deepStrictEqual(
      queue.accepted.map(({ messages }) => messages.length),
      [3, 3],
    );
    deepStrictEqual(
      queue.accepted.map(({ options }) => options?.deduplicationKey),
      ["batch-a", "batch-b"],
    );
    deepStrictEqual(await collectKeys(kv, TASK_DEDUP_PREFIX), []);
  },
);

test(
  "native task batch deduplication rejects without enqueueMany",
  async () => {
    const queue = new MockQueue({ nativeDeduplication: true });
    const kv = new MemoryKvStore();
    const federation = createFederation<void>({
      ...baseOptions,
      kv,
      queue: { task: queue },
    });
    const task = federation.defineTask("native-batch-without-enqueue-many", {
      schema: stringSchema,
      handler: () => {},
    });
    const ctx = federation.createContext(
      new URL("https://example.com/"),
      undefined,
    );

    await rejects(
      () =>
        ctx.enqueueTaskMany(task, ["a", "b", "c"], {
          deduplicationKey: "batch",
        }),
      { name: "TypeError", message: /enqueueMany/ },
    );

    // Reject before any partial enqueue or fallback KV write.  Silently
    // dropping the key from items 2..n cannot satisfy these assertions.
    strictEqual(queue.enqueued.length, 0);
    strictEqual(queue.enqueuedMany.length, 0);
    deepStrictEqual(await collectKeys(kv, TASK_DEDUP_PREFIX), []);

    // A one-item batch is representable by enqueue() and must remain valid.
    await ctx.enqueueTaskMany(task, ["single"], {
      deduplicationKey: "single",
    });
    strictEqual(queue.enqueued.length, 1);
    strictEqual(queue.enqueued[0].options?.deduplicationKey, "single");
  },
);

test(
  "deduplication - native batch capability errors precede payload validation",
  async () => {
    let validationCalls = 0;
    const schema = makeSchema((data): data is string => {
      validationCalls++;
      return typeof data === "string";
    });
    const queue = new MockQueue({ nativeDeduplication: true });
    const kv = new MemoryKvStore();
    const federation = createFederation<void>({
      ...baseOptions,
      kv,
      queue: { task: queue },
    });
    const task = federation.defineTask("native-batch-capability-order", {
      schema,
      handler: () => {},
    });
    const ctx = federation.createContext(
      new URL("https://example.com/"),
      undefined,
    );

    let caught: unknown;
    try {
      await ctx.enqueueTaskMany(
        task,
        [1, 2, 3] as unknown as readonly string[],
        { deduplicationKey: "batch" },
      );
    } catch (error) {
      caught = error;
    }

    // The queue capability makes this request impossible regardless of the
    // payload, so no user-supplied validator may run first.
    strictEqual(validationCalls, 0);
    ok(caught instanceof TypeError);
    ok(caught.message.includes("enqueueMany"));
    strictEqual(queue.enqueued.length, 0);
    strictEqual(queue.enqueuedMany.length, 0);
    deepStrictEqual(await collectKeys(kv, TASK_DEDUP_PREFIX), []);
  },
);

test(
  "closed deduplication fallback errors precede payload validation",
  async () => {
    let validationCalls = 0;
    const schema = makeSchema((data): data is string => {
      validationCalls++;
      return typeof data === "string";
    });
    const queue = new MockQueue();
    const kv = new CaslessKvStore();
    const federation = createFederation<void>({
      ...baseOptions,
      kv,
      queue: { task: queue },
      taskDeduplicationFallback: "closed",
    });
    const task = federation.defineTask("closed-fallback-order", {
      schema,
      handler: () => {},
    });
    const ctx = federation.createContext(
      new URL("https://example.com/"),
      undefined,
    );

    let caught: unknown;
    try {
      await ctx.enqueueTask(
        task,
        1 as unknown as string,
        { deduplicationKey: "k" },
      );
    } catch (error) {
      caught = error;
    }

    // Closed fallback is a configuration-level rejection.  It must be
    // deterministic and independent of user payload validation.
    strictEqual(validationCalls, 0);
    ok(caught instanceof TypeError);
    ok(caught.message.includes("conditional write"));
    strictEqual(queue.enqueued.length, 0);
    strictEqual(queue.enqueuedMany.length, 0);
    deepStrictEqual(await collectKeys(kv, TASK_DEDUP_PREFIX), []);
  },
);
