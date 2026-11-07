import { mockDocumentLoader, test } from "@fedify/fixture";
import { Create, Person } from "@fedify/vocab";
import {
  configure,
  getLogger,
  type LogRecord,
  reset,
  withContext,
} from "@logtape/logtape";
import fetchMock from "fetch-mock";
import { AsyncLocalStorage } from "node:async_hooks";
import { deepStrictEqual, ok, rejects, strictEqual } from "node:assert/strict";
import { rsaPrivateKey2, rsaPublicKey2 } from "../testing/keys.ts";
import type { SendActivityOptions } from "./context.ts";
import type { Federation } from "./federation.ts";
import { MemoryKvStore } from "./kv.ts";
import { ContextImpl, createFederation } from "./middleware.ts";
import type { MessageQueue } from "./mq.ts";
import type {
  OutboundBroadcastEvent,
  OutboundDeliveryEvent,
} from "./outbound-report.ts";
import type { Message } from "./queue.ts";
import type { SenderKeyPair } from "./send.ts";

const activity = new Create({
  id: new URL("https://example.com/dispatch"),
  actor: new URL("https://example.com/person2"),
});
const target = new Person({
  id: new URL("https://remote.example/bob"),
  inbox: new URL("https://remote.example/inbox"),
});
const sender = { keyId: rsaPublicKey2.id!, privateKey: rsaPrivateKey2 };
const loaders = {
  documentLoaderFactory: () => mockDocumentLoader,
  contextLoaderFactory: () => mockDocumentLoader,
};
const modes = [
  "send",
  "outbox-send",
  "inbox-forward",
  "outbox-forward",
] as const;
type Mode = (typeof modes)[number];
function entry(
  federation: Federation<void>,
  mode: Mode,
  identity: SenderKeyPair | { identifier: string } = sender,
) {
  const base = federation.createContext(
    new URL("https://example.com"),
    undefined,
  );
  ok(base instanceof ContextImpl);
  const outbox = base.toOutboxContext(
    "alice",
    {},
    activity.id!.href,
    Create.typeId.href,
  );
  const inbox = base.toInboxContext(
    null,
    {},
    activity.id!.href,
    Create.typeId.href,
  );
  if (mode === "send") {
    return {
      context: base,
      invoke: (options: SendActivityOptions) =>
        base.sendActivity(
          identity,
          target,
          activity,
          Object.assign(options, { fanout: "force" as const }),
        ),
    };
  }
  if (mode === "outbox-send") {
    return {
      context: outbox,
      invoke: (options: SendActivityOptions) =>
        outbox.sendActivity(
          identity,
          target,
          activity,
          Object.assign(options, { fanout: "skip" as const }),
        ),
    };
  }
  const context = mode === "inbox-forward" ? inbox : outbox;
  return {
    context,
    invoke: (options: SendActivityOptions) =>
      context.forwardActivity(
        identity,
        target,
        Object.assign(options, { skipIfUnsigned: false }),
      ),
  };
}

test("dispatch ID validation precedes send and forward side effects", async (t) => {
  for (const { mode, observed } of [
    { mode: "send" as const, observed: false },
    ...modes.map((mode) => ({ mode, observed: true })),
  ]) {
    await t.step(
      `${mode}: ${observed ? "observed" : "unobserved"}`,
      async () => {
        let sideEffects = 0;
        const queue: MessageQueue = {
          enqueue() {
            sideEffects++;
            return Promise.resolve();
          },
          listen: () => Promise.resolve(),
        };
        const federation = createFederation<void>({
          ...loaders,
          kv: new MemoryKvStore(),
          manuallyStartQueue: true,
          queue: { outbox: queue, fanout: queue },
        });
        federation
          .setActorDispatcher("/users/{identifier}", () => {
            sideEffects++;
            return new Person({});
          })
          .setKeyPairsDispatcher(() => {
            sideEffects++;
            return [];
          });
        const { context, invoke } = entry(federation, mode, {
          identifier: "alice",
        });
        const provider = context.tracerProvider;
        Object.defineProperty(context, "tracerProvider", {
          get() {
            sideEffects++;
            return provider;
          },
        });
        const events: OutboundBroadcastEvent[] = [];
        let deliveries = 0;
        if (observed) {
          federation.setOutboundObservers({
            onBroadcast(_ctx, event) {
              events.push(event);
            },
            onDelivery() {
              deliveries++;
            },
          });
        }
        for (const value of [null, "x".repeat(1025), "😀".repeat(257)]) {
          const start = events.length;
          let original: unknown;
          await rejects(
            invoke({ dispatchId: value as string }),
            (error: unknown) => {
              original = error;
              ok(
                value === null
                  ? error instanceof TypeError
                  : error instanceof RangeError,
              );
              ok((error as Error).message.includes("dispatchId"));
              return true;
            },
          );
          strictEqual(sideEffects, 0);
          strictEqual(deliveries, 0);
          if (observed) {
            deepStrictEqual(
              events.slice(start).map((event) => event.stage),
              ["started", "preparation-finished"],
            );
            const finished = events.at(-1)!;
            ok(
              finished.stage === "preparation-finished" &&
                finished.result.type === "failed",
            );
            strictEqual(finished.result.failure.phase, "validation");
            strictEqual(finished.result.failure.error, original);
            strictEqual(finished.provenance.dispatchId, undefined);
          }
        }
      },
    );
  }
});

test("dispatch IDs correlate send and forward entries without deduplication or context leakage", async (t) => {
  for (const mode of modes) {
    await t.step(mode, async () => {
      const messages: Message[] = [];
      const queue: MessageQueue = {
        enqueue(message) {
          messages.push(message);
          return Promise.resolve();
        },
        listen: () => Promise.resolve(),
      };
      const federation = createFederation<void>({
        ...loaders,
        kv: new MemoryKvStore(),
        manuallyStartQueue: true,
        queue: { fanout: queue, outbox: queue },
      });
      const { context, invoke } = entry(federation, mode);
      const broadcasts: OutboundBroadcastEvent[] = [];
      const deliveries: OutboundDeliveryEvent[] = [];
      const contexts: unknown[] = [];
      let current: { dispatchId?: string } = {};
      federation.setOutboundObservers({
        onBroadcast(ctx, event) {
          broadcasts.push(event);
          contexts.push(ctx);
          if (event.stage === "started") {
            current.dispatchId = "observer-mutated";
          }
        },
        onDelivery(ctx, event) {
          deliveries.push(event);
          contexts.push(ctx);
        },
      });
      const dispatchId = '  app\\dispatch"\n한글  ';
      for (const value of [dispatchId, dispatchId, undefined]) {
        current = { dispatchId: value };
        await invoke(current);
      }
      strictEqual(messages.length, 3);
      const starts = broadcasts.filter((event) => event.stage === "started");
      strictEqual(starts.length, 3);
      strictEqual(new Set(starts.map((event) => event.broadcastId)).size, 3);
      deepStrictEqual(
        starts.map((event) => event.activity),
        [{}, {}, {}],
      );
      const finishes = broadcasts.filter(
        (event) => event.stage === "preparation-finished",
      );
      strictEqual(finishes.length, 3);
      for (const event of finishes) {
        deepStrictEqual(event.activity, {
          id: activity.id!.href,
          type: Create.typeId.href,
        });
        ok(Object.isFrozen(event.activity));
      }
      for (const ctx of contexts) strictEqual(ctx, context);
      for (let index = 0; index < 3; index++) {
        const message = messages[index];
        ok(message.type === "outbox" || message.type === "fanout");
        const expected = index < 2 ? dispatchId : undefined;
        strictEqual(message.provenance?.dispatchId, expected);
        strictEqual(starts[index].provenance.dispatchId, expected);
        deepStrictEqual(
          JSON.parse(JSON.stringify(message.provenance ?? {})),
          message.provenance ?? {},
        );
        const delivery = deliveries[index * 2];
        strictEqual(delivery.provenance.dispatchId, expected);
      }
      if (mode === "send") {
        const fanout = messages[0];
        ok(fanout.type === "fanout");
        await federation.processQueuedTask(
          undefined,
          JSON.parse(JSON.stringify(fanout)),
        );
        await federation.processQueuedTask(undefined, structuredClone(fanout));
        for (const child of messages.slice(3)) {
          ok(child.type === "outbox");
          strictEqual(child.provenance?.dispatchId, dispatchId);
          deepStrictEqual(
            child.outbound,
            fanout.inboxes[target.inboxId!.href].outbound,
          );
        }
        strictEqual(messages.length, 5);
        strictEqual(broadcasts.length, 6);
      }
    });
  }
});

test("dispatch ID byte limits and queue fallback preserve exact values", async () => {
  const messages: Message[] = [];
  const queue: MessageQueue = {
    enqueue(message) {
      messages.push(message);
      return Promise.resolve();
    },
    listen: () => Promise.resolve(),
  };
  const producer = createFederation<void>({
    ...loaders,
    kv: new MemoryKvStore(),
    manuallyStartQueue: true,
    queue: { outbox: queue },
  });
  const { invoke } = entry(producer, "outbox-send");
  const valid = ["", "x".repeat(1024), "😀".repeat(256)];
  for (const dispatchId of valid) await invoke({ dispatchId });
  strictEqual(messages.length, 3);
  const records: LogRecord[] = [];
  await reset();
  await configure({
    sinks: { buffer: (record) => records.push(record) },
    loggers: [
      {
        category: ["test", "dispatch"],
        sinks: ["buffer"],
        lowestLevel: "info",
      },
      {
        category: ["fedify", "federation", "queue"],
        sinks: ["buffer"],
        lowestLevel: "warning",
      },
      { category: ["logtape", "meta"], sinks: [] },
    ],
    contextLocalStorage: new AsyncLocalStorage(),
  });
  const consumer = createFederation<void>({
    kv: new MemoryKvStore(),
    allowPrivateAddress: true,
    manuallyStartQueue: true,
    queue: { outbox: queue },
  });
  const descendants: OutboundBroadcastEvent[] = [];
  consumer.setOutboundObservers({
    onBroadcast(_ctx, event) {
      descendants.push(event);
    },
  });
  consumer.setOutboxPermanentFailureHandler(async (ctx) => {
    getLogger(["test", "dispatch"]).info("original dispatch");
    // A new public invocation needs its own application-owned correlation.
    await ctx.sendActivity(sender, [], activity);
  });
  fetchMock.mockGlobal().post(target.inboxId!.href, 410);
  try {
    const queued = messages[0];
    ok(queued.type === "outbox");
    const malformed = [
      { dispatchId: null },
      { dispatchId: "x".repeat(1025) },
      { dispatchId: "😀".repeat(257) },
      {
        inboxRequest: {
          inboxRequestId: "",
          requestId: "bad",
          context: {
            origin: "x",
            host: "x",
            hostname: "x",
            canonicalOrigin: "x",
          },
        },
      },
    ];
    for (const provenance of malformed) {
      await withContext(
        { requestId: "current-request", dispatchId: "ambient-dispatch" },
        () =>
          consumer.processQueuedTask(undefined, {
            ...queued,
            provenance: provenance as NonNullable<typeof queued.provenance>,
          }),
      );
    }
    ok(fetchMock.callHistory.calls().length >= malformed.length);
    const warnings = records.filter(
      (record) =>
        record.rawMessage ===
        "Ignoring invalid provenance in queue message {messageId}: {error}",
    );
    strictEqual(warnings.length, malformed.length);
    for (const warning of warnings) {
      strictEqual(warning.properties.messageId, queued.id);
    }
    for (let index = 0; index < messages.length; index++) {
      const message = messages[index];
      ok(message.type === "outbox");
      strictEqual(message.provenance?.dispatchId, valid[index]);
      await withContext(
        { requestId: "current-request", dispatchId: "ambient-dispatch" },
        () =>
          consumer.processQueuedTask(
            undefined,
            JSON.parse(JSON.stringify(message)),
          ),
      );
    }
    const logs = records.filter(
      (record) => record.rawMessage === "original dispatch",
    );
    deepStrictEqual(
      logs.map((record) => record.properties.dispatchId),
      [...malformed.map(() => undefined), ...valid],
    );
    for (const record of logs) {
      strictEqual(record.properties.requestId, "current-request");
    }
    strictEqual(descendants.length, 2 * (malformed.length + valid.length));
    for (const event of descendants) {
      strictEqual(event.provenance.dispatchId, undefined);
    }
  } finally {
    fetchMock.hardReset();
    await reset();
  }
});

test("malformed queued provenance does not poison a retry", async () => {
  const messages: Message[] = [];
  const queue: MessageQueue = {
    enqueue(message) {
      messages.push(message);
      return Promise.resolve();
    },
    listen: () => Promise.resolve(),
  };
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    allowPrivateAddress: true,
    manuallyStartQueue: true,
    outboxRetryPolicy: () => Temporal.Duration.from({ milliseconds: 1 }),
    queue: { outbox: queue },
  });
  await federation
    .createContext(new URL("https://example.com"), undefined)
    .sendActivity(sender, target, activity, { fanout: "skip" });
  const original = messages[0];
  ok(original.type === "outbox");
  const malformed = {
    ...original,
    provenance: { inboxRequest: { inboxRequestId: "" } },
  } as Message;
  fetchMock.mockGlobal().post(target.inboxId!.href, 503);
  try {
    await federation.processQueuedTask(undefined, malformed);
    strictEqual(messages.length, 2);
    const retry = messages[1];
    ok(retry.type === "outbox");
    deepStrictEqual(retry.provenance, {});
    strictEqual(retry.attempt, 1);
    await federation.processQueuedTask(undefined, retry);
    strictEqual(messages.length, 3);
    const next = messages[2];
    ok(next.type === "outbox");
    deepStrictEqual(next.provenance, {});
  } finally {
    fetchMock.hardReset();
  }
});
