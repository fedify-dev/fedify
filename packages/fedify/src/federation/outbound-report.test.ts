import {
  createTestTracerProvider,
  mockDocumentLoader,
  test,
} from "@fedify/fixture";
import { Create, Person } from "@fedify/vocab";
import { configure, reset } from "@logtape/logtape";
import { SpanStatusCode } from "@opentelemetry/api";
import fetchMock from "fetch-mock";
import {
  deepStrictEqual,
  notStrictEqual,
  ok,
  rejects,
  strictEqual,
} from "node:assert/strict";
import { createFederationBuilder } from "./builder.ts";
import { MemoryKvStore } from "./kv.ts";
import {
  ContextImpl,
  createFederation,
  OutboxContextImpl,
} from "./middleware.ts";
import type {
  Federation,
  Message,
  MessageQueue,
  OutboundBroadcastEvent,
  OutboundDeliveryEvent,
  OutboundObservers,
} from "./mod.ts";
import { rsaPrivateKey2, rsaPublicKey2 } from "../testing/keys.ts";

const activity = new Create({
  id: new URL("https://example.com/create"),
  actor: new URL("https://example.com/alice"),
});
const sender = { keyId: rsaPublicKey2.id!, privateKey: rsaPrivateKey2 };
const options = {
  kv: new MemoryKvStore(),
  documentLoaderFactory: () => mockDocumentLoader,
  contextLoaderFactory: () => mockDocumentLoader,
};

test("outbound observers report fresh immutable starts without tracing or extra loading", async (t) => {
  const { AlwaysOffSampler, BasicTracerProvider } = await import(
    "@opentelemetry/sdk-trace-base"
  );
  const provider = new BasicTracerProvider({ sampler: new AlwaysOffSampler() });
  try {
    for (const tracerProvider of [undefined, provider]) {
      await t.step(
        tracerProvider == null ? "no provider" : "sampling disabled",
        async () => {
          let loads = 0;
          const federation = createFederation<{ label: string }>({
            kv: new MemoryKvStore(),
            tracerProvider,
            documentLoaderFactory: () => () => {
              loads++;
              throw new Error("unexpected observation lookup");
            },
            contextLoaderFactory: () => () => {
              loads++;
              throw new Error("unexpected observation lookup");
            },
          });
          const ctx = federation.createContext(new URL("https://example.com"), {
            label: "app",
          });
          const events: OutboundBroadcastEvent[] = [];
          federation.setOutboundObservers({
            onBroadcast(context, event) {
              strictEqual(context, ctx);
              strictEqual(context.data.label, "app");
              strictEqual(event.operation, "send");
              ok(Object.isFrozen(event));
              events.push(event);
            },
          });
          await ctx.sendActivity(sender, [], activity);
          await ctx.sendActivity(sender, [], activity);
          deepStrictEqual(preparation(events.slice(0, 2)), {
            type: "skipped",
            reason: "no-destinations",
          });
          deepStrictEqual(preparation(events.slice(2)), {
            type: "skipped",
            reason: "no-destinations",
          });
          ok(events[0].broadcastId.length > 0);
          notStrictEqual(events[0].broadcastId, events[2].broadcastId);
          strictEqual(loads, 0);
        },
      );
    }
  } finally {
    await provider.shutdown();
  }
});

test("outbound observers await entry before preparation and retain the selected callback", async () => {
  const federation = createFederation<void>(options);
  let preparations = 0;
  const failure = Symbol("original preparation failure");
  federation.setActorDispatcher("/users/{identifier}", () => new Person({}))
    .mapHandle(() => {
      preparations++;
      throw failure;
    });
  const ctx = federation.createContext(
    new URL("https://example.com"),
    undefined,
  );
  let entered!: () => void;
  const entry = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: string[] = [];
  federation.setOutboundObservers({
    async onBroadcast(_ctx, event) {
      calls.push(`original:${event.stage}`);
      entered();
      await gate;
      throw new Error("asynchronous observer failure");
    },
  });
  const pending = rejects(
    ctx.sendActivity({ username: "alice" }, [], activity),
    (error: unknown) => error === failure,
  );
  await entry;
  strictEqual(preparations, 0);
  federation.setOutboundObservers({
    onBroadcast(_ctx, event) {
      calls.push(`replacement:${event.stage}`);
    },
  });
  release();
  await pending;
  await rejects(
    ctx.sendActivity({ username: "alice" }, [], activity),
    (error: unknown) => error === failure,
  );
  deepStrictEqual(calls, [
    "original:started",
    "original:preparation-finished",
    "replacement:started",
    "replacement:preparation-finished",
  ]);
  strictEqual(preparations, 2);
});

test("outbound observers isolate callback and logging errors from success and original failures", async () => {
  let logCalls = 0;
  await configure({
    reset: true,
    sinks: {
      broken() {
        logCalls++;
        throw new Error("sink failed");
      },
    },
    loggers: [
      {
        category: ["fedify", "federation", "outbox"],
        sinks: ["broken"],
        lowestLevel: "error",
      },
      { category: ["logtape", "meta"], sinks: [] },
    ],
  });
  try {
    const federation = createFederation<void>(options);
    const failure = { original: true };
    let calls = 0;
    federation.setActorDispatcher("/users/{identifier}", () => new Person({}))
      .mapHandle(() => {
        throw failure;
      });
    federation.setOutboundObservers({
      onBroadcast() {
        calls++;
        throw "observer failed";
      },
    });
    const ctx = federation.createContext(
      new URL("https://example.com"),
      undefined,
    );
    await ctx.sendActivity(sender, [], activity);
    await rejects(
      ctx.sendActivity({ username: "alice" }, [], activity),
      (error: unknown) => error === failure,
    );
    strictEqual(calls, 4);
    strictEqual(logCalls, 4);
  } finally {
    await reset();
  }
});

test("outbound observers copy registration and isolate builder instances", async () => {
  const builder = createFederationBuilder<void>();
  const calls: string[] = [];
  const registration = {
    onBroadcast() {
      calls.push("original");
    },
  } satisfies OutboundObservers<void>;
  builder.setOutboundObservers(registration);
  registration.onBroadcast = () => {
    calls.push("mutated");
  };
  const first = await builder.build(options);
  const second = await builder.build(options);
  builder.setOutboundObservers({
    onBroadcast() {
      calls.push("new builder");
    },
  });
  const third = await builder.build(options);
  first.setOutboundObservers({
    onBroadcast() {
      calls.push("first only");
    },
  });
  for (const federation of [first, second, third]) {
    await federation.createContext(new URL("https://example.com"), undefined)
      .sendActivity(sender, [], activity);
  }
  deepStrictEqual(calls, [
    "first only",
    "first only",
    "original",
    "original",
    "new builder",
    "new builder",
  ]);
  second.setOutboundObservers({});
  await second.createContext(new URL("https://example.com"), undefined)
    .sendActivity(sender, [], activity);
  strictEqual(calls.length, 6);
});

test("outbound observers do not veto an actual immediate delivery", async () => {
  const order: string[] = [];
  fetchMock.mockGlobal().post("https://receiver.example/inbox", (call) => {
    order.push("fetch");
    strictEqual(JSON.parse(String(call.options.body)).id, activity.id!.href);
    return 202;
  });
  try {
    const federation = createFederation<void>({
      kv: new MemoryKvStore(),
      allowPrivateAddress: true,
    });
    federation.setOutboundObservers({
      onBroadcast(_ctx, event) {
        order.push(event.stage);
        throw new Error("recording failed");
      },
    });
    await federation.createContext(new URL("https://example.com"), undefined)
      .sendActivity(
        sender,
        new Person({
          id: new URL("https://receiver.example/actor"),
          inbox: new URL("https://receiver.example/inbox"),
        }),
        activity,
        { immediate: true },
      );
    strictEqual(order[0], "started");
    strictEqual(order.filter((entry) => entry === "fetch").length, 1);
    strictEqual(
      order.filter((entry) => entry === "preparation-finished").length,
      1,
    );
  } finally {
    fetchMock.hardReset();
  }
});

function preparation(events: OutboundBroadcastEvent[]) {
  deepStrictEqual(events.map((event) => event.stage), [
    "started",
    "preparation-finished",
  ]);
  strictEqual(events[0].broadcastId, events[1].broadcastId);
  ok(events.every((event) => Object.isFrozen(event)));
  const event = events[1];
  ok(event.stage === "preparation-finished");
  ok(Object.isFrozen(event.result));
  return event.result;
}

const recipient = new Person({
  id: new URL("https://receiver.example/actor"),
  inbox: new URL("https://receiver.example/inbox"),
});

test("outbound preparation preserves failure provenance and plan completeness", async (t) => {
  for (
    const phase of [
      "sender-resolution",
      "key-resolution",
      "recipient-resolution",
      "transformation",
      "signing",
      "destination-planning",
      "serialization",
    ] as const
  ) {
    await t.step(phase, async () => {
      const failure = Symbol(phase);
      const events: OutboundBroadcastEvent[] = [];
      const federation = createFederation<void>({
        ...options,
        kv: new MemoryKvStore(),
        ...(phase === "transformation"
          ? {
            activityTransformers: [() => {
              throw failure;
            }],
          }
          : { activityTransformers: [] }),
      });
      federation.setOutboundObservers({
        onBroadcast(_ctx, event) {
          events.push(event);
        },
      });
      let sentActivity = activity;
      let target = recipient;
      if (phase === "serialization") {
        sentActivity = activity.clone({});
        Object.defineProperty(sentActivity, "toJsonLd", {
          value: () => Promise.reject(failure),
        });
      }
      if (phase === "signing") {
        sentActivity = activity.clone({});
        Object.defineProperty(sentActivity, "getProofs", {
          value() {
            throw failure;
          },
        });
      }
      if (phase === "destination-planning") {
        target = recipient.clone({});
        Object.defineProperty(target, "inboxId", {
          get() {
            throw failure;
          },
        });
      }
      if (phase === "sender-resolution") {
        federation.setActorDispatcher(
          "/users/{identifier}",
          () => new Person({}),
        )
          .mapHandle(() => {
            throw failure;
          });
      }
      let keyDispatches = 0;
      if (phase === "key-resolution" || phase === "recipient-resolution") {
        federation.setActorDispatcher(
          "/users/{identifier}",
          () => new Person({}),
        )
          .setKeyPairsDispatcher(() => {
            keyDispatches++;
            if (phase === "key-resolution") throw failure;
            return [{
              privateKey: rsaPrivateKey2,
              publicKey: rsaPublicKey2.publicKey!,
            }];
          });
      }
      if (phase === "recipient-resolution") {
        federation.setFollowersDispatcher(
          "/users/{identifier}/followers",
          () => {
            throw failure;
          },
        );
      }
      const ctx = federation.createContext(
        new URL("https://example.com"),
        undefined,
      );
      const sending = phase === "recipient-resolution"
        ? ctx.sendActivity({ identifier: "alice" }, "followers", sentActivity)
        : ctx.sendActivity(
          phase === "sender-resolution"
            ? { username: "alice" }
            : phase === "key-resolution"
            ? { identifier: "alice" }
            : sender,
          target,
          sentActivity,
        );
      let originalError: unknown;
      await rejects(sending, (error: unknown) => {
        originalError = error;
        if (phase === "key-resolution") {
          // Key-dispatcher errors are already handled by getActorKeyPairs().
          // Preserve the public send error from the resulting empty key set.
          return error instanceof Error &&
            error.message === 'No key pair found for actor "alice".';
        }
        return error === failure;
      });
      if (phase === "key-resolution" || phase === "recipient-resolution") {
        strictEqual(keyDispatches, 1);
      }
      const result = preparation(events);
      ok(result.type === "failed");
      strictEqual(result.failure.error, originalError);
      deepStrictEqual(result, {
        type: "failed",
        failure: { kind: "local", phase, error: originalError },
        planning: phase === "serialization"
          ? "complete"
          : phase === "destination-planning"
          ? "incomplete"
          : "not-started",
        plannedDestinationCount: phase === "serialization" ? 1 : 0,
      });
    });
  }
});

test("outbound preparation precedes queue acceptance and is not rewritten by enqueue failure", async (t) => {
  for (const role of ["outbox", "fanout"] as const) {
    for (const rejected of [false, true]) {
      await t.step(
        `${role}: ${rejected ? "enqueue rejects" : "enqueue accepts"}`,
        async () => {
          const failure = Symbol("enqueue failure");
          const events: OutboundBroadcastEvent[] = [];
          const messages: Message[] = [];
          const queue: MessageQueue = {
            enqueue(message) {
              messages.push(message);
              if (rejected) return Promise.reject(failure);
              return Promise.resolve();
            },
            listen: () => Promise.resolve(),
          };
          const federation = createFederation<void>({
            ...options,
            kv: new MemoryKvStore(),
            manuallyStartQueue: true,
            queue: { [role]: queue },
          });
          let ready!: () => void;
          const prepared = new Promise<void>((resolve) => {
            ready = resolve;
          });
          let release!: () => void;
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          federation.setOutboundObservers({
            async onBroadcast(_ctx, event) {
              events.push(event);
              if (event.stage === "preparation-finished") {
                ready();
                await gate;
              }
            },
          });
          const sending = federation.createContext(
            new URL("https://example.com"),
            undefined,
          )
            .sendActivity(sender, [recipient, recipient], activity, {
              fanout: role === "fanout" ? "force" : "skip",
            });
          const settled = rejected
            ? rejects(sending, (error: unknown) => error === failure)
            : sending;
          await prepared;
          strictEqual(messages.length, 0);
          deepStrictEqual(preparation(events), {
            type: "prepared",
            preparedFor: role === "fanout" ? "fanout" : "delivery",
            destinationCount: 1,
          });
          release();
          await settled;
          strictEqual(messages.length, 1);
          strictEqual(messages[0].type, role);
          strictEqual(events.length, 2);
          ok(!("observation" in messages[0]));
        },
      );
    }
  }
});

test("outbound preparation finishes before immediate sends settle without reporting later failures twice", async (t) => {
  for (const status of [202, 503]) {
    await t.step(`HTTP ${status}`, async () => {
      let fetched!: () => void;
      const fetching = new Promise<void>((resolve) => {
        fetched = resolve;
      });
      let releaseResponse!: () => void;
      const responseGate = new Promise<void>((resolve) => {
        releaseResponse = resolve;
      });
      let ready!: () => void;
      const prepared = new Promise<void>((resolve) => {
        ready = resolve;
      });
      let releaseObserver!: () => void;
      const observerGate = new Promise<void>((resolve) => {
        releaseObserver = resolve;
      });
      const events: OutboundBroadcastEvent[] = [];
      const deliveries: OutboundDeliveryEvent[] = [];
      const [tracerProvider, spanExporter] = createTestTracerProvider();
      let sendEnded!: () => void;
      const concreteSendEnded = new Promise<void>((resolve) => {
        sendEnded = resolve;
      });
      const exportSpans = spanExporter.export.bind(spanExporter);
      spanExporter.export = (spans, callback) => {
        exportSpans(spans, callback);
        if (spans.some((span) => span.name === "activitypub.send_activity")) {
          sendEnded();
        }
      };
      fetchMock.mockGlobal().post(
        "https://receiver.example/inbox",
        async () => {
          fetched();
          await responseGate;
          return { status, body: "receiver response" };
        },
      );
      try {
        const federation = createFederation<void>({
          kv: new MemoryKvStore(),
          allowPrivateAddress: true,
          tracerProvider,
        });
        federation.setOutboundObservers({
          onDelivery(_ctx, event) {
            deliveries.push(event);
          },
          async onBroadcast(_ctx, event) {
            events.push(event);
            if (event.stage === "preparation-finished") {
              ready();
              await observerGate;
            }
          },
        });
        let settled = false;
        const sending = federation.createContext(
          new URL("https://example.com"),
          undefined,
        )
          .sendActivity(sender, recipient, activity, { immediate: true })
          .finally(() => {
            settled = true;
          });
        const result = status === 202
          ? sending
          : rejects(sending, (error: unknown) => {
            return error instanceof Error && "statusCode" in error &&
              error.statusCode === status;
          });
        await Promise.all([prepared, fetching]);
        strictEqual(settled, false);
        deepStrictEqual(preparation(events), {
          type: "prepared",
          preparedFor: "delivery",
          destinationCount: 1,
        });
        releaseResponse();
        // Wait for the actual concrete send to finish while the preparation
        // observer remains blocked, rather than assuming a timer is long enough.
        await concreteSendEnded;
        const span = spanExporter.getSpan("activitypub.send_activity");
        ok(span);
        if (status === 503) strictEqual(span.status.code, SpanStatusCode.ERROR);
        // Only now yield a turn so an unhandled rejection would be detected
        // before releasing the observer and joining the send promises.
        await new Promise((resolve) => setTimeout(resolve, 0));
        strictEqual(settled, false);
        releaseObserver();
        await result;
        deepStrictEqual(deliveries.map((event) => event.stage), [
          "planned",
          "handoff",
        ]);
        const handoff = deliveries[1];
        ok(handoff.stage === "handoff");
        deepStrictEqual(handoff.result, { type: "direct" });
        strictEqual(events.length, 2);
      } finally {
        releaseResponse();
        releaseObserver();
        fetchMock.hardReset();
        await tracerProvider.shutdown();
      }
    });
  }
});

test("outbound preparation preserves earlier handoffs when later destination setup fails", async (t) => {
  for (const immediate of [true, false]) {
    await t.step(
      immediate
        ? "immediate handoff survives"
        : "queued messages are not handed off yet",
      async () => {
        const events: OutboundBroadcastEvent[] = [];
        const deliveries: OutboundDeliveryEvent[] = [];
        const messages: Message[] = [];
        const firstInbox = "https://receiver.example/first-inbox";
        const broken = recipient.clone({
          inbox: new URL("https://receiver.example/second-inbox"),
        });
        // Fault injection: planning can retain this value, but collection-sync
        // header construction cannot interpret it as a URL.
        Object.defineProperty(broken, "id", {
          value: { href: "invalid actor URL" },
        });
        let firstFetched!: () => void;
        const fetching = new Promise<void>((resolve) => {
          firstFetched = resolve;
        });
        fetchMock.mockGlobal().post(firstInbox, () => {
          firstFetched();
          return new Response(null, { status: 202 });
        });
        try {
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
            ...(immediate ? {} : { queue: { outbox: queue } }),
          });
          federation.setActorDispatcher(
            "/users/{identifier}",
            () => new Person({}),
          )
            .setKeyPairsDispatcher(
              () => [{
                privateKey: rsaPrivateKey2,
                publicKey: rsaPublicKey2.publicKey!,
              }],
            );
          federation.setFollowersDispatcher(
            "/users/{identifier}/followers",
            () => ({
              items: [recipient.clone({ inbox: new URL(firstInbox) }), broken],
            }),
          );
          federation.setOutboundObservers({
            onDelivery(_ctx, event) {
              deliveries.push(event);
            },
            onBroadcast(_ctx, event) {
              events.push(event);
            },
          });
          let originalError: unknown;
          await rejects(
            federation.createContext(new URL("https://example.com"), undefined)
              .sendActivity({ identifier: "alice" }, "followers", activity, {
                immediate,
                syncCollection: true,
              }),
            (error: unknown) => {
              originalError = error;
              return error instanceof TypeError;
            },
          );
          deepStrictEqual(preparation(events), {
            type: "failed",
            failure: {
              kind: "local",
              phase: "request-preparation",
              error: originalError,
            },
            planning: "complete",
            plannedDestinationCount: 2,
          });
          strictEqual(messages.length, 0);
          if (immediate) {
            // Prove the earlier send still reaches fetch after producer failure.
            await fetching;
          }
          const planned = deliveries.filter((event) =>
            event.stage === "planned"
          );
          strictEqual(planned.length, 2);
          const first = deliveries.filter((event) =>
            event.destinationInbox === firstInbox
          );
          deepStrictEqual(
            first.map((event) => event.stage),
            immediate ? ["planned", "handoff"] : ["planned"],
          );
          if (immediate) {
            const handoff = first[1];
            ok(handoff.stage === "handoff");
            deepStrictEqual(handoff.result, { type: "direct" });
          }
          const failed = deliveries.find((event) =>
            event.stage === "preparation-failed"
          );
          ok(failed?.stage === "preparation-failed");
          strictEqual(
            failed.destinationInbox,
            "https://receiver.example/second-inbox",
          );
          strictEqual(failed.failure.error, originalError);
          strictEqual(
            deliveries.filter((event) => event.stage === "handoff").length,
            immediate ? 1 : 0,
          );
          strictEqual(events.length, 2);
        } finally {
          fetchMock.hardReset();
        }
      },
    );
  }
});

test("outbox-context observers await starts and preserve context, registration, and failures", async () => {
  const federation = createFederation<{ label: string }>(options);
  const failure = Symbol("sender resolution failed");
  let resolutions = 0;
  federation.setActorDispatcher("/users/{identifier}", () => new Person({}))
    .mapHandle(() => {
      resolutions++;
      throw failure;
    });
  const base = federation.createContext(new URL("https://example.com"), {
    label: "app",
  });
  ok(base instanceof ContextImpl);
  const ctx = base.toOutboxContext(
    "alice",
    {},
    activity.id!.href,
    Create.typeId.href,
  );
  let entered!: () => void;
  const entry = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const events: OutboundBroadcastEvent[] = [];
  const contexts: unknown[] = [];
  let replacementCalls = 0;
  federation.setOutboundObservers({
    async onBroadcast(context, event) {
      contexts.push(context);
      events.push(event);
      if (event.stage === "started") {
        entered();
        await gate;
      }
      throw new Error("recorder failed");
    },
  });
  const sending = rejects(
    ctx.sendActivity({ username: "alice" }, [], activity),
    (error: unknown) => error === failure,
  );
  await entry;
  strictEqual(resolutions, 0);
  strictEqual(ctx.hasDeliveredActivity(), false);
  federation.setOutboundObservers({
    onBroadcast() {
      replacementCalls++;
    },
  });
  release();
  await sending;
  strictEqual(resolutions, 1);
  strictEqual(replacementCalls, 0);
  strictEqual(contexts.length, 2);
  for (const context of contexts) strictEqual(context, ctx);
  strictEqual(ctx.data.label, "app");
  deepStrictEqual(preparation(events), {
    type: "failed",
    failure: { kind: "local", phase: "sender-resolution", error: failure },
    planning: "not-started",
    plannedDestinationCount: 0,
  });
  strictEqual(ctx.hasDeliveredActivity(), false);
  federation.setOutboundObservers({});
  await rejects(
    ctx.sendActivity({ username: "alice" }, [], activity),
    (error: unknown) => error === failure,
  );
  strictEqual(resolutions, 2);
  strictEqual(events.length, 2);
  strictEqual(ctx.hasDeliveredActivity(), false);
});

test("outbox-context observers preserve empty sends without extra loading", async () => {
  let loads = 0;
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    documentLoaderFactory: () => () => {
      loads++;
      throw new Error("unexpected lookup");
    },
    contextLoaderFactory: () => () => {
      loads++;
      throw new Error("unexpected lookup");
    },
  });
  const base = federation.createContext(
    new URL("https://example.com"),
    undefined,
  );
  ok(base instanceof ContextImpl);
  const ctx = base.toOutboxContext(
    "alice",
    {},
    activity.id!.href,
    Create.typeId.href,
  );
  const events: OutboundBroadcastEvent[] = [];
  federation.setOutboundObservers({
    onBroadcast(_ctx, event) {
      events.push(event);
    },
  });
  await ctx.sendActivity(sender, [], activity);
  deepStrictEqual(preparation(events), {
    type: "skipped",
    reason: "no-destinations",
  });
  strictEqual(ctx.hasDeliveredActivity(), false);
  federation.setOutboundObservers({});
  await ctx.sendActivity(sender, [], activity);
  strictEqual(ctx.hasDeliveredActivity(), false);
  strictEqual(events.length, 2);
  strictEqual(loads, 0);
});

test("outbox-context observers report queue readiness before acceptance and preserve delivery state", async (t) => {
  for (const role of ["outbox", "fanout"] as const) {
    for (const rejected of [false, true]) {
      await t.step(
        `${role}: ${rejected ? "rejected" : "accepted"}`,
        async () => {
          const failure = Symbol("enqueue failed");
          const events: OutboundBroadcastEvent[] = [];
          const messages: Message[] = [];
          const checkpoints: {
            context: unknown;
            delivered: boolean;
            enqueued: number;
          }[] = [];
          const queue: MessageQueue = {
            enqueue(message) {
              messages.push(message);
              return rejected ? Promise.reject(failure) : Promise.resolve();
            },
            listen: () => Promise.resolve(),
          };
          const federation = createFederation<void>({
            ...options,
            kv: new MemoryKvStore(),
            manuallyStartQueue: true,
            queue: { [role]: queue },
          });
          const base = federation.createContext(
            new URL("https://example.com"),
            undefined,
          );
          ok(base instanceof ContextImpl);
          const ctx = base.toOutboxContext(
            "alice",
            {},
            activity.id!.href,
            Create.typeId.href,
          );
          const clone = ctx.clone(undefined);
          federation.setOutboundObservers({
            onBroadcast(context, event) {
              events.push(event);
              checkpoints.push({
                context,
                delivered: ctx.hasDeliveredActivity(),
                enqueued: messages.length,
              });
              // Callback failure must not change acceptance or delivery state.
              throw new Error("recorder failed");
            },
          });
          const sending = ctx.sendActivity(
            sender,
            [recipient, recipient],
            activity,
            {
              fanout: role === "fanout" ? "force" : "skip",
            },
          );
          if (rejected) {
            await rejects(sending, (error: unknown) => error === failure);
          } else await sending;
          deepStrictEqual(preparation(events), {
            type: "prepared",
            preparedFor: role === "fanout" ? "fanout" : "delivery",
            destinationCount: 1,
          });
          strictEqual(checkpoints.length, 2);
          for (const checkpoint of checkpoints) {
            strictEqual(checkpoint.context, ctx);
            strictEqual(checkpoint.delivered, false);
            strictEqual(checkpoint.enqueued, 0);
          }
          strictEqual(messages.length, 1);
          strictEqual(messages[0].type, role);
          strictEqual(ctx.hasDeliveredActivity(), !rejected);
          strictEqual(clone.hasDeliveredActivity(), !rejected);
          // Clearing observers keeps successful sends and the shared state working.
          if (!rejected) {
            federation.setOutboundObservers({});
            await ctx.sendActivity(sender, recipient, activity, {
              fanout: role === "fanout" ? "force" : "skip",
            });
            await ctx.sendActivity(sender, [], activity);
            strictEqual(messages.length, 2);
            strictEqual(events.length, 2);
            strictEqual(ctx.hasDeliveredActivity(), true);
            strictEqual(clone.hasDeliveredActivity(), true);
          }
        },
      );
    }
  }
});

test("outbox-context observers report immediate readiness before transport settles", async (t) => {
  for (const status of [202, 503]) {
    await t.step(`HTTP ${status}`, async () => {
      let fetched!: () => void;
      const fetching = new Promise<void>((resolve) => {
        fetched = resolve;
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready!: () => void;
      const prepared = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const events: OutboundBroadcastEvent[] = [];
      const contexts: unknown[] = [];
      const [tracerProvider, spanExporter] = createTestTracerProvider();
      fetchMock.mockGlobal().post(
        "https://receiver.example/inbox",
        async () => {
          fetched();
          await gate;
          return new Response(null, { status });
        },
      );
      try {
        const federation = createFederation<void>({
          kv: new MemoryKvStore(),
          allowPrivateAddress: true,
          tracerProvider,
        });
        const base = federation.createContext(
          new URL("https://example.com"),
          undefined,
        );
        ok(base instanceof ContextImpl);
        const ctx = base.toOutboxContext(
          "alice",
          {},
          activity.id!.href,
          Create.typeId.href,
        );
        const clone = ctx.clone(undefined);
        federation.setOutboundObservers({
          onBroadcast(context, event) {
            contexts.push(context);
            events.push(event);
            if (event.stage === "preparation-finished") ready();
          },
        });
        let settled = false;
        const sending = ctx.sendActivity(sender, recipient, activity, {
          immediate: true,
        })
          .finally(() => {
            settled = true;
          });
        const result = status === 202
          ? sending
          : rejects(sending, (error: unknown) => {
            return error instanceof Error && "statusCode" in error &&
              error.statusCode === status;
          });
        await Promise.all([fetching, prepared]);
        strictEqual(settled, false);
        strictEqual(ctx.hasDeliveredActivity(), false);
        deepStrictEqual(preparation(events), {
          type: "prepared",
          preparedFor: "delivery",
          destinationCount: 1,
        });
        release();
        await result;
        strictEqual(events.length, 2);
        for (const context of contexts) strictEqual(context, ctx);
        strictEqual(ctx.hasDeliveredActivity(), status === 202);
        strictEqual(clone.hasDeliveredActivity(), status === 202);
        const spans = spanExporter.getSpans("activitypub.outbox");
        strictEqual(spans.length, 1);
        strictEqual(
          spans[0].attributes["activitypub.activity.id"],
          activity.id!.href,
        );
        if (status === 503) {
          strictEqual(spans[0].status.code, SpanStatusCode.ERROR);
        }
      } finally {
        release();
        fetchMock.hardReset();
        await tracerProvider.shutdown();
      }
    });
  }
});

// Keep extension fields and signature-shaped data opaque; forwarding observes
// their existing shape checks, not authentication or a vocabulary round trip.
const forwardingPayload = {
  "@context": ["https://www.w3.org/ns/activitystreams", {
    extension: "https://example.com/extension",
  }],
  type: "Create",
  id: "https://sender.example/create",
  actor: "https://sender.example/actor",
  extension: { values: ["original", "payload"] },
  signature: {
    type: "RsaSignature2017",
    creator: "https://sender.example/key",
    signatureValue: "opaque signature",
  },
};

function forwardingContext<TContextData>(
  federation: Federation<TContextData>,
  kind: "inbox" | "outbox",
  payload: unknown,
  data: TContextData,
) {
  const base = federation.createContext(new URL("https://example.com"), data);
  ok(base instanceof ContextImpl);
  return kind === "inbox"
    ? base.toInboxContext(
      null,
      payload,
      forwardingPayload.id,
      Create.typeId.href,
    )
    : base.toOutboxContext(
      "alice",
      payload,
      forwardingPayload.id,
      Create.typeId.href,
    );
}

test("forwarding observers distinguish skips from preparation failures without extra loading", async (t) => {
  for (const kind of ["inbox", "outbox"] as const) {
    for (const scenario of ["unsigned", "empty", "failed"] as const) {
      await t.step(`${kind}: ${scenario}`, async () => {
        let loads = 0;
        const failure = Symbol("resolution failed");
        const federation = createFederation<{ label: string }>({
          kv: new MemoryKvStore(),
          documentLoaderFactory: () => () => {
            loads++;
            throw new Error("extra lookup");
          },
          contextLoaderFactory: () => () => {
            loads++;
            throw new Error("extra lookup");
          },
        });
        federation.setActorDispatcher(
          "/users/{identifier}",
          () => new Person({}),
        )
          .mapHandle(() => {
            throw failure;
          });
        const { signature: _signature, ...unsigned } = forwardingPayload;
        const ctx = forwardingContext(
          federation,
          kind,
          scenario === "unsigned" ? unsigned : forwardingPayload,
          { label: "app" },
        );
        const events: OutboundBroadcastEvent[] = [];
        const contexts: unknown[] = [];
        federation.setOutboundObservers({
          onBroadcast(context, event) {
            contexts.push(context);
            events.push(event);
            throw new Error("recorder failed");
          },
        });
        const forward = () =>
          ctx.forwardActivity(
            scenario === "failed" ? { username: "alice" } : sender,
            scenario === "empty" ? [] : recipient,
            { skipIfUnsigned: true },
          );
        if (scenario === "failed") {
          await rejects(forward(), (error: unknown) => error === failure);
        } else await forward();
        deepStrictEqual(
          preparation(events),
          scenario === "failed"
            ? {
              type: "failed",
              failure: {
                kind: "local",
                phase: "sender-resolution",
                error: failure,
              },
              planning: "not-started",
              plannedDestinationCount: 0,
            }
            : {
              type: "skipped",
              reason: scenario === "unsigned" ? "unsigned" : "no-destinations",
            },
        );
        for (const event of events) strictEqual(event.operation, "forward");
        for (const context of contexts) strictEqual(context, ctx);
        strictEqual(ctx.data.label, "app");
        strictEqual(loads, 0);
        if (ctx instanceof OutboxContextImpl) {
          strictEqual(ctx.hasDeliveredActivity(), false);
        }
        federation.setOutboundObservers({});
        if (scenario === "failed") {
          await rejects(forward(), (error: unknown) => error === failure);
        } else await forward();
        strictEqual(events.length, 2);
        strictEqual(loads, 0);
      });
    }
  }
});

test("forwarding observers await readiness before enqueue while preserving raw payloads and errors", async (t) => {
  for (const batch of [false, true]) {
    for (const rejected of [false, true]) {
      await t.step(
        `${batch ? "batch" : "single"}: ${rejected ? "rejected" : "accepted"}`,
        async () => {
          const failure = Symbol("enqueue failure");
          const messages: Message[] = [];
          const queue: MessageQueue = {
            enqueue(message) {
              messages.push(message);
              return rejected ? Promise.reject(failure) : Promise.resolve();
            },
            ...(batch
              ? {
                enqueueMany(batch: readonly Message[]) {
                  messages.push(...batch);
                  return rejected ? Promise.reject(failure) : Promise.resolve();
                },
              }
              : {}),
            listen: () => Promise.resolve(),
          };
          const federation = createFederation<void>({
            ...options,
            kv: new MemoryKvStore(),
            queue: { outbox: queue },
            manuallyStartQueue: true,
            activityTransformers: [() => {
              throw new Error("forwarding must not transform");
            }],
          });
          const ctx = forwardingContext(
            federation,
            batch ? "outbox" : "inbox",
            forwardingPayload,
            undefined,
          );
          let ready!: () => void;
          const prepared = new Promise<void>((resolve) => {
            ready = resolve;
          });
          let release!: () => void;
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          const events: OutboundBroadcastEvent[] = [];
          federation.setOutboundObservers({
            async onBroadcast(_ctx, event) {
              events.push(event);
              if (event.stage === "preparation-finished") {
                ready();
                await gate;
              }
              throw new Error("recorder failed");
            },
          });
          const sending = ctx.forwardActivity(sender, [recipient, recipient], {
            skipIfUnsigned: true,
          });
          const result = rejected
            ? rejects(sending, (error: unknown) => error === failure)
            : sending;
          await prepared;
          strictEqual(messages.length, 0);
          if (ctx instanceof OutboxContextImpl) {
            strictEqual(ctx.hasDeliveredActivity(), false);
          }
          deepStrictEqual(preparation(events), {
            type: "prepared",
            preparedFor: "delivery",
            destinationCount: 1,
          });
          release();
          await result;
          strictEqual(events.length, 2);
          strictEqual(messages.length, 1);
          ok(messages[0].type === "outbox");
          strictEqual(messages[0].activity, forwardingPayload);
          ok(!("broadcastId" in messages[0]));
          for (const event of events) strictEqual(event.operation, "forward");
          if (ctx instanceof OutboxContextImpl) {
            strictEqual(ctx.hasDeliveredActivity(), !rejected);
          }
          federation.setOutboundObservers({});
          const unobserved = ctx.forwardActivity(sender, recipient, {
            skipIfUnsigned: true,
          });
          if (rejected) {
            await rejects(unobserved, (error: unknown) => error === failure);
          } else await unobserved;
          strictEqual(messages.length, 2);
          ok(messages[1].type === "outbox");
          strictEqual(messages[1].activity, forwardingPayload);
          strictEqual(events.length, 2);
        },
      );
    }
  }
});

test("forwarding observers retain readiness and registration through late immediate results", async (t) => {
  for (const status of [202, 503]) {
    await t.step(`HTTP ${status}`, async () => {
      let fetched!: () => void;
      const fetching = new Promise<void>((resolve) => {
        fetched = resolve;
      });
      let respond!: () => void;
      const responseGate = new Promise<void>((resolve) => {
        respond = resolve;
      });
      let ready!: () => void;
      const prepared = new Promise<void>((resolve) => {
        ready = resolve;
      });
      let release!: () => void;
      const observerGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const [tracerProvider, exporter] = createTestTracerProvider();
      let ended!: () => void;
      const concreteSendEnded = new Promise<void>((resolve) => {
        ended = resolve;
      });
      const exportSpans = exporter.export.bind(exporter);
      exporter.export = (spans, callback) => {
        exportSpans(spans, callback);
        if (spans.some((span) => span.name === "activitypub.send_activity")) {
          ended();
        }
      };
      let submitted: unknown;
      fetchMock.mockGlobal().post(
        "https://receiver.example/inbox",
        async (call) => {
          submitted = JSON.parse(String(call.options.body));
          fetched();
          await responseGate;
          return new Response(null, { status });
        },
      );
      try {
        const federation = createFederation<void>({
          kv: new MemoryKvStore(),
          allowPrivateAddress: true,
          tracerProvider,
        });
        const ctx = forwardingContext(
          federation,
          status === 202 ? "inbox" : "outbox",
          forwardingPayload,
          undefined,
        );
        const events: OutboundBroadcastEvent[] = [];
        const deliveries: OutboundDeliveryEvent[] = [];
        let replacements = 0;
        federation.setOutboundObservers({
          onDelivery(_ctx, event) {
            deliveries.push(event);
          },
          async onBroadcast(_ctx, event) {
            events.push(event);
            if (event.stage === "preparation-finished") {
              ready();
              await observerGate;
            }
          },
        });
        let settled = false;
        const sending = ctx.forwardActivity(sender, recipient, {
          immediate: true,
          skipIfUnsigned: true,
        })
          .finally(() => {
            settled = true;
          });
        const result = status === 202
          ? sending
          : rejects(sending, (error: unknown) => {
            return error instanceof Error && "statusCode" in error &&
              error.statusCode === status;
          });
        await Promise.all([prepared, fetching]);
        deepStrictEqual(submitted, forwardingPayload);
        strictEqual(settled, false);
        deepStrictEqual(preparation(events), {
          type: "prepared",
          preparedFor: "delivery",
          destinationCount: 1,
        });
        federation.setOutboundObservers({
          onBroadcast() {
            replacements++;
          },
        });
        respond();
        await concreteSendEnded;
        await new Promise((resolve) => setTimeout(resolve, 0));
        strictEqual(settled, false);
        release();
        await result;
        deepStrictEqual(deliveries.map((event) => event.stage), [
          "planned",
          "handoff",
        ]);
        const handoff = deliveries[1];
        ok(handoff.stage === "handoff");
        deepStrictEqual(handoff.result, { type: "direct" });
        strictEqual(events.length, 2);
        strictEqual(replacements, 0);
        for (const event of events) strictEqual(event.operation, "forward");
        if (ctx instanceof OutboxContextImpl) {
          strictEqual(ctx.hasDeliveredActivity(), false);
        }
        const spans = exporter.getSpans(
          status === 202 ? "activitypub.inbox" : "activitypub.outbox",
        );
        strictEqual(spans.length, 1);
        if (status === 503) {
          strictEqual(spans[0].status.code, SpanStatusCode.ERROR);
        }
      } finally {
        respond();
        release();
        fetchMock.hardReset();
        await tracerProvider.shutdown();
      }
    });
  }
});

test("outbound delivery observers snapshot registration and deduplicated destination facts", async () => {
  const events: OutboundDeliveryEvent[] = [];
  const contexts: unknown[] = [];
  const messages: Message[] = [];
  let replacements = 0;
  let mutationApplied: boolean | undefined;
  const registration: {
    onDelivery: NonNullable<OutboundObservers<void>["onDelivery"]>;
  } = {
    onDelivery(context, event) {
      contexts.push(context);
      events.push(event);
      if (event.stage === "planned") {
        mutationApplied = Reflect.set(event.actorIds, 0, "changed");
        federation.setOutboundObservers({
          onDelivery() {
            replacements++;
          },
        });
      }
    },
  };
  const builder = createFederationBuilder<void>();
  builder.setOutboundObservers(registration);
  // The caller's object and later builder changes cannot replace the snapshot.
  registration.onDelivery = () => {
    replacements++;
  };
  const federation = await builder.build({
    ...options,
    kv: new MemoryKvStore(),
    manuallyStartQueue: true,
    queue: {
      outbox: {
        enqueue(message) {
          messages.push(message);
          return Promise.resolve();
        },
        listen: () => Promise.resolve(),
      },
    },
  });
  builder.setOutboundObservers({});
  const ctx = federation.createContext(
    new URL("https://example.com"),
    undefined,
  );
  const shared = new URL("https://receiver.example/shared");
  const recipients = ["alice", "bob"].map((name) => ({
    id: new URL(`https://receiver.example/${name}`),
    inboxId: new URL(`https://receiver.example/${name}/inbox`),
    endpoints: { sharedInbox: shared },
  }));
  await ctx.sendActivity(sender, [...recipients, recipient], activity, {
    preferSharedInbox: true,
  });
  strictEqual(mutationApplied, false);
  strictEqual(replacements, 0);
  strictEqual(events.length, 4);
  for (const context of contexts) strictEqual(context, ctx);
  const planned = events.filter((event) => event.stage === "planned");
  strictEqual(planned.length, 2);
  const sharedPlan = planned.find((event) =>
    event.destinationInbox === shared.href
  );
  ok(sharedPlan?.stage === "planned");
  deepStrictEqual(
    sharedPlan.actorIds,
    recipients.map((recipient) => recipient.id.href),
  );
  strictEqual(sharedPlan.sharedInbox, true);
  strictEqual(sharedPlan.mode, "ordinary");
  notStrictEqual(planned[0].deliveryId, planned[1].deliveryId);
  strictEqual(planned[0].broadcast.id, planned[1].broadcast.id);
  for (const event of events) {
    ok(Object.isFrozen(event));
    ok(Object.isFrozen(event.broadcast));
    const plan = planned.find((plan) => plan.deliveryId === event.deliveryId);
    ok(plan);
    strictEqual(event.destinationInbox, plan.destinationInbox);
    if (event.stage === "handoff") {
      ok(Object.isFrozen(event.result));
      const result = event.result;
      ok(result.type === "enqueued");
      strictEqual(result.queue, "outbox");
      const message = messages.find((message) =>
        message.id === result.queueMessageId
      );
      ok(message?.type === "outbox");
      strictEqual(message.inbox, event.destinationInbox);
      ok(!message.actorIds?.includes("changed"));
    }
  }
});

test("outbound delivery observers report queue acceptance separately from producer readiness", async (t) => {
  for (const mode of ["single", "batch", "fanout", "forward"] as const) {
    for (const rejected of [false, true]) {
      await t.step(
        `${mode}: ${rejected ? "rejected" : "accepted"}`,
        async () => {
          const failure = Symbol("enqueue failed");
          const messages: Message[] = [];
          const queue: MessageQueue = {
            enqueue(message) {
              messages.push(message);
              const fails = rejected &&
                (mode !== "single" || messages.length === 1);
              return fails ? Promise.reject(failure) : Promise.resolve();
            },
            ...(mode === "batch" || mode === "forward"
              ? {
                enqueueMany(batch: readonly Message[]) {
                  messages.push(...batch);
                  return rejected ? Promise.reject(failure) : Promise.resolve();
                },
              }
              : {}),
            listen: () => Promise.resolve(),
          };
          const federation = createFederation<void>({
            ...options,
            kv: new MemoryKvStore(),
            manuallyStartQueue: true,
            queue: mode === "fanout" ? { fanout: queue } : { outbox: queue },
          });
          const deliveries: OutboundDeliveryEvent[] = [];
          const broadcasts: OutboundBroadcastEvent[] = [];
          federation.setOutboundObservers({
            onBroadcast(_ctx, event) {
              broadcasts.push(event);
            },
            onDelivery(_ctx, event) {
              deliveries.push(event);
              throw new Error("recorder failed");
            },
          });
          const targets = [
            recipient,
            recipient.clone({
              inbox: new URL("https://receiver.example/second"),
            }),
          ];
          const ctx = federation.createContext(
            new URL("https://example.com"),
            undefined,
          );
          ok(ctx instanceof ContextImpl);
          const sending = mode === "forward"
            ? ctx.toInboxContext(
              null,
              forwardingPayload,
              forwardingPayload.id,
              Create.typeId.href,
            )
              .forwardActivity(sender, targets, { skipIfUnsigned: true })
            : ctx.sendActivity(sender, targets, activity, {
              fanout: mode === "fanout" ? "force" : "skip",
            });
          if (rejected) {
            await rejects(sending, (error: unknown) => error === failure);
          } else await sending;
          deepStrictEqual(preparation(broadcasts), {
            type: "prepared",
            preparedFor: mode === "fanout" ? "fanout" : "delivery",
            destinationCount: 2,
          });
          const planned = deliveries.filter((event) =>
            event.stage === "planned"
          );
          const handoffs = deliveries.filter((event) =>
            event.stage === "handoff"
          );
          strictEqual(planned.length, 2);
          strictEqual(handoffs.length, 2);
          for (const event of handoffs) {
            ok(event.stage === "handoff");
            const fails = rejected &&
              (mode !== "single" ||
                event.destinationInbox === recipient.inboxId!.href);
            if (fails) {
              ok(event.result.type === "enqueue-failed");
              strictEqual(event.result.acceptance, "unknown");
              strictEqual(event.result.error, failure);
            } else {
              const result = event.result;
              ok(result.type === "enqueued");
              strictEqual(
                result.queue,
                mode === "fanout" ? "fanout" : "outbox",
              );
              ok(
                messages.some((message) =>
                  message.id === result.queueMessageId
                ),
              );
            }
            strictEqual(event.broadcast.id, broadcasts[0].broadcastId);
            strictEqual(
              event.deliveryId,
              planned.find((plan) =>
                plan.destinationInbox === event.destinationInbox
              )!.deliveryId,
            );
          }
        },
      );
    }
  }
});

test("outbound delivery observers retain accepted handoffs after bookkeeping failure", async () => {
  const failure = Symbol("metrics failed after acceptance");
  const events: OutboundDeliveryEvent[] = [];
  const federation = createFederation<void>({
    ...options,
    kv: new MemoryKvStore(),
    manuallyStartQueue: true,
    queue: {
      outbox: {
        enqueue() {
          Object.defineProperty(federation, "meterProvider", {
            get() {
              throw failure;
            },
          });
          return Promise.resolve();
        },
        listen: () => Promise.resolve(),
      },
    },
  });
  federation.setOutboundObservers({
    onDelivery(_ctx, event) {
      events.push(event);
    },
  });
  await rejects(
    federation.createContext(new URL("https://example.com"), undefined)
      .sendActivity(sender, recipient, activity),
    (error: unknown) => error === failure,
  );
  deepStrictEqual(events.map((event) => event.stage), ["planned", "handoff"]);
  const event = events[1];
  ok(event.stage === "handoff");
  ok(event.result.type === "enqueued");
});
