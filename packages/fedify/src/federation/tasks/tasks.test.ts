import {
  createTestMeterProvider,
  createTestTracerProvider,
  mockDocumentLoader,
  test,
} from "@fedify/fixture";
import { Note } from "@fedify/vocab";
import { propagation, SpanStatusCode } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { delay } from "es-toolkit";
import {
  deepStrictEqual,
  ok,
  rejects,
  strictEqual,
  throws,
} from "node:assert/strict";
import {
  baseOptions,
  makeSchema,
  MockQueue,
  numberSchema,
  stringSchema,
} from "../../testing/mod.ts";
import { createFederationBuilder } from "../builder.ts";
import type { Context } from "../context.ts";
import type { Federatable, FederationOptions } from "../federation.ts";
import {
  type KvKey,
  type KvStore,
  type KvStoreListEntry,
  type KvStoreSetOptions,
  MemoryKvStore,
} from "../kv.ts";
import { createFederation, type FederationImpl } from "../middleware.ts";
import {
  InProcessMessageQueue,
  type MessageQueue,
  type MessageQueueEnqueueOptions,
} from "../mq.ts";
import type { TaskMessage } from "../queue.ts";
import TaskCodec from "./codec.ts";
import type { TaskDefinition, TaskRegistry } from "./task.ts";

type Assert<T extends true> = T;

interface Envelope {
  note: Note;
  title: string;
}

const envelopeSchema = makeSchema(
  (data): data is Envelope =>
    typeof data === "object" && data != null &&
    (data as Envelope).note instanceof Note &&
    typeof (data as Envelope).title === "string",
);

const makeTaskMessage = async (
  taskName: string,
  data: unknown,
  overrides: Partial<TaskMessage> = {},
): Promise<TaskMessage> => ({
  type: "task",
  id: crypto.randomUUID(),
  baseUrl: "https://example.com/",
  taskName,
  data: await new TaskCodec({ contextLoader: mockDocumentLoader })
    .serialize(data),
  started: Temporal.Now.instant().toString(),
  attempt: 0,
  traceContext: {},
  ...overrides,
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    await delay(50);
    if (Date.now() - started > timeoutMs) throw new Error("Timeout");
  }
}

test("defineTask()", async (t) => {
  await t.step("returns a handle carrying name and schema", () => {
    const federation = createFederation<void>({
      ...baseOptions,
      queue: { task: new MockQueue() },
    });
    const task = federation.defineTask("greet", {
      schema: stringSchema,
      handler: () => {},
    });
    strictEqual(task.name, "greet");
    strictEqual(task.schema, stringSchema);
  });

  await t.step("throws on a duplicate name", () => {
    const federation = createFederation<void>({
      ...baseOptions,
      queue: { task: new MockQueue() },
    });
    federation.defineTask("dup", {
      schema: stringSchema,
      handler: () => {},
    });
    throws(
      () =>
        federation.defineTask("dup", {
          schema: stringSchema,
          handler: () => {},
        }),
      { name: "TypeError", message: /already defined/ },
    );
  });

  await t.step("accepts names that collide with Object.prototype", () => {
    const federation = createFederation<void>({
      ...baseOptions,
      queue: { task: new MockQueue() },
    }) as FederationImpl<void>;
    // These names exist on Object.prototype; a plain-object registry would
    // mistake them for already-defined tasks (`name in {}`) and would return
    // an inherited method on lookup.
    for (const name of ["constructor", "toString", "hasOwnProperty"]) {
      const task = federation.defineTask(name, {
        schema: stringSchema,
        handler: () => {},
      });
      strictEqual(task.name, name);
      strictEqual(federation.taskDefinitions.get(name)?.name, name);
    }
    // A genuine duplicate still throws.
    throws(
      () =>
        federation.defineTask("toString", {
          schema: stringSchema,
          handler: () => {},
        }),
      { name: "TypeError", message: /already defined/ },
    );
  });

  await t.step("build() clones the task registry", async () => {
    const builder = createFederationBuilder<void>();
    builder.defineTask("first", {
      schema: stringSchema,
      handler: () => {},
    });
    const f1 = await builder.build({
      ...baseOptions,
      queue: { task: new MockQueue() },
    }) as FederationImpl<void>;
    builder.defineTask("second", {
      schema: stringSchema,
      handler: () => {},
    });
    const f2 = await builder.build({
      ...baseOptions,
      queue: { task: new MockQueue() },
    }) as FederationImpl<void>;
    deepStrictEqual([...f1.taskDefinitions.keys()], ["first"]);
    deepStrictEqual([...f2.taskDefinitions.keys()], ["first", "second"]);
    // Defining on a built federation does not leak back into the builder:
    f1.defineTask("third", { schema: stringSchema, handler: () => {} });
    deepStrictEqual([...f2.taskDefinitions.keys()], ["first", "second"]);
  });
});

test("task type-level guards", () => {
  // Forward-compat seam: Federatable must remain assignable to TaskRegistry,
  // so a future Worker<TContextData> can implement TaskRegistry directly.
  type _ForwardCompat = Assert<
    Federatable<void> extends TaskRegistry<void> ? true : false
  >;
  const _wrongPayloadIsACompileError = (
    ctx: Context<void>,
    task: TaskDefinition<void, { n: number }>,
  ) => {
    // @ts-expect-error: a wrong-shaped payload must not type-check.
    return ctx.enqueueTask(task, { n: "not a number" });
  };
  const _crossContextHandleIsACompileError = (
    ctx: Context<void>,
    task: TaskDefinition<{ tenant: string }, { n: number }>,
  ) => {
    // @ts-expect-error: a handle bound to different context data must not
    // type-check.
    return ctx.enqueueTask(task, { n: 1 });
  };
});

test("Context.enqueueTask() end-to-end", async (t) => {
  await t.step("round-trips a typed payload to the handler", async () => {
    const queue = new InProcessMessageQueue();
    const federation = createFederation<void>({
      ...baseOptions,
      queue: { task: queue },
    });
    const received: { ctx: Context<void>; data: Envelope }[] = [];
    const task = federation.defineTask("notify", {
      schema: envelopeSchema,
      handler: (ctx, data) => {
        received.push({ ctx, data });
      },
    });
    const ctx = federation.createContext(
      new URL("https://example.com/"),
      undefined,
    );
    await ctx.enqueueTask(task, {
      note: new Note({ content: "Hello, world!" }),
      title: "greeting",
    });
    const controller = new AbortController();
    const listening = federation.startQueue(undefined, {
      signal: controller.signal,
      queue: "task",
    });
    try {
      await waitFor(() => received.length > 0, 15_000);
    } finally {
      controller.abort();
      await listening;
    }
    strictEqual(received.length, 1);
    const { ctx: handlerCtx, data } = received[0];
    ok(data.note instanceof Note);
    strictEqual(data.note.content?.toString(), "Hello, world!");
    strictEqual(data.title, "greeting");
    strictEqual(handlerCtx.origin, "https://example.com");
  });
});

test("task queue routing", async (t) => {
  await t.step("prefers the per-task queue", async () => {
    const taskQueue = new MockQueue();
    const perTaskQueue = new MockQueue();
    const federation = createFederation<void>({
      ...baseOptions,
      queue: { task: taskQueue },
    });
    const task = federation.defineTask("isolated", {
      schema: stringSchema,
      handler: () => {},
      queue: perTaskQueue,
    });
    const ctx = federation.createContext(
      new URL("https://example.com/"),
      undefined,
    );
    await ctx.enqueueTask(task, "data");
    strictEqual(perTaskQueue.enqueued.length, 1);
    strictEqual(taskQueue.enqueued.length, 0);
  });

  await t.step("falls back to the outbox queue by default", async () => {
    const outboxQueue = new MockQueue();
    const federation = createFederation<void>({
      ...baseOptions,
      queue: { outbox: outboxQueue },
    });
    const task = federation.defineTask("fallback", {
      schema: stringSchema,
      handler: () => {},
    });
    const ctx = federation.createContext(
      new URL("https://example.com/"),
      undefined,
    );
    await ctx.enqueueTask(task, "data");
    strictEqual(outboxQueue.enqueued.length, 1);
  });

  await t.step(
    'taskQueueResolution: "strict" throws at enqueue instead',
    async () => {
      const outboxQueue = new MockQueue();
      const federation = createFederation<void>({
        ...baseOptions,
        queue: { outbox: outboxQueue },
        taskQueueResolution: "strict",
      });
      const task = federation.defineTask("strict", {
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
      strictEqual(outboxQueue.enqueued.length, 0);
    },
  );

  await t.step("throws when no queue is configured at all", async () => {
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
});

test("startQueue() task worker", async (t) => {
  await t.step('starts only the task worker for queue: "task"', async () => {
    const inbox = new MockQueue();
    const outbox = new MockQueue();
    const fanout = new MockQueue();
    const taskQueue = new MockQueue();
    const federation = createFederation<void>({
      ...baseOptions,
      queue: { inbox, outbox, fanout, task: taskQueue },
    });
    const controller = new AbortController();
    const listening = federation.startQueue(undefined, {
      signal: controller.signal,
      queue: "task",
    });
    strictEqual(taskQueue.listenCount, 1);
    strictEqual(inbox.listenCount, 0);
    strictEqual(outbox.listenCount, 0);
    strictEqual(fanout.listenCount, 0);
    controller.abort();
    await listening;
  });

  await t.step("starts the worker for a task-only deployment", async () => {
    const taskQueue = new MockQueue();
    const federation = createFederation<void>({
      ...baseOptions,
      queue: { task: taskQueue },
    });
    const controller = new AbortController();
    const listening = federation.startQueue(undefined, {
      signal: controller.signal,
    });
    strictEqual(taskQueue.listenCount, 1);
    controller.abort();
    await listening;
  });

  await t.step("does not double-listen on a shared queue", async () => {
    const shared = new MockQueue();
    const federation = createFederation<void>({
      ...baseOptions,
      queue: { outbox: shared, task: shared },
    });
    const controller = new AbortController();
    const listening = federation.startQueue(undefined, {
      signal: controller.signal,
    });
    strictEqual(shared.listenCount, 1);
    controller.abort();
    await listening;
  });

  await t.step("starts a worker for a dedicated per-task queue", async () => {
    const taskQueue = new MockQueue();
    const dedicated = new MockQueue();
    const federation = createFederation<void>({
      ...baseOptions,
      queue: { task: taskQueue },
    });
    federation.defineTask("dedicated", {
      schema: stringSchema,
      handler: () => {},
      queue: dedicated,
    });
    const controller = new AbortController();
    const listening = federation.startQueue(undefined, {
      signal: controller.signal,
    });
    strictEqual(taskQueue.listenCount, 1);
    strictEqual(dedicated.listenCount, 1);
    controller.abort();
    await listening;
  });

  await t.step(
    "starts a per-task queue even without a federation queue",
    async () => {
      const dedicated = new MockQueue();
      const federation = createFederation<void>({ ...baseOptions });
      federation.defineTask("dedicated", {
        schema: stringSchema,
        handler: () => {},
        queue: dedicated,
      });
      const controller = new AbortController();
      const listening = federation.startQueue(undefined, {
        signal: controller.signal,
      });
      strictEqual(dedicated.listenCount, 1);
      controller.abort();
      await listening;
    },
  );

  await t.step(
    "does not listen twice on a per-task queue shared with a standard queue",
    async () => {
      const shared = new MockQueue();
      const federation = createFederation<void>({
        ...baseOptions,
        queue: { task: shared },
      });
      federation.defineTask("reuses-task-queue", {
        schema: stringSchema,
        handler: () => {},
        queue: shared,
      });
      const controller = new AbortController();
      const listening = federation.startQueue(undefined, {
        signal: controller.signal,
      });
      strictEqual(shared.listenCount, 1);
      controller.abort();
      await listening;
    },
  );

  await t.step(
    "routes an enqueued task on a dedicated queue to its handler",
    async () => {
      const dedicated = new MockQueue();
      const federation = createFederation<void>({ ...baseOptions });
      let received: string | undefined;
      const task = federation.defineTask("dedicated-end-to-end", {
        schema: stringSchema,
        handler: (_ctx, data) => {
          received = data;
        },
        queue: dedicated,
      });
      const ctx = federation.createContext(
        new URL("https://example.com/"),
        undefined,
      );
      await ctx.enqueueTask(task, "payload");
      strictEqual(dedicated.enqueued.length, 1);
      await (federation as FederationImpl<void>).processQueuedTask(
        undefined,
        dedicated.enqueued[0].message,
      );
      strictEqual(received, "payload");
    },
  );

  await t.step(
    'queue: "task" starts the outbox fallback when no task queue is set',
    async () => {
      const inbox = new MockQueue();
      const outbox = new MockQueue();
      const fanout = new MockQueue();
      const federation = createFederation<void>({
        ...baseOptions,
        queue: { inbox, outbox, fanout },
      });
      federation.defineTask("fallback", {
        schema: stringSchema,
        handler: () => {},
      });
      const controller = new AbortController();
      const listening = federation.startQueue(undefined, {
        signal: controller.signal,
        queue: "task",
      });
      // Tasks route to the outbox fallback, so the "task" selector must start
      // the outbox worker—otherwise enqueued tasks have no listener.
      strictEqual(outbox.listenCount, 1);
      strictEqual(inbox.listenCount, 0);
      strictEqual(fanout.listenCount, 0);
      controller.abort();
      await listening;
    },
  );

  await t.step(
    'queue: "task" starts a task queue shared with the outbox once',
    async () => {
      const inbox = new MockQueue();
      const shared = new MockQueue();
      const fanout = new MockQueue();
      const federation = createFederation<void>({
        ...baseOptions,
        queue: { inbox, outbox: shared, fanout, task: shared },
      });
      const controller = new AbortController();
      const listening = federation.startQueue(undefined, {
        signal: controller.signal,
        queue: "task",
      });
      strictEqual(shared.listenCount, 1);
      strictEqual(inbox.listenCount, 0);
      strictEqual(fanout.listenCount, 0);
      controller.abort();
      await listening;
    },
  );
});

test("MockQueue.listen() resolves on a pre-aborted signal", async () => {
  const queue = new MockQueue();
  const controller = new AbortController();
  controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race([
    queue.listen(() => {}, { signal: controller.signal }).then(() =>
      "resolved"
    ),
    new Promise<string>((resolve) => {
      timer = setTimeout(() => resolve("pending"), 50);
    }),
  ]);
  clearTimeout(timer);
  strictEqual(settled, "resolved");
});

test("processQueuedTask() task dispatch", async (t) => {
  await t.step("drops an unknown task with a warning", async () => {
    const queue = new MockQueue();
    const federation = createFederation<void>({
      ...baseOptions,
      queue: { task: queue },
    }) as FederationImpl<void>;
    const message = await makeTaskMessage("never-defined", "data");
    await federation.processQueuedTask(undefined, message);
    strictEqual(queue.enqueued.length, 0);
  });

  await t.step("drops an undecodable payload without retry", async () => {
    const queue = new MockQueue();
    const federation = createFederation<void>({
      ...baseOptions,
      queue: { task: queue },
    }) as FederationImpl<void>;
    let called = 0;
    federation.defineTask("broken-wire", {
      schema: stringSchema,
      handler: () => {
        called++;
      },
    });
    const message = await makeTaskMessage("broken-wire", "data");
    await federation.processQueuedTask(undefined, {
      ...message,
      data: "garbage that is not devalue",
    });
    strictEqual(called, 0);
    strictEqual(queue.enqueued.length, 0);
  });

  await t.step("drops a drifted payload without retry", async () => {
    const queue = new MockQueue();
    const federation = createFederation<void>({
      ...baseOptions,
      queue: { task: queue },
    }) as FederationImpl<void>;
    let called = 0;
    federation.defineTask("drifted", {
      schema: numberSchema, // the "new deploy" expects a number…
      handler: () => {
        called++;
      },
    });
    // …but the payload was enqueued by an "old deploy" as a string:
    const message = await makeTaskMessage("drifted", "stringly-typed");
    await federation.processQueuedTask(undefined, message);
    strictEqual(called, 0);
    strictEqual(queue.enqueued.length, 0);
  });

  await t.step(
    "re-enqueues with attempt + 1 when the handler throws",
    async () => {
      const queue = new MockQueue();
      const federation = createFederation<void>({
        ...baseOptions,
        queue: { task: queue },
      }) as FederationImpl<void>;
      const errors: unknown[] = [];
      federation.defineTask("flaky", {
        schema: stringSchema,
        handler: () => {
          throw new Error("boom");
        },
        retryPolicy: () => Temporal.Duration.from({ milliseconds: 1 }),
        onError: (_ctx, error, data) => {
          errors.push([error, data]);
        },
      });
      const message = await makeTaskMessage("flaky", "data", {
        orderingKey: "k",
      });
      await federation.processQueuedTask(undefined, message);
      strictEqual(queue.enqueued.length, 1);
      const retry = queue.enqueued[0];
      strictEqual(retry.message.attempt, 1);
      strictEqual(retry.message.taskName, "flaky");
      strictEqual(retry.message.orderingKey, "k");
      strictEqual(retry.options?.orderingKey, "k");
      ok(retry.options?.delay instanceof Temporal.Duration);
      strictEqual(errors.length, 1);
      deepStrictEqual(errors[0], [new Error("boom"), "data"]);
    },
  );

  await t.step("gives up when the retry policy returns null", async () => {
    const queue = new MockQueue();
    const federation = createFederation<void>({
      ...baseOptions,
      queue: { task: queue },
    }) as FederationImpl<void>;
    federation.defineTask("hopeless", {
      schema: stringSchema,
      handler: () => {
        throw new Error("boom");
      },
      retryPolicy: () => null,
    });
    const message = await makeTaskMessage("hopeless", "data");
    await federation.processQueuedTask(undefined, message);
    strictEqual(queue.enqueued.length, 0);
  });

  await t.step(
    "per-task retryPolicy overrides the federation default",
    async () => {
      const queue = new MockQueue();
      const federation = createFederation<void>({
        ...baseOptions,
        queue: { task: queue },
        taskRetryPolicy: () => null, // the federation default gives up…
      }) as FederationImpl<void>;
      federation.defineTask("override", {
        schema: stringSchema,
        handler: () => {
          throw new Error("boom");
        },
        // …but the per-task policy retries:
        retryPolicy: () => Temporal.Duration.from({ milliseconds: 1 }),
      });
      federation.defineTask("default", {
        schema: stringSchema,
        handler: () => {
          throw new Error("boom");
        },
      });
      await federation.processQueuedTask(
        undefined,
        await makeTaskMessage("override", "data"),
      );
      strictEqual(queue.enqueued.length, 1);
      await federation.processQueuedTask(
        undefined,
        await makeTaskMessage("default", "data"),
      );
      strictEqual(queue.enqueued.length, 1); // unchanged: gave up
    },
  );

  await t.step(
    "still retries when message.started is malformed",
    async () => {
      const queue = new MockQueue();
      const federation = createFederation<void>({
        ...baseOptions,
        queue: { task: queue },
      }) as FederationImpl<void>;
      federation.defineTask("bad-started", {
        schema: stringSchema,
        handler: () => {
          throw new Error("boom");
        },
        retryPolicy: () => Temporal.Duration.from({ milliseconds: 1 }),
      });
      // A corrupted or drifted queue can hand back an invalid `started`;
      // computing elapsedTime must not throw out of the error path and abort
      // the retry.
      const message = await makeTaskMessage("bad-started", "data", {
        started: "not-an-instant",
      });
      await federation.processQueuedTask(undefined, message);
      strictEqual(queue.enqueued.length, 1);
      strictEqual(queue.enqueued[0].message.attempt, 1);
    },
  );

  await t.step("rethrows on a nativeRetrial queue", async () => {
    const queue = new MockQueue({ nativeRetrial: true });
    const federation = createFederation<void>({
      ...baseOptions,
      queue: { task: queue },
    }) as FederationImpl<void>;
    federation.defineTask("native", {
      schema: stringSchema,
      handler: () => {
        throw new Error("boom");
      },
    });
    const message = await makeTaskMessage("native", "data");
    await rejects(
      () => federation.processQueuedTask(undefined, message),
      { message: /boom/ },
    );
    strictEqual(queue.enqueued.length, 0);
  });
});

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

/** Wires test telemetry doubles into a fresh federation for the suite below. */
const instrument = (options: FederationOptions<void>) => {
  const [meterProvider, recorder] = createTestMeterProvider();
  const [tracerProvider, exporter] = createTestTracerProvider();
  const federation = createFederation<void>({
    ...options,
    meterProvider,
    tracerProvider,
  }) as FederationImpl<void>;
  return { federation, recorder, exporter };
};

test("task observability", async (t) => {
  await t.step(
    "opens a fedify.task span carrying name and attempt on success",
    async () => {
      const queue = new MockQueue();
      const { federation, recorder, exporter } = instrument({
        ...baseOptions,
        queue: { task: queue },
      });
      federation.defineTask("sendDigest", {
        schema: stringSchema,
        handler: () => {},
      });
      await federation.processQueuedTask(
        undefined,
        await makeTaskMessage("sendDigest", "payload"),
      );

      const spans = exporter.getSpans("fedify.task");
      strictEqual(spans.length, 1);
      strictEqual(spans[0].attributes["fedify.task.name"], "sendDigest");
      strictEqual(spans[0].attributes["fedify.task.attempt"], 0);
      // A completed task carries no failure reason on its span…
      strictEqual(spans[0].attributes["fedify.task.failure_reason"], undefined);
      strictEqual(spans[0].status.code, SpanStatusCode.UNSET);

      const started = recorder.getMeasurements("fedify.queue.task.started");
      strictEqual(started.length, 1);
      strictEqual(started[0].attributes["fedify.queue.role"], "task");
      strictEqual(started[0].attributes["fedify.task.name"], "sendDigest");

      const completed = recorder.getMeasurements("fedify.queue.task.completed");
      strictEqual(completed.length, 1);
      strictEqual(completed[0].attributes["fedify.queue.role"], "task");
      strictEqual(completed[0].attributes["fedify.task.name"], "sendDigest");
      strictEqual(
        completed[0].attributes["fedify.queue.task.result"],
        "completed",
      );
      // …nor on its outcome metric.
      strictEqual(
        completed[0].attributes["fedify.task.failure_reason"],
        undefined,
      );
      strictEqual(
        recorder.getMeasurements("fedify.queue.task.failed").length,
        0,
      );
    },
  );

  await t.step(
    "inherits the parent trace context from the enqueue site",
    async () => {
      // The worker extracts the parent through the global propagator; a real
      // W3C propagator is required because the default is a no-op.
      const traceId = "0af7651916cd43dd8448eb211c80319c";
      const spanId = "b7ad6b7169203331";
      propagation.setGlobalPropagator(new W3CTraceContextPropagator());
      try {
        const queue = new MockQueue();
        const { federation, exporter } = instrument({
          ...baseOptions,
          queue: { task: queue },
        });
        federation.defineTask("traced", {
          schema: stringSchema,
          handler: () => {},
        });
        await federation.processQueuedTask(
          undefined,
          await makeTaskMessage("traced", "payload", {
            traceContext: {
              traceparent: `00-${traceId}-${spanId}-01`,
            },
          }),
        );

        const span = exporter.getSpans("fedify.task")[0];
        ok(span != null);
        strictEqual(span.spanContext().traceId, traceId);
        strictEqual(span.parentSpanContext?.spanId, spanId);
      } finally {
        propagation.disable();
      }
    },
  );

  await t.step(
    "attributes a deserialization failure and drops without retry",
    async () => {
      const queue = new MockQueue();
      const { federation, recorder, exporter } = instrument({
        ...baseOptions,
        queue: { task: queue },
      });
      let called = 0;
      federation.defineTask("decode-me", {
        schema: stringSchema,
        handler: () => {
          called++;
        },
      });
      const message = await makeTaskMessage("decode-me", "payload");
      await federation.processQueuedTask(undefined, {
        ...message,
        data: "garbage that is not devalue",
      });

      strictEqual(called, 0);
      strictEqual(queue.enqueued.length, 0); // dropped, not retried
      const failed = recorder.getMeasurements("fedify.queue.task.failed");
      strictEqual(failed.length, 1);
      strictEqual(failed[0].attributes["fedify.queue.role"], "task");
      strictEqual(
        failed[0].attributes["fedify.task.failure_reason"],
        "deserialization",
      );
      const span = exporter.getSpans("fedify.task")[0];
      strictEqual(
        span.attributes["fedify.task.failure_reason"],
        "deserialization",
      );
      // A dropped payload is a failed outcome, so the span status is ERROR.
      strictEqual(span.status.code, SpanStatusCode.ERROR);
    },
  );

  await t.step(
    "attributes a validation failure and drops without retry",
    async () => {
      const queue = new MockQueue();
      const { federation, recorder, exporter } = instrument({
        ...baseOptions,
        queue: { task: queue },
      });
      let called = 0;
      federation.defineTask("strict-shape", {
        schema: numberSchema, // expects a number…
        handler: () => {
          called++;
        },
      });
      // …but a valid devalue payload carries a string.
      await federation.processQueuedTask(
        undefined,
        await makeTaskMessage("strict-shape", "not a number"),
      );

      strictEqual(called, 0);
      strictEqual(queue.enqueued.length, 0); // dropped, not retried
      const failed = recorder.getMeasurements("fedify.queue.task.failed");
      strictEqual(failed.length, 1);
      strictEqual(
        failed[0].attributes["fedify.task.failure_reason"],
        "validation",
      );
      const span = exporter.getSpans("fedify.task")[0];
      strictEqual(
        span.attributes["fedify.task.failure_reason"],
        "validation",
      );
      strictEqual(span.status.code, SpanStatusCode.ERROR);
    },
  );

  await t.step(
    "attributes an unknown task and drops without retry",
    async () => {
      const queue = new MockQueue();
      const { federation, recorder, exporter } = instrument({
        ...baseOptions,
        queue: { task: queue },
      });
      await federation.processQueuedTask(
        undefined,
        await makeTaskMessage("never-registered", "payload"),
      );

      strictEqual(queue.enqueued.length, 0); // dropped, not retried
      const failed = recorder.getMeasurements("fedify.queue.task.failed");
      strictEqual(failed.length, 1);
      strictEqual(
        failed[0].attributes["fedify.task.failure_reason"],
        "unknown_task",
      );
      // The backend label is still populated on an unknown-task drop.
      strictEqual(failed[0].attributes["fedify.queue.backend"], "MockQueue");
      // Cardinality guard: an unregistered, wire-derived task name must NOT
      // become a metric attribute—it would spawn unbounded time series…
      strictEqual(failed[0].attributes["fedify.task.name"], undefined);
      strictEqual(
        recorder.getMeasurements("fedify.queue.task.started")[0]
          .attributes["fedify.task.name"],
        undefined,
      );
      const span = exporter.getSpans("fedify.task")[0];
      // …but the span still carries the real name for tracing the drop.
      strictEqual(span.attributes["fedify.task.name"], "never-registered");
      strictEqual(
        span.attributes["fedify.task.failure_reason"],
        "unknown_task",
      );
      strictEqual(span.status.code, SpanStatusCode.ERROR);
    },
  );

  await t.step(
    "attributes a handler failure on a terminal give-up",
    async () => {
      const queue = new MockQueue();
      const { federation, recorder, exporter } = instrument({
        ...baseOptions,
        queue: { task: queue },
      });
      federation.defineTask("explode", {
        schema: stringSchema,
        handler: () => {
          throw new Error("boom");
        },
        retryPolicy: () => null, // give up immediately
      });
      await federation.processQueuedTask(
        undefined,
        await makeTaskMessage("explode", "payload"),
      );

      strictEqual(queue.enqueued.length, 0); // gave up, no retry
      const failed = recorder.getMeasurements("fedify.queue.task.failed");
      strictEqual(failed.length, 1);
      strictEqual(
        failed[0].attributes["fedify.task.failure_reason"],
        "handler",
      );
      const span = exporter.getSpans("fedify.task")[0];
      strictEqual(
        span.attributes["fedify.task.failure_reason"],
        "handler",
      );
      // A terminal give-up is a failed outcome, so the span status is ERROR.
      strictEqual(span.status.code, SpanStatusCode.ERROR);
    },
  );

  await t.step(
    "reports the resolved outbox queue as the backend on fallback",
    async () => {
      // A distinctly named queue so the backend label is unambiguous.
      class FallbackOutboxQueue extends MockQueue {}
      const outboxQueue = new FallbackOutboxQueue();
      const { federation, recorder } = instrument({
        ...baseOptions,
        queue: { outbox: outboxQueue }, // no dedicated task queue
      });
      federation.defineTask("fallback", {
        schema: stringSchema,
        handler: () => {},
      });
      await federation.processQueuedTask(
        undefined,
        await makeTaskMessage("fallback", "payload"),
      );

      const completed = recorder.getMeasurements("fedify.queue.task.completed");
      strictEqual(completed.length, 1);
      strictEqual(
        completed[0].attributes["fedify.queue.backend"],
        "FallbackOutboxQueue",
      );
    },
  );

  await t.step(
    "records an enqueue measurement with role task",
    async () => {
      const queue = new MockQueue();
      const { federation, recorder } = instrument({
        ...baseOptions,
        queue: { task: queue },
      });
      const task = federation.defineTask("enqueue-me", {
        schema: stringSchema,
        handler: () => {},
      });
      const ctx = federation.createContext(
        new URL("https://example.com/"),
        undefined,
      );
      await ctx.enqueueTask(task, "payload");

      const enqueued = recorder.getMeasurements("fedify.queue.task.enqueued");
      strictEqual(enqueued.length, 1);
      strictEqual(enqueued[0].attributes["fedify.queue.role"], "task");
      strictEqual(enqueued[0].attributes["fedify.task.name"], "enqueue-me");
      strictEqual(enqueued[0].attributes["fedify.queue.task.attempt"], 0);
    },
  );

  await t.step(
    "records the retry re-enqueue with role task and a bumped attempt",
    async () => {
      const queue = new MockQueue();
      const { federation, recorder, exporter } = instrument({
        ...baseOptions,
        queue: { task: queue },
      });
      federation.defineTask("retry-me", {
        schema: stringSchema,
        handler: () => {
          throw new Error("boom");
        },
        retryPolicy: () => Temporal.Duration.from({ milliseconds: 1 }),
      });
      await federation.processQueuedTask(
        undefined,
        await makeTaskMessage("retry-me", "payload"),
      );

      strictEqual(queue.enqueued.length, 1);
      strictEqual(queue.enqueued[0].message.attempt, 1);
      const enqueued = recorder.getMeasurements("fedify.queue.task.enqueued");
      strictEqual(enqueued.length, 1);
      strictEqual(enqueued[0].attributes["fedify.queue.role"], "task");
      strictEqual(enqueued[0].attributes["fedify.task.name"], "retry-me");
      strictEqual(enqueued[0].attributes["fedify.queue.task.attempt"], 1);
      const span = exporter.getSpans("fedify.task")[0];
      strictEqual(span.attributes["fedify.task.failure_reason"], undefined);
      strictEqual(span.status.code, SpanStatusCode.UNSET);
      strictEqual(
        recorder.getMeasurements("fedify.queue.task.failed").length,
        0,
      );
      const completed = recorder.getMeasurements("fedify.queue.task.completed");
      strictEqual(completed.length, 1);
      strictEqual(
        completed[0].attributes["fedify.task.failure_reason"],
        undefined,
      );
    },
  );

  await t.step(
    "records an abort as aborted, without a failure reason or error status",
    async () => {
      const queue = new MockQueue({ nativeRetrial: true });
      const { federation, recorder, exporter } = instrument({
        ...baseOptions,
        queue: { task: queue },
      });
      federation.defineTask("aborts", {
        schema: stringSchema,
        handler: () => {
          throw globalThis.Object.assign(new Error("shutting down"), {
            name: "AbortError",
          });
        },
      });
      const message = await makeTaskMessage("aborts", "payload");
      await rejects(
        () => federation.processQueuedTask(undefined, message),
        { name: "AbortError" },
      );

      const span = exporter.getSpans("fedify.task")[0];
      ok(span != null);
      strictEqual(span.attributes["fedify.task.failure_reason"], undefined);
      strictEqual(span.status.code, SpanStatusCode.UNSET);
      strictEqual(
        recorder.getMeasurements("fedify.queue.task.failed").length,
        0,
      );
      const durations = recorder.getMeasurements("fedify.queue.task.duration");
      strictEqual(durations.length, 1);
      strictEqual(
        durations[0].attributes["fedify.queue.task.result"],
        "aborted",
      );
    },
  );

  await t.step(
    "on a non-native queue an aborted handler that gives up is aborted",
    async () => {
      const queue = new MockQueue();
      const { federation, recorder, exporter } = instrument({
        ...baseOptions,
        queue: { task: queue },
      });
      federation.defineTask("aborts-give-up", {
        schema: stringSchema,
        handler: () => {
          throw globalThis.Object.assign(new Error("shutting down"), {
            name: "AbortError",
          });
        },
        retryPolicy: () => null,
      });
      await federation.processQueuedTask(
        undefined,
        await makeTaskMessage("aborts-give-up", "payload"),
      );

      strictEqual(queue.enqueued.length, 0);
      const span = exporter.getSpans("fedify.task")[0];
      strictEqual(span.attributes["fedify.task.failure_reason"], undefined);
      strictEqual(span.status.code, SpanStatusCode.UNSET);
      strictEqual(
        recorder.getMeasurements("fedify.queue.task.failed").length,
        0,
      );
      strictEqual(
        recorder.getMeasurements("fedify.queue.task.completed").length,
        0,
      );
      const durations = recorder.getMeasurements("fedify.queue.task.duration");
      strictEqual(durations.length, 1);
      strictEqual(
        durations[0].attributes["fedify.queue.task.result"],
        "aborted",
      );
    },
  );

  await t.step(
    "on a non-native queue an aborted handler is retried, not failed",
    async () => {
      const queue = new MockQueue(); // nativeRetrial: false
      const { federation, recorder, exporter } = instrument({
        ...baseOptions,
        queue: { task: queue },
      });
      federation.defineTask("aborts-soft", {
        schema: stringSchema,
        handler: () => {
          throw globalThis.Object.assign(new Error("shutting down"), {
            name: "AbortError",
          });
        },
        retryPolicy: () => Temporal.Duration.from({ milliseconds: 1 }),
      });
      await federation.processQueuedTask(
        undefined,
        await makeTaskMessage("aborts-soft", "payload"),
      );

      strictEqual(queue.enqueued.length, 1); // retried, behavior unchanged
      strictEqual(queue.enqueued[0].message.attempt, 1);
      // No `handler` failure leaks onto the span or any failure metric…
      const span = exporter.getSpans("fedify.task")[0];
      strictEqual(span.attributes["fedify.task.failure_reason"], undefined);
      strictEqual(span.status.code, SpanStatusCode.UNSET);
      strictEqual(
        recorder.getMeasurements("fedify.queue.task.failed").length,
        0,
      );
      // …and the swallowed-into-retry attempt records `completed`, matching the
      // inbox/outbox internal-retry convention.
      const completed = recorder.getMeasurements("fedify.queue.task.completed");
      strictEqual(completed.length, 1);
      strictEqual(
        completed[0].attributes["fedify.task.failure_reason"],
        undefined,
      );
    },
  );
});
