import { test } from "@fedify/fixture";
import { configure, type LogRecord, reset } from "@logtape/logtape";
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
import {
  type MessageQueue,
  type MessageQueueEnqueueOptions,
  ParallelMessageQueue,
} from "../mq.ts";
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

/**
 * A {@link MessageQueue} that fails its first enqueue—single or batch—with a
 * transient error, then records every later enqueue.  One class covers both the
 * `enqueue()` and `enqueueMany()` rollback paths; each test instantiates its own
 * copy, so the one-shot `#failNext` flag never leaks between them.
 */
class FlakyQueue implements MessageQueue {
  readonly nativeDeduplication = false;
  #failNext = true;
  readonly enqueued: TaskMessage[] = [];
  readonly enqueuedMany: TaskMessage[][] = [];

  #failOnce(): boolean {
    if (!this.#failNext) return false;
    this.#failNext = false;
    return true;
  }

  enqueue(message: TaskMessage): Promise<void> {
    if (this.#failOnce()) {
      return Promise.reject(new Error("transient backend failure"));
    }
    this.enqueued.push(message);
    return Promise.resolve();
  }

  enqueueMany(messages: readonly TaskMessage[]): Promise<void> {
    if (this.#failOnce()) {
      return Promise.reject(new Error("transient backend failure"));
    }
    this.enqueuedMany.push([...messages]);
    return Promise.resolve();
  }

  listen(): Promise<void> {
    return Promise.resolve();
  }
}

test(
  "a failed enqueue rolls back its dedup marker so the retry is not dropped",
  async () => {
    const queue = new FlakyQueue();
    const kv = new MemoryKvStore();
    const federation = createFederation<void>({
      ...baseOptions,
      kv,
      queue: { task: queue },
    });
    const task = federation.defineTask("flaky-enqueue", {
      schema: stringSchema,
      handler: () => {},
    });
    const ctx = federation.createContext(
      new URL("https://example.com/"),
      undefined,
    );
    const markerKey: KvKey = [...TASK_DEDUP_PREFIX, "k"];

    // First enqueue: the marker is claimed, then dispatch rejects.
    await rejects(
      () => ctx.enqueueTask(task, "first", { deduplicationKey: "k" }),
      { message: /transient backend failure/ },
    );
    strictEqual(queue.enqueued.length, 0);
    strictEqual(await kv.get(markerKey), undefined);

    // The retry (queue healthy again) must enqueue the task, not be dropped.
    await ctx.enqueueTask(task, "first-retry", { deduplicationKey: "k" });
    strictEqual(queue.enqueued.length, 1);

    // A successful retry must keep its marker so later duplicates are dropped.
    ok(await kv.get(markerKey) != null);
    await ctx.enqueueTask(task, "duplicate", { deduplicationKey: "k" });
    strictEqual(queue.enqueued.length, 1);
  },
);

test(
  "a failed batch enqueue rolls back its dedup marker so the retry is not " +
    "dropped",
  async () => {
    const queue = new FlakyQueue();
    const kv = new MemoryKvStore();
    const federation = createFederation<void>({
      ...baseOptions,
      kv,
      queue: { task: queue },
    });
    const task = federation.defineTask("flaky-batch-enqueue", {
      schema: stringSchema,
      handler: () => {},
    });
    const ctx = federation.createContext(
      new URL("https://example.com/"),
      undefined,
    );
    const markerKey: KvKey = [...TASK_DEDUP_PREFIX, "batch"];

    await rejects(
      () =>
        ctx.enqueueTaskMany(task, ["first", "second"], {
          deduplicationKey: "batch",
        }),
      { message: /transient backend failure/ },
    );
    strictEqual(queue.enqueuedMany.length, 0);
    // Asserted via get() for the same reason as the single-item rollback test
    // above (MemoryKvStore.cas leaves a `value: undefined` entry).
    strictEqual(await kv.get(markerKey), undefined);

    await ctx.enqueueTaskMany(task, ["first-retry", "second-retry"], {
      deduplicationKey: "batch",
    });
    strictEqual(queue.enqueuedMany.length, 1);
    strictEqual(queue.enqueuedMany[0].length, 2);
    ok(await kv.get(markerKey) != null);

    await ctx.enqueueTaskMany(task, ["duplicate-first", "duplicate-second"], {
      deduplicationKey: "batch",
    });
    strictEqual(queue.enqueuedMany.length, 1);
  },
);

test(
  "a stale rollback does not clear a marker another enqueue re-claimed",
  async () => {
    const kv = new MemoryKvStore();
    const markerKey: KvKey = [...TASK_DEDUP_PREFIX, "k"];
    let signalFirstEntered!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      signalFirstEntered = resolve;
    });
    let releaseFirst!: () => void;
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    class BlockingThenFailingQueue implements MessageQueue {
      readonly nativeDeduplication = false;
      #calls = 0;
      async enqueue(): Promise<void> {
        this.#calls++;
        if (this.#calls === 1) {
          signalFirstEntered();
          await firstReleased;
          throw new Error("transient backend failure");
        }
      }
      listen(): Promise<void> {
        return Promise.resolve();
      }
    }
    const queue = new BlockingThenFailingQueue();
    const federation = createFederation<void>({
      ...baseOptions,
      kv,
      queue: { task: queue },
      taskDeduplicationTtl: { milliseconds: 1 },
    });
    const task = federation.defineTask("stale-rollback", {
      schema: stringSchema,
      handler: () => {},
    });
    const ctx = federation.createContext(
      new URL("https://example.com/"),
      undefined,
    );

    const first = ctx.enqueueTask(task, "first", { deduplicationKey: "k" });
    await firstEntered;
    await delay(20);
    await ctx.enqueueTask(task, "second", { deduplicationKey: "k" });
    const secondToken = await kv.get(markerKey);
    ok(secondToken != null);
    releaseFirst();
    await rejects(() => first, { message: /transient backend failure/ });
    strictEqual(await kv.get(markerKey), secondToken);
  },
);

test(
  "a multi-item batch dedup without enqueueMany is rejected on the cas path",
  async () => {
    const queue = new MockQueue();
    const kv = new MemoryKvStore();
    const federation = createFederation<void>({
      ...baseOptions,
      kv,
      queue: { task: queue },
    });
    const task = federation.defineTask("cas-batch-without-enqueue-many", {
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
    strictEqual(queue.enqueued.length, 0);
    strictEqual(queue.enqueuedMany.length, 0);
    deepStrictEqual(await collectKeys(kv, TASK_DEDUP_PREFIX), []);

    await ctx.enqueueTaskMany(task, ["single"], { deduplicationKey: "single" });
    strictEqual(queue.enqueued.length, 1);
  },
);

test(
  "a failed rollback is swallowed; the original enqueue error reaches the caller",
  async () => {
    class ClearFailingKvStore implements KvStore {
      readonly inner = new MemoryKvStore();
      clearAttempts = 0;
      get<T = unknown>(key: KvKey): Promise<T | undefined> {
        return this.inner.get<T>(key);
      }
      set(
        key: KvKey,
        value: unknown,
        options?: KvStoreSetOptions,
      ): Promise<void> {
        return this.inner.set(key, value, options);
      }
      delete(key: KvKey): Promise<void> {
        return this.inner.delete(key);
      }
      list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
        return this.inner.list(prefix);
      }
      cas(
        key: KvKey,
        expectedValue: unknown,
        newValue: unknown,
        options?: KvStoreSetOptions,
      ): Promise<boolean> {
        if (newValue === undefined) {
          this.clearAttempts++;
          return Promise.reject(new Error("kv cas clear failed"));
        }
        return this.inner.cas(key, expectedValue, newValue, options);
      }
    }

    const queue = new FlakyQueue();
    const kv = new ClearFailingKvStore();
    const federation = createFederation<void>({
      ...baseOptions,
      kv,
      queue: { task: queue },
    });
    const task = federation.defineTask("rollback-failure", {
      schema: stringSchema,
      handler: () => {},
    });
    const ctx = federation.createContext(
      new URL("https://example.com/"),
      undefined,
    );

    await rejects(
      () => ctx.enqueueTask(task, "first", { deduplicationKey: "k" }),
      { message: /transient backend failure/ },
    );
    strictEqual(queue.enqueued.length, 0);
    strictEqual(kv.clearAttempts, 1);
  },
);

/**
 * A native-deduplication backend that drops repeat-key single enqueues and
 * does **not** implement `enqueueMany`.  Wrapping it in
 * {@link ParallelMessageQueue} used to fan a batch out to one `enqueue()` per
 * message, all carrying the same `deduplicationKey`, so the backend collapsed
 * the whole batch onto its first message.
 */
class NativeDedupNoBulkQueue implements MessageQueue {
  readonly nativeDeduplication = true;
  readonly #seen = new Set<string>();
  readonly enqueued: {
    message: TaskMessage;
    options?: MessageQueueEnqueueOptions;
  }[] = [];

  enqueue(
    message: TaskMessage,
    options?: MessageQueueEnqueueOptions,
  ): Promise<void> {
    const key = options?.deduplicationKey;
    if (key != null) {
      if (this.#seen.has(key)) return Promise.resolve();
      this.#seen.add(key);
    }
    this.enqueued.push({ message, options });
    return Promise.resolve();
  }

  listen(): Promise<void> {
    return Promise.resolve();
  }
}

test(
  "a deduplicated batch over a ParallelMessageQueue wrapping a native, " +
    "no-enqueueMany backend is rejected, not collapsed",
  async () => {
    const backend = new NativeDedupNoBulkQueue();
    const queue = new ParallelMessageQueue(backend, 5);
    const kv = new MemoryKvStore();
    const federation = createFederation<void>({
      ...baseOptions,
      kv,
      queue: { task: queue },
    });
    const task = federation.defineTask("parallel-native-no-bulk", {
      schema: stringSchema,
      handler: () => {},
    });
    const ctx = federation.createContext(
      new URL("https://example.com/"),
      undefined,
    );

    // The wrapper cannot enqueue the batch atomically under one key, so the
    // multi-item batch must be rejected rather than silently collapsed to one.
    await rejects(
      () =>
        ctx.enqueueTaskMany(task, ["a", "b", "c"], {
          deduplicationKey: "batch",
        }),
      { name: "TypeError", message: /enqueueMany/ },
    );
    strictEqual(backend.enqueued.length, 0);
    // A native plan never touches KV, even when it rejects.
    deepStrictEqual(await collectKeys(kv, TASK_DEDUP_PREFIX), []);

    // A single-item batch needs no bulk path, so the key is still forwarded.
    await ctx.enqueueTaskMany(task, ["solo"], { deduplicationKey: "solo" });
    strictEqual(backend.enqueued.length, 1);
    strictEqual(backend.enqueued[0].options?.deduplicationKey, "solo");
  },
);

test(
  "a deduplicated batch over a ParallelMessageQueue wrapping a native " +
    "enqueueMany backend forwards the key atomically",
  async () => {
    class NativeBatchQueue implements MessageQueue {
      readonly nativeDeduplication = true;
      readonly #seen = new Set<string>();
      readonly batches: {
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
        if (key != null && this.#seen.has(key)) return Promise.resolve();
        if (key != null) this.#seen.add(key);
        this.batches.push({ messages, options });
        return Promise.resolve();
      }

      listen(): Promise<void> {
        return Promise.resolve();
      }
    }

    const backend = new NativeBatchQueue();
    const queue = new ParallelMessageQueue(backend, 5);
    const kv = new MemoryKvStore();
    const federation = createFederation<void>({
      ...baseOptions,
      kv,
      queue: { task: queue },
    });
    const task = federation.defineTask("parallel-native-bulk", {
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
    // The duplicate batch is dropped by the backend's native check.
    await ctx.enqueueTaskMany(task, ["x", "y", "z"], {
      deduplicationKey: "batch",
    });

    strictEqual(backend.batches.length, 1);
    strictEqual(backend.batches[0].messages.length, 3);
    strictEqual(backend.batches[0].options?.deduplicationKey, "batch");
    // The native path never writes KV, even through the wrapper.
    deepStrictEqual(await collectKeys(kv, TASK_DEDUP_PREFIX), []);
  },
);

test(
  'an "open" fallback fans out a multi-item batch without enqueueMany ' +
    "instead of rejecting it",
  async () => {
    const queue = new MockQueue(); // no enqueueMany, not native
    const kv = new CaslessKvStore(); // no cas
    const federation = createFederation<void>({
      ...baseOptions,
      kv,
      queue: { task: queue },
      taskDeduplicationFallback: "open",
    });
    const task = federation.defineTask("open-batch-fanout", {
      schema: stringSchema,
      handler: () => {},
    });
    const ctx = federation.createContext(
      new URL("https://example.com/"),
      undefined,
    );

    // With neither native dedup nor cas under "open", the batch proceeds by
    // fanning out every item; it must not throw the enqueueMany requirement.
    await ctx.enqueueTaskMany(task, ["a", "b", "c"], {
      deduplicationKey: "batch",
    });
    strictEqual(queue.enqueued.length, 3);
    for (const { options } of queue.enqueued) {
      strictEqual(options?.deduplicationKey, undefined);
    }
    // The open path records nothing in the key–value store.
    deepStrictEqual(await collectKeys(kv.inner, TASK_DEDUP_PREFIX), []);
  },
);

test(
  'an "open" fallback logs a debug record when it ignores the key',
  async () => {
    const records: LogRecord[] = [];
    await reset();
    try {
      await configure({
        sinks: {
          buffer(record: LogRecord): void {
            records.push(record);
          },
        },
        filters: {},
        loggers: [
          { category: [], lowestLevel: "debug", sinks: ["buffer"] },
        ],
      });

      const queue = new MockQueue();
      const federation = createFederation<void>({
        ...baseOptions,
        kv: new CaslessKvStore(),
        queue: { task: queue },
        taskDeduplicationFallback: "open",
      });
      const task = federation.defineTask("open-debug-log", {
        schema: stringSchema,
        handler: () => {},
      });
      const ctx = federation.createContext(
        new URL("https://example.com/"),
        undefined,
      );
      await ctx.enqueueTask(task, "payload", { deduplicationKey: "k" });

      const matched = records.filter((record) =>
        record.level === "debug" &&
        record.properties.deduplicationKey === "k" &&
        record.properties.taskName === "open-debug-log"
      );
      strictEqual(matched.length, 1);
    } finally {
      await reset();
    }
  },
);

test(
  "two concurrent enqueues sharing a key: exactly one wins the cas claim",
  async () => {
    let signalEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    class BlockingQueue implements MessageQueue {
      readonly nativeDeduplication = false;
      readonly enqueued: TaskMessage[] = [];
      #first = true;
      async enqueue(message: TaskMessage): Promise<void> {
        if (this.#first) {
          this.#first = false;
          signalEntered();
          await released;
        }
        this.enqueued.push(message);
      }
      listen(): Promise<void> {
        return Promise.resolve();
      }
    }
    const queue = new BlockingQueue();
    const kv = new MemoryKvStore();
    const federation = createFederation<void>({
      ...baseOptions,
      kv,
      queue: { task: queue },
    });
    const task = federation.defineTask("concurrent-claim", {
      schema: stringSchema,
      handler: () => {},
    });
    const ctx = federation.createContext(
      new URL("https://example.com/"),
      undefined,
    );

    // The first enqueue claims the marker, then blocks inside the queue.
    const first = ctx.enqueueTask(task, "first", { deduplicationKey: "k" });
    await entered;
    // With the first still in flight, the second must lose the cas claim and
    // skip the queue entirely.
    await ctx.enqueueTask(task, "second", { deduplicationKey: "k" });
    release();
    await first;
    strictEqual(queue.enqueued.length, 1);

    // The winner kept its marker, so a later duplicate is still dropped.
    await ctx.enqueueTask(task, "third", { deduplicationKey: "k" });
    strictEqual(queue.enqueued.length, 1);
  },
);

test(
  "a native enqueue forwards orderingKey and deduplicationKey together",
  async () => {
    const queue = new MockQueue({ nativeDeduplication: true });
    const federation = createFederation<void>({
      ...baseOptions,
      kv: new MemoryKvStore(),
      queue: { task: queue },
    });
    const task = federation.defineTask("native-both-keys", {
      schema: stringSchema,
      handler: () => {},
    });
    const ctx = federation.createContext(
      new URL("https://example.com/"),
      undefined,
    );
    await ctx.enqueueTask(task, "payload", {
      orderingKey: "user:alice",
      deduplicationKey: "dedup:alice",
    });
    strictEqual(queue.enqueued.length, 1);
    const { message, options } = queue.enqueued[0];
    strictEqual(message.orderingKey, "user:alice");
    strictEqual(options?.orderingKey, "user:alice");
    strictEqual(options?.deduplicationKey, "dedup:alice");
  },
);
