import { mockDocumentLoader, test } from "@fedify/fixture";
import { Create, Person } from "@fedify/vocab";
import { configure, reset } from "@logtape/logtape";
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
import { createFederation } from "./middleware.ts";
import type { OutboundBroadcastEvent, OutboundObservers } from "./mod.ts";
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
              strictEqual(event.stage, "started");
              strictEqual(event.operation, "send");
              ok(Object.isFrozen(event));
              events.push(event);
            },
          });
          await ctx.sendActivity(sender, [], activity);
          await ctx.sendActivity(sender, [], activity);
          strictEqual(events.length, 2);
          ok(events[0].broadcastId.length > 0);
          notStrictEqual(events[0].broadcastId, events[1].broadcastId);
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
    async onBroadcast() {
      calls.push("original");
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
    onBroadcast() {
      calls.push("replacement");
    },
  });
  release();
  await pending;
  await rejects(
    ctx.sendActivity({ username: "alice" }, [], activity),
    (error: unknown) => error === failure,
  );
  deepStrictEqual(calls, ["original", "replacement"]);
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
    strictEqual(calls, 2);
    strictEqual(logCalls, 2);
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
  deepStrictEqual(calls, ["first only", "original", "new builder"]);
  second.setOutboundObservers({});
  await second.createContext(new URL("https://example.com"), undefined)
    .sendActivity(sender, [], activity);
  strictEqual(calls.length, 3);
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
      onBroadcast() {
        order.push("started");
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
    deepStrictEqual(order, ["started", "fetch"]);
  } finally {
    fetchMock.hardReset();
  }
});
