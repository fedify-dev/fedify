import { mockDocumentLoader, test } from "@fedify/fixture";
import { Note } from "@fedify/vocab";
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
import type { Federatable } from "../federation.ts";
import { createFederation, type FederationImpl } from "../middleware.ts";
import { InProcessMessageQueue } from "../mq.ts";
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
