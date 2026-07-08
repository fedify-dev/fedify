import {
  createTestMeterProvider,
  createTestTracerProvider,
  mockDocumentLoader,
  test,
} from "@fedify/fixture";
import { RouterError } from "@fedify/uri-template";
import * as vocab from "@fedify/vocab";
import {
  Create,
  getTypeId,
  lookupObject,
  Note,
  Offer,
  Person,
} from "@fedify/vocab";
import { FetchError, getDocumentLoader } from "@fedify/vocab-runtime";
import { configure, type LogRecord, reset } from "@logtape/logtape";
import { metrics, SpanStatusCode } from "@opentelemetry/api";
import {
  DataPointType,
  MeterProvider,
  MetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  assert,
  assertEquals,
  assertExists,
  assertFalse,
  assertInstanceOf,
  assertNotEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import fetchMock from "fetch-mock";
import serialize from "json-canon";
import { deepStrictEqual, ok, rejects, strictEqual } from "node:assert/strict";
import createFixture from "../../../fixture/src/fixtures/example.com/create.json" with {
  type: "json",
};
import personFixture from "../../../fixture/src/fixtures/example.com/person.json" with {
  type: "json",
};
import person2Fixture from "../../../fixture/src/fixtures/example.com/person2.json" with {
  type: "json",
};
import { signRequest, verifyRequest } from "../sig/http.ts";
import type { KeyCache } from "../sig/key.ts";
import {
  compactJsonLd,
  detachSignature,
  signJsonLd,
  verifyJsonLd,
} from "../sig/ld.ts";
import { doesActorOwnKey } from "../sig/owner.ts";
import { signObject, verifyObject } from "../sig/proof.ts";
import {
  ed25519Multikey,
  ed25519PrivateKey,
  ed25519PublicKey,
  rsaPrivateKey2,
  rsaPrivateKey3,
  rsaPublicKey2,
  rsaPublicKey3,
} from "../testing/keys.ts";
import { getAuthenticatedDocumentLoader } from "../utils/docloader.ts";
import { handleBenchmarkTrigger } from "./bench.ts";
import { CircuitBreaker } from "./circuit-breaker.ts";
import type { Context, GetActorOptions } from "./context.ts";
import { MemoryKvStore } from "./kv.ts";
import { recordInboxActivity } from "./metrics.ts";
import {
  ContextImpl,
  createFederation,
  FederationImpl,
  InboxContextImpl,
  KvSpecDeterminer,
} from "./middleware.ts";
import type {
  MessageQueue,
  MessageQueueEnqueueOptions,
  MessageQueueListenOptions,
} from "./mq.ts";
import type {
  InboxMessage,
  Message,
  OutboxMessage,
  TaskMessage,
} from "./queue.ts";
import TaskCodec from "./tasks/codec.ts";
import {
  type Envelope,
  envelopeSchema,
  MockQueue,
  numberSchema,
} from "../testing/mod.ts";

const documentLoader = getDocumentLoader();

type IsEqual<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

let logtapeLock: Promise<void> = Promise.resolve();

async function withLogtapeLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = logtapeLock.then(fn, fn);
  logtapeLock = run.then(() => undefined, () => undefined);
  return await run;
}

class TestMetricReader extends MetricReader {
  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }

  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

test("createFederation()", async (t) => {
  const kv = new MemoryKvStore();

  await t.step("allowPrivateAddress", () => {
    assertThrows(() =>
      createFederation<number>({
        kv,
        contextLoaderFactory: () => mockDocumentLoader,
        allowPrivateAddress: true,
      }), TypeError);
    assertThrows(() =>
      createFederation<number>({
        kv,
        authenticatedDocumentLoaderFactory: () => mockDocumentLoader,
        allowPrivateAddress: true,
      }), TypeError);
  });

  await t.step("benchmarkMode applies cooperative benchmark defaults", () => {
    const federation = createFederation<number>({
      kv,
      benchmarkMode: true,
    });
    assertInstanceOf(federation, FederationImpl);
    assertEquals(federation.allowPrivateAddress, true);
    assertEquals(federation.signatureTimeWindow, false);
  });

  await t.step("benchmarkMode preserves explicit option overrides", () => {
    const federation = createFederation<number>({
      kv,
      benchmarkMode: true,
      allowPrivateAddress: false,
      signatureTimeWindow: { minutes: 10 },
    });
    assertInstanceOf(federation, FederationImpl);
    assertEquals(federation.allowPrivateAddress, false);
    assertEquals(federation.signatureTimeWindow, { minutes: 10 });
  });

  await t.step("benchmarkMode tolerates calendar time windows", () => {
    const federation = createFederation<number>({
      kv,
      benchmarkMode: true,
      signatureTimeWindow: { months: 1 },
    });
    assertInstanceOf(federation, FederationImpl);
    assertEquals(federation.signatureTimeWindow, { months: 1 });
  });

  await t.step("benchmarkMode leaves custom loader factories alone", () => {
    const federation = createFederation<number>({
      kv,
      benchmarkMode: true,
      documentLoaderFactory: () => mockDocumentLoader,
      contextLoaderFactory: () => mockDocumentLoader,
      authenticatedDocumentLoaderFactory: () => mockDocumentLoader,
    });
    assertInstanceOf(federation, FederationImpl);
    assertEquals(federation.allowPrivateAddress, false);
  });

  await t.step(
    "benchmarkMode keeps private-address default with auth loader only",
    () => {
      const federation = createFederation<number>({
        kv,
        benchmarkMode: true,
        authenticatedDocumentLoaderFactory: () => mockDocumentLoader,
      });
      assertInstanceOf(federation, FederationImpl);
      assertEquals(federation.allowPrivateAddress, true);
    },
  );

  await t.step("benchmarkMode rejects an explicit meterProvider", () => {
    const [meterProvider] = createTestMeterProvider();
    assertThrows(
      () =>
        createFederation<number>({
          kv,
          benchmarkMode: true,
          meterProvider,
        }),
      TypeError,
      "benchmarkMode requires Fedify to own the meterProvider",
    );
  });

  await t.step(
    "benchmarkMode warns that benchmark-only relaxations are on",
    async () => {
      await withLogtapeLock(async () => {
        const records: LogRecord[] = [];
        await reset();
        try {
          await configure({
            sinks: {
              test(record) {
                records.push(record);
              },
            },
            loggers: [
              {
                category: ["fedify", "federation", "benchmark"],
                lowestLevel: "warning",
                sinks: ["test"],
              },
            ],
          });
          createFederation<number>({ kv, benchmarkMode: true });
          assertEquals(records.length, 1);
          assertEquals(records[0].level, "warning");
          assertEquals(
            records[0].rawMessage,
            "Fedify benchmarkMode is enabled; private address checks " +
              "disabled (allowPrivateAddress=true); HTTP Signature time " +
              "window disabled (signatureTimeWindow=false). Benchmark " +
              "endpoints are active and must not be used in production.",
          );
          assertEquals(
            records[0].properties.relaxations,
            [
              {
                protection: "private_address_checks",
                effect: "disabled",
                effectiveValue: true,
              },
              {
                protection: "http_signature_time_window",
                effect: "disabled",
                effectiveValue: false,
                secureDefaultSeconds: 3600,
              },
            ],
          );
        } finally {
          await reset();
        }
      });
    },
  );

  await t.step("origin", () => {
    const f = createFederation<void>({ kv, origin: "http://example.com:8080" });
    assertInstanceOf(f, FederationImpl);
    assertEquals(f.origin, {
      handleHost: "example.com:8080",
      webOrigin: "http://example.com:8080",
    });

    assertThrows(
      () => createFederation<void>({ kv, origin: "example.com" }),
      TypeError,
    );
    assertThrows(
      () => createFederation<void>({ kv, origin: "ftp://example.com" }),
      TypeError,
    );
    assertThrows(
      () => createFederation<void>({ kv, origin: "https://example.com/foo" }),
      TypeError,
    );
    assertThrows(
      () => createFederation<void>({ kv, origin: "https://example.com/?foo" }),
      TypeError,
    );
    assertThrows(
      () => createFederation<void>({ kv, origin: "https://example.com/#foo" }),
      TypeError,
    );

    const f2 = createFederation<void>({
      kv,
      origin: {
        handleHost: "example.com:8080",
        webOrigin: "https://ap.example.com",
      },
    });
    assertInstanceOf(f2, FederationImpl);
    assertEquals(f2.origin, {
      handleHost: "example.com:8080",
      webOrigin: "https://ap.example.com",
    });

    assertThrows(
      () =>
        createFederation<void>({
          kv,
          origin: {
            handleHost: "https://example.com",
            webOrigin: "https://example.com",
          },
        }),
      TypeError,
    );
    assertThrows(
      () =>
        createFederation<void>({
          kv,
          origin: {
            handleHost: "example.com/",
            webOrigin: "https://example.com",
          },
        }),
      TypeError,
    );

    assertThrows(
      () =>
        createFederation<void>({
          kv,
          origin: { handleHost: "example.com", webOrigin: "example.com" },
        }),
      TypeError,
    );
    assertThrows(
      () =>
        createFederation<void>({
          kv,
          origin: { handleHost: "example.com", webOrigin: "ftp://example.com" },
        }),
      TypeError,
    );
    assertThrows(
      () =>
        createFederation<void>({
          kv,
          origin: {
            handleHost: "example.com",
            webOrigin: "https://example.com/foo",
          },
        }),
      TypeError,
    );
    assertThrows(
      () =>
        createFederation<void>({
          kv,
          origin: {
            handleHost: "example.com",
            webOrigin: "https://example.com/?foo",
          },
        }),
      TypeError,
    );
    assertThrows(
      () =>
        createFederation<void>({
          kv,
          origin: {
            handleHost: "example.com",
            webOrigin: "https://example.com/#foo",
          },
        }),
      TypeError,
    );
  });
});

test("benchmarkMode stats endpoint", async (t) => {
  await t.step("is absent when benchmarkMode is off", async () => {
    const federation = createFederation<void>({ kv: new MemoryKvStore() });
    const response = await federation.fetch(
      new Request("https://example.com/.well-known/fedify/bench/stats"),
      { contextData: undefined },
    );
    assertEquals(response.status, 404);
  });

  await t.step("returns a v1 in-process metrics snapshot", async () => {
    const queue: MessageQueue = {
      enqueue() {
        return Promise.resolve();
      },
      listen() {
        return Promise.resolve();
      },
      getDepth() {
        return Promise.resolve({ queued: 3, ready: 2, delayed: 1 });
      },
    };
    const federation = createFederation<void>({
      kv: new MemoryKvStore(),
      benchmarkMode: true,
      queue,
    });
    recordInboxActivity(
      (federation as FederationImpl<void>).meterProvider,
      "processed",
      vocab.Create.typeId.href,
    );

    const response = await federation.fetch(
      new Request("https://example.com/.well-known/fedify/bench/stats"),
      { contextData: undefined },
    );

    assertEquals(response.status, 200);
    assertEquals(response.headers.get("Content-Type"), "application/json");
    const body = await response.json() as {
      version: number;
      source: string;
      generatedAt: string;
      scopeMetrics: {
        metrics: {
          name: string;
          dataPointType: string;
          dataPoints: { attributes: Record<string, unknown>; value: unknown }[];
        }[];
      }[];
    };
    assertEquals(body.version, 1);
    assertEquals(body.source, "server");
    assertEquals(Number.isNaN(Date.parse(body.generatedAt)), false);
    const metrics = body.scopeMetrics.flatMap((scope) => scope.metrics);
    assertExists(
      metrics.find((metric) => metric.name === "activitypub.inbox.activity"),
    );
    const queueDepth = metrics.find((metric) =>
      metric.name === "fedify.queue.depth"
    );
    assertExists(queueDepth);
    assertEquals(queueDepth.dataPointType, "gauge");
    assertEquals(
      queueDepth.dataPoints.map((point) => ({
        state: point.attributes["fedify.queue.depth.state"],
        role: point.attributes["fedify.queue.role"],
        value: point.value,
      })).sort((a, b) => String(a.state).localeCompare(String(b.state))),
      [
        { state: "delayed", role: "shared", value: 1 },
        { state: "queued", role: "shared", value: 3 },
        { state: "ready", role: "shared", value: 2 },
      ],
    );
  });
});

test("createFederation() registers queue depth for regular metrics", async () => {
  const reader = new TestMetricReader();
  const meterProvider = new MeterProvider({ readers: [reader] });
  try {
    const queue: MessageQueue = {
      enqueue() {
        return Promise.resolve();
      },
      listen() {
        return Promise.resolve();
      },
      getDepth() {
        return Promise.resolve({ queued: 5, ready: 4, delayed: 3 });
      },
    };
    createFederation<void>({
      kv: new MemoryKvStore(),
      meterProvider,
      queue,
    });

    const result = await reader.collect();
    const queueDepth = result.resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .find((metric) => metric.descriptor.name === "fedify.queue.depth");

    assertExists(queueDepth);
    assertEquals(queueDepth.dataPointType, DataPointType.GAUGE);
    assertEquals(
      queueDepth.dataPoints.map((point) => ({
        state: point.attributes["fedify.queue.depth.state"],
        role: point.attributes["fedify.queue.role"],
        value: point.value,
      })).sort((a, b) => String(a.state).localeCompare(String(b.state))),
      [
        { state: "delayed", role: "shared", value: 3 },
        { state: "queued", role: "shared", value: 5 },
        { state: "ready", role: "shared", value: 4 },
      ],
    );
  } finally {
    await meterProvider.shutdown();
  }
});

test("createFederation() registers queue depth after global meterProvider is set", async () => {
  metrics.disable();
  const queue: MessageQueue = {
    enqueue() {
      return Promise.resolve();
    },
    listen() {
      return Promise.resolve();
    },
    getDepth() {
      return Promise.resolve({ queued: 8 });
    },
  };
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    queue,
  });
  const reader = new TestMetricReader();
  const meterProvider = new MeterProvider({ readers: [reader] });
  try {
    metrics.setGlobalMeterProvider(meterProvider);
    (federation as FederationImpl<void>).meterProvider;

    const result = await reader.collect();
    const queueDepth = result.resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .find((metric) => metric.descriptor.name === "fedify.queue.depth");

    assertExists(queueDepth);
    assertEquals(queueDepth.dataPointType, DataPointType.GAUGE);
    assertEquals(
      queueDepth.dataPoints.map((point) => ({
        state: point.attributes["fedify.queue.depth.state"],
        role: point.attributes["fedify.queue.role"],
        value: point.value,
      })),
      [
        { state: "queued", role: "shared", value: 8 },
      ],
    );
  } finally {
    metrics.disable();
    await meterProvider.shutdown();
  }
});

test("createFederation() distinguishes queue depth series per federation", async () => {
  const reader = new TestMetricReader();
  const meterProvider = new MeterProvider({ readers: [reader] });
  try {
    const createQueue = (queued: number): MessageQueue => ({
      enqueue() {
        return Promise.resolve();
      },
      listen() {
        return Promise.resolve();
      },
      getDepth() {
        return Promise.resolve({ queued });
      },
    });
    createFederation<void>({
      kv: new MemoryKvStore(),
      meterProvider,
      queue: createQueue(1),
    });
    createFederation<void>({
      kv: new MemoryKvStore(),
      meterProvider,
      queue: createQueue(2),
    });

    const result = await reader.collect();
    const queueDepth = result.resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .find((metric) => metric.descriptor.name === "fedify.queue.depth");

    assertExists(queueDepth);
    const queuedPoints = queueDepth.dataPoints.filter((point) =>
      point.attributes["fedify.queue.depth.state"] === "queued"
    );
    assertEquals(
      queuedPoints.map((point) => point.value).sort(),
      [1, 2],
    );
    const instanceIds = queuedPoints.map((point) =>
      point.attributes["fedify.federation.instance_id"]
    );
    assertEquals(
      instanceIds.every((id) => typeof id === "string"),
      true,
    );
    assertEquals(new Set(instanceIds).size, 2);
  } finally {
    await meterProvider.shutdown();
  }
});

test("benchmarkMode trigger endpoint", async (t) => {
  const createTriggerTarget = (
    options: { allowUnsafeTriggerRecipients?: boolean } = {},
  ) => {
    const messages: OutboxMessage[] = [];
    const queue: MessageQueue = {
      enqueue(message: OutboxMessage) {
        messages.push(message);
        return Promise.resolve();
      },
      listen() {
        return Promise.resolve();
      },
    };
    const federation = createFederation<void>({
      kv: new MemoryKvStore(),
      benchmarkMode: {
        triggerSinks: ["https://sink.example/inbox"],
        allowUnsafeTriggerRecipients: options.allowUnsafeTriggerRecipients,
      },
      contextLoaderFactory: () => mockDocumentLoader,
      queue: { outbox: queue },
    });
    federation
      .setActorDispatcher(
        "/users/{identifier}",
        (ctx, identifier) =>
          new vocab.Person({
            id: ctx.getActorUri(identifier),
            inbox: ctx.getInboxUri(identifier),
          }),
      )
      .setKeyPairsDispatcher(() => [
        { privateKey: rsaPrivateKey2, publicKey: rsaPublicKey2.publicKey! },
      ]);
    return { federation, messages };
  };

  const createTriggerBody = async (
    options: {
      recipientInbox?: string;
      recipients?: unknown[];
      sinks?: string[];
      allowUnsafeRecipients?: boolean;
    } = {},
  ) => ({
    sender: { identifier: "alice" },
    sinks: options.sinks,
    recipients: options.recipients ?? [
      {
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Service",
        id: "https://sink.example/actors/bob",
        inbox: options.recipientInbox ?? "https://sink.example/inbox",
      },
    ],
    activity: await new vocab.Create({
      id: new URL("https://example.com/activities/bench-1"),
      actor: new URL("https://example.com/users/alice"),
      object: new vocab.Note({
        id: new URL("https://example.com/notes/bench-1"),
        attribution: new URL("https://example.com/users/alice"),
        content: "benchmark",
      }),
    }).toJsonLd({ contextLoader: mockDocumentLoader }),
    allowUnsafeRecipients: options.allowUnsafeRecipients,
  });

  await t.step("is absent when benchmarkMode is off", async () => {
    const federation = createFederation<void>({ kv: new MemoryKvStore() });
    const response = await federation.fetch(
      new Request("https://example.com/.well-known/fedify/bench/trigger", {
        method: "POST",
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 404);
  });

  await t.step("rejects unreadable JSON request bodies", async () => {
    const request = {
      method: "POST",
      json() {
        throw new TypeError("body is unavailable");
      },
    } as unknown as Request;
    const response = await handleBenchmarkTrigger(
      request,
      {} as Context<void>,
    );
    assertEquals(response.status, 400);
    assertEquals(await response.json(), {
      error: "Invalid JSON request body.",
    });
  });

  await t.step("rejects empty recipient lists", async () => {
    const { federation, messages } = createTriggerTarget();
    const response = await federation.fetch(
      new Request("https://example.com/.well-known/fedify/bench/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(await createTriggerBody({ recipients: [] })),
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 400);
    assertEquals(await response.json(), {
      error:
        "No valid recipient inboxes found. The recipients list must not be empty.",
    });
    assertEquals(messages, []);
  });

  await t.step(
    "rejects recipients outside configured trigger sinks",
    async () => {
      const { federation, messages } = createTriggerTarget();
      const response = await federation.fetch(
        new Request("https://example.com/.well-known/fedify/bench/trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            await createTriggerBody({
              recipientInbox: "https://not-a-sink.example/inbox",
            }),
          ),
        }),
        { contextData: undefined },
      );
      assertEquals(response.status, 403);
      assertEquals(messages, []);
    },
  );

  await t.step(
    "does not trust request-provided trigger sinks or bypasses",
    async () => {
      const { federation, messages } = createTriggerTarget();
      const response = await federation.fetch(
        new Request("https://example.com/.well-known/fedify/bench/trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            await createTriggerBody({
              recipientInbox: "https://not-a-sink.example/inbox",
              sinks: ["https://not-a-sink.example/inbox"],
              allowUnsafeRecipients: true,
            }),
          ),
        }),
        { contextData: undefined },
      );
      assertEquals(response.status, 403);
      assertEquals(messages, []);
    },
  );

  await t.step(
    "allows unsafe recipients only with a server override",
    async () => {
      const { federation, messages } = createTriggerTarget({
        allowUnsafeTriggerRecipients: true,
      });
      const response = await federation.fetch(
        new Request("https://example.com/.well-known/fedify/bench/trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            await createTriggerBody({
              recipientInbox: "https://not-a-sink.example/inbox",
            }),
          ),
        }),
        { contextData: undefined },
      );
      assertEquals(response.status, 202);
      assertEquals(messages.length, 1);
      assertEquals(messages[0].inbox, "https://not-a-sink.example/inbox");
    },
  );

  await t.step("sends the activity to explicit sink recipients", async () => {
    const { federation, messages } = createTriggerTarget();
    const response = await federation.fetch(
      new Request("https://example.com/.well-known/fedify/bench/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(await createTriggerBody()),
      }),
      { contextData: undefined },
    );

    assertEquals(response.status, 202);
    const body = await response.json() as {
      version: number;
      activityId: string;
      queueCorrelationId: string;
      recipientCount: number;
      inboxCount: number;
    };
    assertEquals(body.version, 1);
    assertEquals(body.activityId, "https://example.com/activities/bench-1");
    assertEquals(
      body.queueCorrelationId,
      "https://example.com/activities/bench-1",
    );
    assertEquals(body.recipientCount, 1);
    assertEquals(body.inboxCount, 1);
    assertEquals(messages.length, 1);
    assertEquals(messages[0].type, "outbox");
    assertEquals(messages[0].activityId, body.queueCorrelationId);
    assertEquals(messages[0].inbox, "https://sink.example/inbox");
  });
});

test({
  name: "Federation.createContext()",
  permissions: { env: true, read: true },
  async fn(t) {
    const kv = new MemoryKvStore();

    fetchMock.spyGlobal();

    fetchMock.get("https://example.com/auth-check", async (cl) => {
      const v = await verifyRequest(
        cl.request!,
        {
          contextLoader: mockDocumentLoader,
          documentLoader: mockDocumentLoader,
          currentTime: Temporal.Now.instant(),
        },
      );
      return new Response(JSON.stringify(v != null), {
        headers: { "Content-Type": "application/json" },
      });
    });

    await t.step("Context", async () => {
      const rejectingLoader = (_url: string) =>
        Promise.reject(new Error("Not found"));

      const federation = createFederation<number>({
        kv,
        documentLoaderFactory: () => rejectingLoader,
        contextLoaderFactory: () => mockDocumentLoader,
      });
      let ctx = federation.createContext(
        new URL("https://example.com:1234/"),
        123,
      );
      assertEquals(ctx.data, 123);
      assertEquals(ctx.origin, "https://example.com:1234");
      assertEquals(ctx.canonicalOrigin, "https://example.com:1234");
      assertEquals(ctx.host, "example.com:1234");
      assertEquals(ctx.hostname, "example.com");
      assertStrictEquals(ctx.documentLoader, rejectingLoader);
      assertStrictEquals(ctx.contextLoader, mockDocumentLoader);
      assertStrictEquals(ctx.federation, federation);
      assertThrows(() => ctx.getNodeInfoUri(), RouterError);
      assertThrows(() => ctx.getActorUri("handle"), RouterError);
      assertThrows(
        () => ctx.getObjectUri(vocab.Note, { handle: "handle", id: "id" }),
        RouterError,
      );
      assertThrows(() => ctx.getInboxUri(), RouterError);
      assertThrows(() => ctx.getInboxUri("handle"), RouterError);
      assertThrows(() => ctx.getOutboxUri("handle"), RouterError);
      assertThrows(() => ctx.getFollowingUri("handle"), RouterError);
      assertThrows(() => ctx.getFollowersUri("handle"), RouterError);
      assertThrows(() => ctx.getLikedUri("handle"), RouterError);
      assertThrows(() => ctx.getFeaturedUri("handle"), RouterError);
      assertThrows(() => ctx.getFeaturedTagsUri("handle"), RouterError);
      assertThrows(
        () => ctx.getCollectionUri("test", { id: "123" }),
        RouterError,
      );
      assertEquals(ctx.parseUri(new URL("https://example.com/")), null);
      assertEquals(ctx.parseUri(null), null);
      assertEquals(await ctx.getActorKeyPairs("handle"), []);
      await assertRejects(
        () => ctx.getDocumentLoader({ identifier: "handle" }),
        Error,
        "No actor key pairs dispatcher registered",
      );
      await assertRejects(
        () =>
          ctx.sendActivity({ identifier: "handle" }, [], new vocab.Create({})),
        Error,
        "No actor key pairs dispatcher registered",
      );

      federation.setNodeInfoDispatcher("/nodeinfo/2.1", () => ({
        software: {
          name: "Example",
          version: "1.2.3",
        },
        protocols: ["activitypub"],
        usage: {
          users: {},
          localPosts: 123,
          localComments: 456,
        },
      }));
      ctx = federation.createContext(new URL("https://example.com/"), 123);
      assertEquals(
        ctx.getNodeInfoUri(),
        new URL("https://example.com/nodeinfo/2.1"),
      );

      assertThrows(
        () =>
          createFederation<number>({
            kv: new MemoryKvStore(),
          }).setActorDispatcher("/users/{identifier}", () => null)
            .mapActorAlias("/actor/{id}" as `/${string}`, "instance"),
        RouterError,
        "Path for actor alias must have no variables.",
      );

      federation
        .setActorDispatcher("/users/{identifier}", () => new vocab.Person({}))
        .mapActorAlias("/bot", "bot")
        .setKeyPairsDispatcher(() => [
          {
            privateKey: rsaPrivateKey2,
            publicKey: rsaPublicKey2.publicKey!,
          },
          {
            privateKey: ed25519PrivateKey,
            publicKey: ed25519PublicKey.publicKey!,
          },
        ])
        .mapHandle((_, username) => username === "HANDLE" ? "handle" : null);
      ctx = federation.createContext(new URL("https://example.com/"), 123);
      assertEquals(
        ctx.getActorUri("handle"),
        new URL("https://example.com/users/handle"),
      );
      assertEquals(
        ctx.getActorUri("bot"),
        new URL("https://example.com/bot"),
      );
      assertEquals(ctx.parseUri(new URL("https://example.com/")), null);
      assertEquals(
        ctx.parseUri(new URL("https://example.com/users/handle")),
        { type: "actor", identifier: "handle" },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com/bot")),
        { type: "actor", identifier: "bot" },
      );
      assertEquals(ctx.parseUri(null), null);
      assertEquals(
        await ctx.getActorKeyPairs("handle"),
        [
          {
            keyId: new URL("https://example.com/users/handle#main-key"),
            privateKey: rsaPrivateKey2,
            publicKey: rsaPublicKey2.publicKey!,
            cryptographicKey: rsaPublicKey2.clone({
              id: new URL("https://example.com/users/handle#main-key"),
              owner: new URL("https://example.com/users/handle"),
            }),
            multikey: new vocab.Multikey({
              id: new URL("https://example.com/users/handle#multikey-1"),
              controller: new URL("https://example.com/users/handle"),
              publicKey: rsaPublicKey2.publicKey!,
            }),
          },
          {
            keyId: new URL("https://example.com/users/handle#key-2"),
            privateKey: ed25519PrivateKey,
            publicKey: ed25519PublicKey.publicKey!,
            cryptographicKey: ed25519PublicKey.clone({
              id: new URL("https://example.com/users/handle#key-2"),
              owner: new URL("https://example.com/users/handle"),
            }),
            multikey: new vocab.Multikey({
              id: new URL("https://example.com/users/handle#multikey-2"),
              controller: new URL("https://example.com/users/handle"),
              publicKey: ed25519PublicKey.publicKey!,
            }),
          },
        ],
      );
      const loader = await ctx.getDocumentLoader({ identifier: "handle" });
      assertEquals(await loader("https://example.com/auth-check"), {
        contextUrl: null,
        documentUrl: "https://example.com/auth-check",
        document: true,
      });
      const loader2 = await ctx.getDocumentLoader({ username: "HANDLE" });
      assertEquals(await loader2("https://example.com/auth-check"), {
        contextUrl: null,
        documentUrl: "https://example.com/auth-check",
        document: true,
      });
      const loader3 = ctx.getDocumentLoader({
        keyId: new URL("https://example.com/key2"),
        privateKey: rsaPrivateKey2,
      });
      assertEquals(await loader3("https://example.com/auth-check"), {
        contextUrl: null,
        documentUrl: "https://example.com/auth-check",
        document: true,
      });
      assertEquals(await ctx.lookupObject("https://example.com/object"), null);
      await assertRejects(
        () =>
          ctx.sendActivity({ identifier: "handle" }, [], new vocab.Create({})),
        TypeError,
        "The activity to send must have at least one actor property.",
      );
      await ctx.sendActivity(
        { identifier: "handle" },
        [],
        new vocab.Create({
          actor: new URL("https://example.com/users/handle"),
        }),
      );

      fetchMock.get(
        "https://example.com/object",
        () =>
          new Response(
            JSON.stringify({
              "@context": "https://www.w3.org/ns/activitystreams",
              type: "Object",
              id: "https://example.com/object",
              name: "Fetched object",
            }),
            { headers: { "Content-Type": "application/activity+json" } },
          ),
      );

      const federation2 = createFederation<number>({
        kv,
        documentLoaderFactory: () => documentLoader,
        contextLoaderFactory: () => mockDocumentLoader,
      });
      const ctx2 = federation2.createContext(
        new URL("https://example.com/"),
        123,
      );
      assertEquals(
        await ctx2.lookupObject("https://example.com/object"),
        new vocab.Object({
          id: new URL("https://example.com/object"),
          name: "Fetched object",
        }),
      );

      federation.setObjectDispatcher(
        vocab.Note,
        "/users/{identifier}/notes/{id}",
        (_ctx, values) => {
          return new vocab.Note({
            summary: `Note ${values.id} by ${values.identifier}`,
          });
        },
      );
      ctx = federation.createContext(new URL("https://example.com/"), 123);
      assertEquals(
        ctx.getObjectUri(vocab.Note, { identifier: "john", id: "123" }),
        new URL("https://example.com/users/john/notes/123"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com/users/john/notes/123")),
        {
          type: "object",
          class: vocab.Note,
          typeId: new URL("https://www.w3.org/ns/activitystreams#Note"),
          values: { identifier: "john", id: "123" },
        },
      );
      assertEquals(ctx.parseUri(null), null);

      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");
      ctx = federation.createContext(new URL("https://example.com/"), 123);
      assertEquals(ctx.getInboxUri(), new URL("https://example.com/inbox"));
      assertEquals(
        ctx.getInboxUri("handle"),
        new URL("https://example.com/users/handle/inbox"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com/inbox")),
        { type: "inbox", identifier: undefined },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com/users/handle/inbox")),
        { type: "inbox", identifier: "handle" },
      );
      assertEquals(ctx.parseUri(null), null);

      federation.setOutboxDispatcher(
        "/users/{identifier}/outbox",
        () => ({ items: [] }),
      );
      ctx = federation.createContext(new URL("https://example.com/"), 123);
      assertEquals(
        ctx.getOutboxUri("handle"),
        new URL("https://example.com/users/handle/outbox"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com/users/handle/outbox")),
        { type: "outbox", identifier: "handle" },
      );
      assertEquals(ctx.parseUri(null), null);

      federation.setFollowingDispatcher(
        "/users/{identifier}/following",
        () => ({ items: [] }),
      );
      ctx = federation.createContext(new URL("https://example.com/"), 123);
      assertEquals(
        ctx.getFollowingUri("handle"),
        new URL("https://example.com/users/handle/following"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com/users/handle/following")),
        { type: "following", identifier: "handle" },
      );
      assertEquals(ctx.parseUri(null), null);

      federation.setFollowersDispatcher(
        "/users/{identifier}/followers",
        () => ({ items: [] }),
      );
      ctx = federation.createContext(new URL("https://example.com/"), 123);
      assertEquals(
        ctx.getFollowersUri("handle"),
        new URL("https://example.com/users/handle/followers"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com/users/handle/followers")),
        { type: "followers", identifier: "handle" },
      );
      assertEquals(ctx.parseUri(null), null);

      federation.setLikedDispatcher(
        "/users/{identifier}/liked",
        () => ({ items: [] }),
      );
      ctx = federation.createContext(new URL("https://example.com/"), 123);
      assertEquals(
        ctx.getLikedUri("handle"),
        new URL("https://example.com/users/handle/liked"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com/users/handle/liked")),
        { type: "liked", identifier: "handle" },
      );
      assertEquals(ctx.parseUri(null), null);

      federation.setFeaturedDispatcher(
        "/users/{identifier}/featured",
        () => ({ items: [] }),
      );
      ctx = federation.createContext(new URL("https://example.com/"), 123);
      assertEquals(
        ctx.getFeaturedUri("handle"),
        new URL("https://example.com/users/handle/featured"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com/users/handle/featured")),
        { type: "featured", identifier: "handle" },
      );
      assertEquals(ctx.parseUri(null), null);

      federation.setFeaturedTagsDispatcher(
        "/users/{identifier}/tags",
        () => ({ items: [] }),
      );
      ctx = federation.createContext(new URL("https://example.com/"), 123);
      assertEquals(
        ctx.getFeaturedTagsUri("handle"),
        new URL("https://example.com/users/handle/tags"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com/users/handle/tags")),
        { type: "featuredTags", identifier: "handle" },
      );
      assertEquals(ctx.parseUri(null), null);
    });

    await t.step("Context with origin", () => {
      const federation = createFederation<void>({
        kv,
        origin: "https://ap.example.com",
        documentLoaderFactory: () => mockDocumentLoader,
        contextLoaderFactory: () => mockDocumentLoader,
      });
      const ctx = federation.createContext(
        new URL("https://example.com:1234/"),
      );
      assertEquals(ctx.origin, "https://example.com:1234");
      assertEquals(ctx.canonicalOrigin, "https://ap.example.com");
      assertEquals(ctx.host, "example.com:1234");
      assertEquals(ctx.hostname, "example.com");

      federation.setNodeInfoDispatcher("/nodeinfo/2.1", () => ({
        software: {
          name: "Example",
          version: "1.2.3",
        },
        protocols: ["activitypub"],
        usage: {
          users: {},
          localPosts: 123,
          localComments: 456,
        },
      }));
      assertEquals(
        ctx.getNodeInfoUri(),
        new URL("https://ap.example.com/nodeinfo/2.1"),
      );

      federation.setActorDispatcher(
        "/users/{identifier}",
        () => new vocab.Person({}),
      );
      assertEquals(
        ctx.getActorUri("handle"),
        new URL("https://ap.example.com/users/handle"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://ap.example.com/users/handle")),
        { type: "actor", identifier: "handle" },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com:1234/users/handle")),
        { type: "actor", identifier: "handle" },
      );

      federation.setObjectDispatcher(
        vocab.Note,
        "/users/{identifier}/notes/{id}",
        (_ctx, values) => {
          return new vocab.Note({
            summary: `Note ${values.id} by ${values.identifier}`,
          });
        },
      );
      assertEquals(
        ctx.getObjectUri(vocab.Note, { identifier: "john", id: "123" }),
        new URL("https://ap.example.com/users/john/notes/123"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://ap.example.com/users/john/notes/123")),
        {
          type: "object",
          class: vocab.Note,
          typeId: new URL("https://www.w3.org/ns/activitystreams#Note"),
          values: { identifier: "john", id: "123" },
        },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com:1234/users/john/notes/123")),
        {
          type: "object",
          class: vocab.Note,
          typeId: new URL("https://www.w3.org/ns/activitystreams#Note"),
          values: { identifier: "john", id: "123" },
        },
      );

      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");
      assertEquals(ctx.getInboxUri(), new URL("https://ap.example.com/inbox"));
      assertEquals(
        ctx.getInboxUri("handle"),
        new URL("https://ap.example.com/users/handle/inbox"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://ap.example.com/inbox")),
        { type: "inbox", identifier: undefined },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com:1234/inbox")),
        { type: "inbox", identifier: undefined },
      );
      assertEquals(
        ctx.parseUri(new URL("https://ap.example.com/users/handle/inbox")),
        { type: "inbox", identifier: "handle" },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com:1234/users/handle/inbox")),
        { type: "inbox", identifier: "handle" },
      );

      federation.setOutboxDispatcher(
        "/users/{identifier}/outbox",
        () => ({ items: [] }),
      );
      assertEquals(
        ctx.getOutboxUri("handle"),
        new URL("https://ap.example.com/users/handle/outbox"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://ap.example.com/users/handle/outbox")),
        { type: "outbox", identifier: "handle" },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com:1234/users/handle/outbox")),
        { type: "outbox", identifier: "handle" },
      );

      federation.setFollowingDispatcher(
        "/users/{identifier}/following",
        () => ({ items: [] }),
      );
      assertEquals(
        ctx.getFollowingUri("handle"),
        new URL("https://ap.example.com/users/handle/following"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://ap.example.com/users/handle/following")),
        { type: "following", identifier: "handle" },
      );
      assertEquals(
        ctx.parseUri(
          new URL("https://example.com:1234/users/handle/following"),
        ),
        { type: "following", identifier: "handle" },
      );

      federation.setFollowersDispatcher(
        "/users/{identifier}/followers",
        () => ({ items: [] }),
      );
      assertEquals(
        ctx.getFollowersUri("handle"),
        new URL("https://ap.example.com/users/handle/followers"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://ap.example.com/users/handle/followers")),
        { type: "followers", identifier: "handle" },
      );
      assertEquals(
        ctx.parseUri(
          new URL("https://example.com:1234/users/handle/followers"),
        ),
        { type: "followers", identifier: "handle" },
      );

      federation.setLikedDispatcher(
        "/users/{identifier}/liked",
        () => ({ items: [] }),
      );
      assertEquals(
        ctx.getLikedUri("handle"),
        new URL("https://ap.example.com/users/handle/liked"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://ap.example.com/users/handle/liked")),
        { type: "liked", identifier: "handle" },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com:1234/users/handle/liked")),
        { type: "liked", identifier: "handle" },
      );

      federation.setFeaturedDispatcher(
        "/users/{identifier}/featured",
        () => ({ items: [] }),
      );
      assertEquals(
        ctx.getFeaturedUri("handle"),
        new URL("https://ap.example.com/users/handle/featured"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://ap.example.com/users/handle/featured")),
        { type: "featured", identifier: "handle" },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com:1234/users/handle/featured")),
        { type: "featured", identifier: "handle" },
      );

      federation.setFeaturedTagsDispatcher(
        "/users/{identifier}/tags",
        () => ({ items: [] }),
      );
      assertEquals(
        ctx.getFeaturedTagsUri("handle"),
        new URL("https://ap.example.com/users/handle/tags"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://ap.example.com/users/handle/tags")),
        { type: "featuredTags", identifier: "handle" },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com:1234/users/handle/tags")),
        { type: "featuredTags", identifier: "handle" },
      );
    });

    await t.step("Context.clone()", () => {
      const federation = createFederation<number>({
        kv,
      });
      const ctx = federation.createContext(
        new URL("https://example.com/"),
        123,
      );
      const clone = ctx.clone(456);
      assertStrictEquals(clone.canonicalOrigin, ctx.canonicalOrigin);
      assertStrictEquals(clone.origin, ctx.origin);
      assertEquals(clone.data, 456);
      assertEquals(clone.host, ctx.host);
      assertEquals(clone.hostname, ctx.hostname);
      assertStrictEquals(clone.documentLoader, ctx.documentLoader);
      assertStrictEquals(clone.contextLoader, ctx.contextLoader);
      assertStrictEquals(clone.federation, ctx.federation);
    });

    fetchMock.get("https://example.com/.well-known/nodeinfo", (cl) => {
      const headers = (cl.options.headers ?? {}) as
        | [string, string][]
        | Record<string, string>
        | Headers;
      assertEquals(
        new Headers(headers).get("User-Agent"),
        "CustomUserAgent/1.2.3",
      );
      return new Response(
        JSON.stringify({
          links: [
            {
              rel: "http://nodeinfo.diaspora.software/ns/schema/2.1",
              href: "https://example.com/nodeinfo/2.1",
            },
          ],
        }),
      );
    });

    fetchMock.get("https://example.com/nodeinfo/2.1", (cl) => {
      const headers = (cl.options.headers ?? {}) as
        | [string, string][]
        | Record<string, string>
        | Headers;
      assertEquals(
        new Headers(headers).get("User-Agent"),
        "CustomUserAgent/1.2.3",
      );
      return new Response(JSON.stringify({
        software: { name: "foo", version: "1.2.3" },
        protocols: ["activitypub", "diaspora"],
        usage: { users: {}, localPosts: 123, localComments: 456 },
      }));
    });

    await t.step("Context.lookupNodeInfo()", async () => {
      const federation = createFederation<number>({
        kv,
        userAgent: "CustomUserAgent/1.2.3",
      });
      const ctx = federation.createContext(
        new URL("https://example.com/"),
        123,
      );
      const nodeInfo = await ctx.lookupNodeInfo("https://example.com/");
      assertEquals(nodeInfo, {
        software: {
          name: "foo",
          version: "1.2.3",
        },
        protocols: ["activitypub", "diaspora"],
        usage: { users: {}, localPosts: 123, localComments: 456 },
      });

      const rawNodeInfo = await ctx.lookupNodeInfo("https://example.com/", {
        parse: "none",
      });
      assertEquals(rawNodeInfo, {
        software: { name: "foo", version: "1.2.3" },
        protocols: ["activitypub", "diaspora"],
        usage: { users: {}, localPosts: 123, localComments: 456 },
      });
    });

    await t.step("RequestContext", async () => {
      const federation = createFederation<number>({
        kv,
        documentLoaderFactory: () => mockDocumentLoader,
      });
      const req = new Request("https://example.com/", {
        headers: { "accept": "application/ld+json" },
      });
      const ctx = federation.createContext(req, 123);
      assertEquals(ctx.request, req);
      assertEquals(ctx.url, new URL("https://example.com/"));
      assertEquals(ctx.origin, "https://example.com");
      assertEquals(ctx.host, "example.com");
      assertEquals(ctx.hostname, "example.com");
      assertEquals(ctx.data, 123);
      await assertRejects(
        () => ctx.getActor("someone"),
        Error,
      );
      await assertRejects(
        () => ctx.getObject(vocab.Note, { handle: "someone", id: "123" }),
        Error,
      );
      assertEquals(await ctx.getSignedKey(), null);
      assertEquals(await ctx.getSignedKeyOwner(), null);
      // Multiple calls should return the same result:
      assertEquals(await ctx.getSignedKey(), null);
      assertEquals(await ctx.getSignedKeyOwner(), null);
      await assertRejects(
        () => ctx.getActor("someone"),
        Error,
        "No actor dispatcher registered",
      );

      const signedReq = await signRequest(
        new Request("https://example.com/", {
          headers: { "accept": "application/ld+json" },
        }),
        rsaPrivateKey2,
        rsaPublicKey2.id!,
      );
      const signedCtx = federation.createContext(signedReq, 456);
      assertEquals(signedCtx.request, signedReq);
      assertEquals(signedCtx.url, new URL("https://example.com/"));
      assertEquals(signedCtx.data, 456);
      assertEquals(await signedCtx.getSignedKey(), rsaPublicKey2);
      assertEquals(await signedCtx.getSignedKeyOwner(), null);
      // Multiple calls should return the same result:
      assertEquals(await signedCtx.getSignedKey(), rsaPublicKey2);
      assertEquals(await signedCtx.getSignedKeyOwner(), null);

      const signedReq2 = await signRequest(
        new Request("https://example.com/", {
          headers: { "accept": "application/ld+json" },
        }),
        rsaPrivateKey3,
        rsaPublicKey3.id!,
      );
      const signedCtx2 = federation.createContext(signedReq2, 456);
      assertEquals(signedCtx2.request, signedReq2);
      assertEquals(signedCtx2.url, new URL("https://example.com/"));
      assertEquals(signedCtx2.data, 456);
      assertEquals(await signedCtx2.getSignedKey(), rsaPublicKey3);
      const expectedOwner = await lookupObject(
        "https://example.com/person2",
        {
          documentLoader: mockDocumentLoader,
          contextLoader: mockDocumentLoader,
        },
      );
      assertEquals(await signedCtx2.getSignedKeyOwner(), expectedOwner);
      // Multiple calls should return the same result:
      assertEquals(await signedCtx2.getSignedKey(), rsaPublicKey3);
      assertEquals(await signedCtx2.getSignedKeyOwner(), expectedOwner);

      federation.setActorDispatcher(
        "/users/{identifier}",
        (ctx, identifier) =>
          identifier === "gone"
            ? new vocab.Tombstone({
              id: ctx.getActorUri(identifier),
              deleted: Temporal.Instant.from("2024-01-15T00:00:00Z"),
            })
            : new vocab.Person({ preferredUsername: identifier }),
      );
      const ctx2 = federation.createContext(req, 789);
      assertEquals(ctx2.request, req);
      assertEquals(ctx2.url, new URL("https://example.com/"));
      assertEquals(ctx2.data, 789);
      assertEquals(
        await ctx2.getActor("john"),
        new vocab.Person({ preferredUsername: "john" }),
      );
      const defaultActorPromise = ctx2.getActor("gone");
      type DefaultActorType = Assert<
        IsEqual<Awaited<typeof defaultActorPromise>, vocab.Actor | null>
      >;
      const defaultActorTypeCheck: DefaultActorType = true;
      void defaultActorTypeCheck;
      assertEquals(await defaultActorPromise, null);

      const tombstoneActorPromise = ctx2.getActor("gone", {
        tombstone: "passthrough",
      });
      type TombstoneActorType = Assert<
        IsEqual<
          Awaited<typeof tombstoneActorPromise>,
          vocab.Actor | vocab.Tombstone | null
        >
      >;
      const tombstoneActorTypeCheck: TombstoneActorType = true;
      void tombstoneActorTypeCheck;
      assertEquals(
        await tombstoneActorPromise,
        new vocab.Tombstone({
          id: new URL("https://example.com/users/gone"),
          deleted: Temporal.Instant.from("2024-01-15T00:00:00Z"),
        }),
      );

      const broadTombstoneOptions: GetActorOptions = {
        tombstone: "passthrough",
      };
      const broadTombstoneActorPromise = ctx2.getActor(
        "gone",
        broadTombstoneOptions,
      );
      type BroadTombstoneActorType = Assert<
        IsEqual<
          Awaited<typeof broadTombstoneActorPromise>,
          vocab.Actor | vocab.Tombstone | null
        >
      >;
      const broadTombstoneActorTypeCheck: BroadTombstoneActorType = true;
      void broadTombstoneActorTypeCheck;
      assertEquals(
        await broadTombstoneActorPromise,
        new vocab.Tombstone({
          id: new URL("https://example.com/users/gone"),
          deleted: Temporal.Instant.from("2024-01-15T00:00:00Z"),
        }),
      );

      federation.setObjectDispatcher(
        vocab.Note,
        "/users/{identifier}/notes/{id}",
        (_ctx, values) => {
          return new vocab.Note({
            summary: `Note ${values.id} by ${values.identifier}`,
          });
        },
      );
      const ctx3 = federation.createContext(req, 123);
      assertEquals(ctx3.request, req);
      assertEquals(ctx3.url, new URL("https://example.com/"));
      assertEquals(ctx3.data, 123);
      assertEquals(
        await ctx2.getObject(vocab.Note, { identifier: "john", id: "123" }),
        new vocab.Note({ summary: "Note 123 by john" }),
      );
    });

    await t.step(
      "RequestContext.getSignedKeyOwner() returns null on FetchError",
      async () => {
        // Regression test for <https://github.com/fedify-dev/fedify/issues/473>:
        // When the key owner actor fetch fails (e.g., GoToSocial returns 401 for
        // authorized fetch), getSignedKeyOwner() should return null instead of
        // throwing a FetchError.
        //
        // Custom document loader that simulates a server with authorized fetch
        // enabled (returns 401 for actor URL but allows key URL with fragment):
        const customDocumentLoader = async (url: string) => {
          if (url === "https://example.com/person2#key3") {
            // Key URL (with fragment): return actor document for sig verification
            return await mockDocumentLoader("https://example.com/person2");
          }
          if (url === "https://example.com/person2") {
            // Actor URL (without fragment): simulate 401 Unauthorized
            throw new FetchError(
              new URL(url),
              "HTTP 401: Unauthorized",
            );
          }
          return mockDocumentLoader(url);
        };

        const signedReq = await signRequest(
          new Request("https://example.com/", {
            headers: { accept: "application/activity+json" },
          }),
          rsaPrivateKey3,
          rsaPublicKey3.id!,
        );

        const fed = createFederation<void>({
          kv,
          documentLoaderFactory: () => customDocumentLoader,
          contextLoaderFactory: () => mockDocumentLoader,
        });
        const ctx = fed.createContext(signedReq, undefined);

        // Before fix: throws FetchError (causes 500 Internal Server Error)
        // After fix: returns null gracefully
        assertEquals(await ctx.getSignedKeyOwner(), null);
      },
    );

    await t.step("RequestContext.clone()", () => {
      const federation = createFederation<number>({
        kv,
      });
      const req = new Request("https://example.com/", {
        headers: { "accept": "application/ld+json" },
      });
      const ctx = federation.createContext(req, 123);
      const clone = ctx.clone(456);
      assertStrictEquals(clone.request, ctx.request);
      assertEquals(clone.url, ctx.url);
      assertEquals(clone.data, 456);
      assertEquals(clone.origin, ctx.origin);
      assertEquals(clone.host, ctx.host);
      assertEquals(clone.hostname, ctx.hostname);
      assertStrictEquals(clone.documentLoader, ctx.documentLoader);
      assertStrictEquals(clone.contextLoader, ctx.contextLoader);
      assertStrictEquals(clone.federation, ctx.federation);
    });

    fetchMock.hardReset();
  },
});

test("Federation.fetch()", async (t) => {
  fetchMock.spyGlobal();

  fetchMock.get("https://example.com/key2", {
    headers: { "Content-Type": "application/activity+json" },
    body: await rsaPublicKey2.toJsonLd({ contextLoader: mockDocumentLoader }),
  });

  fetchMock.get("begin:https://example.com/person", {
    headers: { "Content-Type": "application/activity+json" },
    body: personFixture,
  });

  const createTestContext = () => {
    const kv = new MemoryKvStore();
    const inbox: string[] = [];
    const dispatches: string[] = [];

    const federation = createFederation<void>({
      kv,
      documentLoaderFactory: () => mockDocumentLoader,
      authenticatedDocumentLoaderFactory(identity) {
        const docLoader = getAuthenticatedDocumentLoader(identity);
        return (url: string) => {
          const urlObj = new URL(url);
          if (urlObj.host === "example.com") return docLoader(url);
          return mockDocumentLoader(url);
        };
      },
    });

    federation.setActorDispatcher(
      "/users/{identifier}",
      (ctx, identifier) => {
        dispatches.push(identifier);
        if (identifier === "gone") {
          return new vocab.Tombstone({
            id: ctx.getActorUri(identifier),
            deleted: Temporal.Instant.from("2024-01-15T00:00:00Z"),
          });
        }
        return new vocab.Person({
          id: ctx.getActorUri(identifier),
          inbox: ctx.getInboxUri(identifier),
          preferredUsername: identifier,
        });
      },
    )
      .mapActorAlias("/bot", "bot")
      .setKeyPairsDispatcher(() => {
        return [
          { privateKey: rsaPrivateKey2, publicKey: rsaPublicKey2.publicKey! },
        ];
      });

    federation.setInboxDispatcher("/users/{identifier}/inbox", () => {
      return { items: [] };
    });

    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
      .on(vocab.Create, (_ctx, activity) => {
        inbox.push(activity.id!.toString());
        return;
      });

    return {
      federation,
      inbox,
      dispatches,
    };
  };

  await t.step("GET without accepts header", async () => {
    const { federation, dispatches } = createTestContext();

    // Should not call dispatcher on GET:
    const response = await federation.fetch(
      new Request("https://example.com/users/actor", {
        method: "GET",
      }),
      { contextData: undefined },
    );

    assertEquals(dispatches, []);
    assertEquals(response.status, 406);
  });

  await t.step("GET actor alias", async () => {
    const { federation, dispatches } = createTestContext();

    const response = await federation.fetch(
      new Request("https://example.com/bot", {
        method: "GET",
        headers: {
          "Accept": "application/activity+json",
        },
      }),
      { contextData: undefined },
    );

    assertEquals(dispatches, ["bot"]);
    assertEquals(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assertEquals(body.id, "https://example.com/bot");
    assertEquals(body.preferredUsername, "bot");
  });

  await t.step("WebFinger for actor alias", async () => {
    const { federation } = createTestContext();

    const response = await federation.fetch(
      new Request(
        "https://example.com/.well-known/webfinger?resource=acct:bot@example.com",
      ),
      { contextData: undefined },
    );

    assertEquals(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assertEquals(body.subject, "acct:bot@example.com");
    assertExists(body.links);
    assert(Array.isArray(body.links));
    const selfLink = (body.links as Record<string, unknown>[]).find((l) =>
      l.rel === "self"
    );
    assertExists(selfLink);
    assertEquals(selfLink.href, "https://example.com/bot");
    assertExists(body.aliases);
    assert((body.aliases as string[]).includes("https://example.com/bot"));
  });

  await t.step("POST with application/json", async () => {
    const { federation, inbox } = createTestContext();

    const request = await signRequest(
      new Request("https://example.com/users/json/inbox", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(createFixture),
      }),
      rsaPrivateKey2,
      rsaPublicKey2.id!,
    );

    const response = await federation.fetch(
      request,
      { contextData: undefined },
    );

    assertEquals(response.status, 202);
    assertEquals(
      inbox.length,
      1,
      "Expected one item in the inbox, json",
    );
    assertEquals(inbox[0], createFixture.id);
  });

  await t.step("GET with application/json", async () => {
    const { federation, dispatches } = createTestContext();

    // Should call dispatcher on GET:
    const response = await federation.fetch(
      new Request("https://example.com/users/json", {
        method: "GET",
        headers: {
          "Accept": "application/json",
        },
      }),
      { contextData: undefined },
    );

    assertEquals(dispatches, ["json"]);
    assertEquals(response.status, 200);
  });

  await t.step("POST with application/ld+json", async () => {
    const { federation, inbox } = createTestContext();

    const request = await signRequest(
      new Request("https://example.com/users/ld/inbox", {
        method: "POST",
        headers: {
          "Accept": "application/ld+json",
          "Content-Type": "application/activity+json",
        },
        body: JSON.stringify(createFixture),
      }),
      rsaPrivateKey2,
      rsaPublicKey2.id!,
    );

    const response = await federation.fetch(
      request,
      { contextData: undefined },
    );

    assertEquals(response.status, 202);
    assertEquals(inbox.length, 1, "Expected one inbox activity, ld+json");
    assertEquals(inbox[0], createFixture.id);
  });

  await t.step("GET with application/ld+json", async () => {
    const { federation, dispatches } = createTestContext();

    const request = new Request("https://example.com/users/ld", {
      method: "GET",
      headers: {
        "Accept": "application/ld+json",
      },
    });

    const response = await federation.fetch(request, {
      contextData: undefined,
    });

    assertEquals(dispatches, ["ld"]);
    assertEquals(response.status, 200);
  });

  await t.step("POST with application/activity+json", async () => {
    const { federation, inbox } = createTestContext();

    const request = await signRequest(
      new Request("https://example.com/users/activity/inbox", {
        method: "POST",
        headers: {
          "Accept": "application/activity+json",
          "Content-Type": "application/activity+json",
        },
        body: JSON.stringify(createFixture),
      }),
      rsaPrivateKey2,
      rsaPublicKey2.id!,
    );

    const response = await federation.fetch(
      request,
      { contextData: undefined },
    );

    assertEquals(response.status, 202);
    assertEquals(inbox.length, 1);
    assertEquals(inbox[0], createFixture.id);
  });

  await t.step("GET with application/activity+json", async () => {
    const { federation, dispatches } = createTestContext();

    const request = new Request("https://example.com/users/activity", {
      method: "GET",
      headers: {
        "Accept": "application/ld+json",
      },
    });

    const response = await federation.fetch(request, {
      contextData: undefined,
    });

    assertEquals(dispatches, ["activity"]);
    assertEquals(response.status, 200);
  });

  await t.step("GET tombstoned actor returns 410 Gone", async () => {
    const { federation, dispatches } = createTestContext();

    const response = await federation.fetch(
      new Request("https://example.com/users/gone", {
        method: "GET",
        headers: {
          "Accept": "application/activity+json",
        },
      }),
      { contextData: undefined },
    );

    assertEquals(dispatches, ["gone"]);
    assertEquals(response.status, 410);
    assertEquals(await response.json(), {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/data-integrity/v1",
        "https://gotosocial.org/ns",
      ],
      id: "https://example.com/users/gone",
      type: "Tombstone",
      deleted: "2024-01-15T00:00:00Z",
    });
  });

  await t.step("WebFinger for tombstoned actor returns 410 Gone", async () => {
    const { federation, dispatches } = createTestContext();

    const response = await federation.fetch(
      new Request(
        "https://example.com/.well-known/webfinger?resource=acct:gone@example.com",
      ),
      { contextData: undefined },
    );

    assertEquals(dispatches, ["gone"]);
    assertEquals(response.status, 410);
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
  });

  await t.step("POST to tombstoned inbox returns not found", async () => {
    const { federation, inbox } = createTestContext();

    const response = await federation.fetch(
      new Request("https://example.com/users/gone/inbox", {
        method: "POST",
        headers: { "accept": "application/ld+json" },
      }),
      { contextData: undefined },
    );

    assertEquals(inbox, []);
    assertEquals(response.status, 404);
  });

  await t.step(
    "empty identifier segment is Not Found, dispatcher not invoked",
    async () => {
      // Regression for the bug fixed by this change: a request whose
      // identifier segment is empty or missing (`/users/`, `/users//inbox`)
      // must be treated as Not Found instead of invoking the dispatcher
      // with an empty string, which would violate the `identifier: string`
      // callback contract.  `Federation.fetch()` routes against
      // `URL.pathname`, so this exercises the real HTTP path, not just
      // `Router.route()`.  See
      // https://github.com/fedify-dev/fedify/pull/758#discussion_r3252548632
      const { federation, dispatches } = createTestContext();

      const actorResponse = await federation.fetch(
        new Request("https://example.com/users/", {
          method: "GET",
          headers: { "Accept": "application/activity+json" },
        }),
        { contextData: undefined },
      );
      assertEquals(actorResponse.status, 404);

      const inboxResponse = await federation.fetch(
        new Request("https://example.com/users//inbox", {
          method: "POST",
          headers: { "accept": "application/ld+json" },
        }),
        { contextData: undefined },
      );
      assertEquals(inboxResponse.status, 404);

      // The actor dispatcher must never have seen an empty identifier.
      assertEquals(dispatches.includes(""), false);
    },
  );

  await t.step("onNotAcceptable with GET", async () => {
    const { federation } = createTestContext();

    let notAcceptableCalled = false;
    const response = await federation.fetch(
      new Request("https://example.com/users/html", {
        method: "GET",
        headers: { "Accept": "text/html" },
      }),
      {
        contextData: undefined,
        onNotAcceptable: () => {
          notAcceptableCalled = true;
          return new Response("handled by onNotAcceptable", { status: 200 });
        },
      },
    );

    assertEquals(notAcceptableCalled, true);
    assertEquals(response.status, 200);
    assertEquals(await response.text(), "handled by onNotAcceptable");
  });

  fetchMock.hardReset();
});

test("Federation.fetch() records HTTP server request metrics", async (t) => {
  const createTestContext = () => {
    const kv = new MemoryKvStore();
    const [meterProvider, recorder] = createTestMeterProvider();
    const federation = createFederation<void>({
      kv,
      meterProvider,
      documentLoaderFactory: () => mockDocumentLoader,
    });

    federation.setActorDispatcher(
      "/users/{identifier}",
      (ctx, identifier) => {
        if (identifier === "boom") {
          throw new Error("explosion in actor dispatcher");
        }
        return new vocab.Person({
          id: ctx.getActorUri(identifier),
          inbox: ctx.getInboxUri(identifier),
          preferredUsername: identifier,
        });
      },
    );

    federation.setNodeInfoDispatcher("/nodeinfo/2.1", () => ({
      software: { name: "example", version: "1.0.0" },
      protocols: ["activitypub"],
      usage: { users: {}, localPosts: 0, localComments: 0 },
    }));

    federation.setFollowersDispatcher(
      "/users/{identifier}/followers",
      () => ({ items: [] }),
    );

    federation.setCollectionDispatcher(
      "custom-collection",
      vocab.Object,
      "/users/{identifier}/custom/{id}",
      () => ({ items: [] }),
    );

    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");

    return { federation, recorder };
  };

  await t.step("records a successful actor request", async () => {
    const { federation, recorder } = createTestContext();
    const response = await federation.fetch(
      new Request("https://example.com/users/alice", {
        method: "GET",
        headers: { "Accept": "application/activity+json" },
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 200);

    const counts = recorder.getMeasurements("fedify.http.server.request.count");
    assertEquals(counts.length, 1);
    assertEquals(counts[0].type, "counter");
    assertEquals(counts[0].value, 1);
    assertEquals(counts[0].attributes["http.request.method"], "GET");
    assertEquals(counts[0].attributes["fedify.endpoint"], "actor");
    assertEquals(counts[0].attributes["http.response.status_code"], 200);
    assertEquals(
      counts[0].attributes["fedify.route.template"],
      "/users/{identifier}",
    );

    const durations = recorder.getMeasurements(
      "fedify.http.server.request.duration",
    );
    assertEquals(durations.length, 1);
    assertEquals(durations[0].type, "histogram");
    assert(durations[0].value >= 0);
    assertEquals(durations[0].attributes["fedify.endpoint"], "actor");
    assertEquals(durations[0].attributes["http.response.status_code"], 200);
    assertEquals(
      durations[0].attributes["fedify.route.template"],
      "/users/{identifier}",
    );
  });

  await t.step("records WebFinger requests", async () => {
    const { federation, recorder } = createTestContext();
    const response = await federation.fetch(
      new Request(
        "https://example.com/.well-known/webfinger?resource=acct:alice@example.com",
      ),
      { contextData: undefined },
    );
    assertEquals(response.status, 200);

    const counts = recorder.getMeasurements("fedify.http.server.request.count");
    assertEquals(counts.length, 1);
    assertEquals(counts[0].attributes["fedify.endpoint"], "webfinger");
    assertEquals(
      counts[0].attributes["fedify.route.template"],
      "/.well-known/webfinger",
    );
    assertEquals(counts[0].attributes["http.response.status_code"], 200);
  });

  await t.step("records NodeInfo JRD requests", async () => {
    const { federation, recorder } = createTestContext();
    const response = await federation.fetch(
      new Request("https://example.com/.well-known/nodeinfo"),
      { contextData: undefined },
    );
    assertEquals(response.status, 200);

    const counts = recorder.getMeasurements("fedify.http.server.request.count");
    assertEquals(counts.length, 1);
    assertEquals(counts[0].attributes["fedify.endpoint"], "nodeinfo");
    assertEquals(
      counts[0].attributes["fedify.route.template"],
      "/.well-known/nodeinfo",
    );
  });

  await t.step("records NodeInfo dispatcher requests", async () => {
    const { federation, recorder } = createTestContext();
    const response = await federation.fetch(
      new Request("https://example.com/nodeinfo/2.1"),
      { contextData: undefined },
    );
    assertEquals(response.status, 200);

    const counts = recorder.getMeasurements("fedify.http.server.request.count");
    assertEquals(counts.length, 1);
    assertEquals(counts[0].attributes["fedify.endpoint"], "nodeinfo");
    assertEquals(
      counts[0].attributes["fedify.route.template"],
      "/nodeinfo/2.1",
    );
  });

  await t.step("records 404 not_found for unmatched paths", async () => {
    const { federation, recorder } = createTestContext();
    const response = await federation.fetch(
      new Request("https://example.com/no/such/path"),
      { contextData: undefined },
    );
    assertEquals(response.status, 404);

    const counts = recorder.getMeasurements("fedify.http.server.request.count");
    assertEquals(counts.length, 1);
    assertEquals(counts[0].attributes["fedify.endpoint"], "not_found");
    assertEquals(counts[0].attributes["http.response.status_code"], 404);
    assertEquals(counts[0].attributes["fedify.route.template"], undefined);
  });

  await t.step(
    "records 406 not_acceptable when JSON-LD Accept missing",
    async () => {
      const { federation, recorder } = createTestContext();
      const response = await federation.fetch(
        new Request("https://example.com/users/alice", {
          method: "GET",
          headers: { "Accept": "text/html" },
        }),
        { contextData: undefined },
      );
      assertEquals(response.status, 406);

      const counts = recorder.getMeasurements(
        "fedify.http.server.request.count",
      );
      assertEquals(counts.length, 1);
      assertEquals(counts[0].attributes["fedify.endpoint"], "not_acceptable");
      assertEquals(counts[0].attributes["http.response.status_code"], 406);
      assertEquals(
        counts[0].attributes["fedify.route.template"],
        "/users/{identifier}",
      );
    },
  );

  await t.step(
    "records collection metrics for not_acceptable collection requests",
    async () => {
      const { federation, recorder } = createTestContext();
      const response = await federation.fetch(
        new Request("https://example.com/users/alice/followers", {
          method: "GET",
          headers: { "Accept": "text/html" },
        }),
        { contextData: undefined },
      );
      assertEquals(response.status, 406);

      const requests = recorder.getMeasurements(
        "activitypub.collection.request",
      );
      assertEquals(requests.length, 1);
      assertEquals(
        requests[0].attributes["activitypub.collection.kind"],
        "followers",
      );
      assertEquals(
        requests[0].attributes["activitypub.collection.page"],
        false,
      );
      assertEquals(
        requests[0].attributes["fedify.collection.dispatcher"],
        "built_in",
      );
      assertEquals(
        requests[0].attributes["activitypub.collection.result"],
        "not_acceptable",
      );
      assertEquals(
        requests[0].attributes["http.response.status_code"],
        406,
      );
    },
  );

  await t.step(
    "records thrown errors after classification with the matched endpoint",
    async () => {
      const { federation, recorder } = createTestContext();
      await assertRejects(
        () =>
          federation.fetch(
            new Request("https://example.com/users/boom", {
              method: "GET",
              headers: { "Accept": "application/activity+json" },
            }),
            { contextData: undefined },
          ),
        Error,
        "explosion",
      );

      const counts = recorder.getMeasurements(
        "fedify.http.server.request.count",
      );
      assertEquals(counts.length, 1);
      assertEquals(counts[0].attributes["fedify.endpoint"], "actor");
      assertEquals(
        counts[0].attributes["http.response.status_code"],
        undefined,
      );
      assertEquals(
        counts[0].attributes["fedify.route.template"],
        "/users/{identifier}",
      );

      const durations = recorder.getMeasurements(
        "fedify.http.server.request.duration",
      );
      assertEquals(durations.length, 1);
      assertEquals(durations[0].attributes["fedify.endpoint"], "actor");
    },
  );

  await t.step(
    "collapses user-defined collection dispatchers to endpoint=collection",
    async () => {
      const { federation, recorder } = createTestContext();
      const response = await federation.fetch(
        new Request("https://example.com/users/alice/custom/1", {
          method: "GET",
          headers: { "Accept": "application/activity+json" },
        }),
        { contextData: undefined },
      );
      assertEquals(response.status, 200);

      const counts = recorder.getMeasurements(
        "fedify.http.server.request.count",
      );
      assertEquals(counts.length, 1);
      assertEquals(counts[0].attributes["fedify.endpoint"], "collection");
      assertEquals(
        counts[0].attributes["fedify.route.template"],
        "/users/{identifier}/custom/{id}",
      );
    },
  );

  await t.step("records followers as endpoint=followers", async () => {
    const { federation, recorder } = createTestContext();
    const response = await federation.fetch(
      new Request("https://example.com/users/alice/followers", {
        method: "GET",
        headers: { "Accept": "application/activity+json" },
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 200);

    const counts = recorder.getMeasurements("fedify.http.server.request.count");
    assertEquals(counts.length, 1);
    assertEquals(counts[0].attributes["fedify.endpoint"], "followers");
    assertEquals(
      counts[0].attributes["fedify.route.template"],
      "/users/{identifier}/followers",
    );
  });

  await t.step("records sharedInbox as endpoint=shared_inbox", async () => {
    const kv = new MemoryKvStore();
    const [meterProvider, recorder] = createTestMeterProvider();
    const federation = createFederation<void>({
      kv,
      meterProvider,
      documentLoaderFactory: () => mockDocumentLoader,
    });
    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");

    const response = await federation.fetch(
      new Request("https://example.com/inbox", {
        method: "POST",
        headers: { "accept": "application/ld+json" },
      }),
      { contextData: undefined },
    );
    // Without an actor dispatcher signature verification fails—but the
    // routing classification has already happened, which is what we assert.
    assert(response.status >= 400);

    const counts = recorder.getMeasurements("fedify.http.server.request.count");
    assertEquals(counts.length, 1);
    assertEquals(counts[0].attributes["fedify.endpoint"], "shared_inbox");
    assertEquals(
      counts[0].attributes["fedify.route.template"],
      "/inbox",
    );
    assertEquals(counts[0].attributes["http.request.method"], "POST");
  });

  await t.step(
    "normalizes unknown HTTP methods to _OTHER for cardinality control",
    async () => {
      const { federation, recorder } = createTestContext();
      const response = await federation.fetch(
        new Request("https://example.com/users/alice", {
          method: "PROPFIND",
          headers: { "Accept": "application/activity+json" },
        }),
        { contextData: undefined },
      );
      // We only care about the metric attribute, not the response code here.
      assert(response.status >= 100);

      const counts = recorder.getMeasurements(
        "fedify.http.server.request.count",
      );
      assertEquals(counts.length, 1);
      assertEquals(counts[0].attributes["http.request.method"], "_OTHER");
    },
  );

  await t.step(
    "preserves QUERY as a known HTTP method",
    async () => {
      const { federation, recorder } = createTestContext();
      const response = await federation.fetch(
        new Request("https://example.com/users/alice", {
          method: "QUERY",
          headers: { "Accept": "application/activity+json" },
        }),
        { contextData: undefined },
      );
      assert(response.status >= 100);

      const counts = recorder.getMeasurements(
        "fedify.http.server.request.count",
      );
      assertEquals(counts.length, 1);
      assertEquals(counts[0].attributes["http.request.method"], "QUERY");
    },
  );

  await t.step(
    "uses the global meter provider when none is configured",
    async () => {
      const kv = new MemoryKvStore();
      const federation = createFederation<void>({
        kv,
        documentLoaderFactory: () => mockDocumentLoader,
      });
      federation.setActorDispatcher(
        "/users/{identifier}",
        (ctx, identifier) =>
          new vocab.Person({ id: ctx.getActorUri(identifier) }),
      );

      // Should not throw—the no-op meter provider absorbs the calls.
      const response = await federation.fetch(
        new Request("https://example.com/users/alice", {
          method: "GET",
          headers: { "Accept": "application/activity+json" },
        }),
        { contextData: undefined },
      );
      assertEquals(response.status, 200);
    },
  );
});

test("Federation.setInboxListeners()", async (t) => {
  const kv = new MemoryKvStore();

  fetchMock.spyGlobal();

  fetchMock.get("https://example.com/key2", {
    headers: { "Content-Type": "application/activity+json" },
    body: await rsaPublicKey2.toJsonLd({ contextLoader: mockDocumentLoader }),
  });

  fetchMock.get("begin:https://example.com/person2", {
    headers: { "Content-Type": "application/activity+json" },
    body: person2Fixture,
  });

  fetchMock.get("begin:https://example.com/person", {
    headers: { "Content-Type": "application/activity+json" },
    body: personFixture,
  });

  await t.step("path match", () => {
    const federation = createFederation<void>({
      kv,
      documentLoaderFactory: () => mockDocumentLoader,
    });
    federation.setInboxDispatcher(
      "/users/{identifier}/inbox",
      () => ({ items: [] }),
    );
    assertThrows(
      () => federation.setInboxListeners("/users/{identifier}/inbox2"),
      RouterError,
    );
  });

  await t.step("wrong variables in path", () => {
    const federation = createFederation<void>({
      kv,
      documentLoaderFactory: () => mockDocumentLoader,
    });
    assertThrows(
      () =>
        federation.setInboxListeners(
          "/users/inbox" as `${string}{identifier}${string}`,
        ),
      RouterError,
    );
    assertThrows(
      () => federation.setInboxListeners("/users/{identifier}/inbox/{id2}"),
      RouterError,
    );
    assertThrows(
      () => federation.setInboxListeners("/users/{identifier}/inbox/{extra}"),
      RouterError,
    );
    assertThrows(
      () =>
        federation.setInboxListeners(
          "/users/{identifier2}/inbox" as `${string}{identifier}${string}`,
        ),
      RouterError,
    );
  });

  await t.step("on()", async () => {
    const authenticatedRequests: [string, string][] = [];
    const federation = createFederation<void>({
      kv,
      documentLoaderFactory: () => mockDocumentLoader,
      authenticatedDocumentLoaderFactory(identity) {
        const docLoader = getAuthenticatedDocumentLoader(identity);
        return (url: string) => {
          const urlObj = new URL(url);
          authenticatedRequests.push([url, identity.keyId.href]);
          if (urlObj.host === "example.com") return docLoader(url);
          return mockDocumentLoader(url);
        };
      },
    });
    const inbox: [Context<void>, vocab.Create][] = [];
    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
      .on(vocab.Create, (ctx, create) => {
        inbox.push([ctx, create]);
      });

    let response = await federation.fetch(
      new Request("https://example.com/inbox", {
        method: "POST",
        headers: { "accept": "application/ld+json" },
      }),
      { contextData: undefined },
    );
    assertEquals(inbox, []);
    assertEquals(response.status, 404);

    federation
      .setActorDispatcher(
        "/users/{identifier}",
        (_, identifier) => identifier === "john" ? new vocab.Person({}) : null,
      )
      .setKeyPairsDispatcher(() => [{
        privateKey: rsaPrivateKey2,
        publicKey: rsaPublicKey2.publicKey!,
      }]);
    const options = {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
    };
    const activity = () =>
      new vocab.Create({
        id: new URL("https://example.com/activities/" + crypto.randomUUID()),
        actor: new URL("https://example.com/person2"),
      });
    response = await federation.fetch(
      new Request(
        "https://example.com/inbox",
        {
          method: "POST",
          body: JSON.stringify(await activity().toJsonLd(options)),
          headers: {
            "accept": "application/ld+json",
            "content-type": "application/ld+json",
          },
        },
      ),
      { contextData: undefined },
    );
    assertEquals(inbox, []);
    assertEquals(response.status, 401);

    response = await federation.fetch(
      new Request("https://example.com/users/no-one/inbox", {
        method: "POST",
        headers: { "accept": "application/ld+json" },
      }),
      { contextData: undefined },
    );
    assertEquals(inbox, []);
    assertEquals(response.status, 404);

    response = await federation.fetch(
      new Request(
        "https://example.com/users/john/inbox",
        {
          method: "POST",
          body: JSON.stringify(await activity().toJsonLd(options)),
          headers: {
            "accept": "application/ld+json",
            "content-type": "application/ld+json",
          },
        },
      ),
      { contextData: undefined },
    );
    assertEquals(inbox, []);
    assertEquals(response.status, 401);

    // Personal inbox + HTTP Signatures (RSA)
    const activityPayload = await activity().toJsonLd(options);
    let request = new Request("https://example.com/users/john/inbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
        accept: "application/ld+json",
      },
      body: JSON.stringify(activityPayload),
    });
    request = await signRequest(
      request,
      rsaPrivateKey3,
      new URL("https://example.com/person2#key3"),
    );
    response = await federation.fetch(request, { contextData: undefined });
    assertEquals(inbox.length, 1);
    assertEquals(inbox[0][1].actorId, new URL("https://example.com/person2"));
    assertEquals(response.status, 202);

    while (authenticatedRequests.length > 0) authenticatedRequests.shift();
    assertEquals(authenticatedRequests, []);
    await inbox[0][0].documentLoader("https://example.com/person");
    assertEquals(authenticatedRequests, [
      ["https://example.com/person", "https://example.com/users/john#main-key"],
    ]);

    // Idempotence check
    response = await federation.fetch(request, { contextData: undefined });
    assertEquals(inbox.length, 1);

    // Idempotence check with different origin (host)
    inbox.shift();
    request = new Request("https://another.host/users/john/inbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
        "accept": "application/ld+json",
      },
      body: JSON.stringify(activityPayload),
    });
    request = await signRequest(
      request,
      rsaPrivateKey3,
      new URL("https://example.com/person2#key3"),
    );
    response = await federation.fetch(request, { contextData: undefined });
    assertEquals(inbox.length, 1);
    assertEquals(inbox[0][1].actorId, new URL("https://example.com/person2"));
    assertEquals(response.status, 202);

    while (authenticatedRequests.length > 0) authenticatedRequests.shift();
    assertEquals(authenticatedRequests, []);
    await inbox[0][0].documentLoader("https://example.com/person");
    assertEquals(authenticatedRequests, [
      [
        "https://example.com/person",
        "https://another.host/users/john#main-key",
      ],
    ]);

    // Shared inbox + HTTP Signatures (RSA)
    inbox.shift();
    request = new Request("https://example.com/inbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
        "accept": "application/ld+json",
      },
      body: JSON.stringify(await activity().toJsonLd(options)),
    });
    request = await signRequest(
      request,
      rsaPrivateKey3,
      new URL("https://example.com/person2#key3"),
    );
    response = await federation.fetch(request, { contextData: undefined });
    assertEquals(inbox.length, 1);
    assertEquals(inbox[0][1].actorId, new URL("https://example.com/person2"));
    assertEquals(response.status, 202);

    while (authenticatedRequests.length > 0) authenticatedRequests.shift();
    assertEquals(authenticatedRequests, []);
    await inbox[0][0].documentLoader("https://example.com/person");
    assertEquals(authenticatedRequests, []);

    // Object Integrity Proofs (Ed25519)
    inbox.shift();
    request = new Request("https://example.com/users/john/inbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
        "accept": "application/ld+json",
      },
      body: JSON.stringify(
        await (await signObject(
          activity(),
          ed25519PrivateKey,
          ed25519Multikey.id!,
          options,
        )).toJsonLd(options),
      ),
    });
    response = await federation.fetch(request, { contextData: undefined });
    assertEquals(inbox.length, 1);
    assertEquals(inbox[0][1].actorId, new URL("https://example.com/person2"));
    assertEquals(response.status, 202);

    while (authenticatedRequests.length > 0) authenticatedRequests.shift();
    assertEquals(authenticatedRequests, []);
    await inbox[0][0].documentLoader("https://example.com/person");
    assertEquals(authenticatedRequests, [
      ["https://example.com/person", "https://example.com/users/john#main-key"],
    ]);
  });

  await t.step("onUnverifiedActivity()", async (t) => {
    const options = {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
    };

    async function createInboxRequest(
      activity: vocab.Create,
      signature?: { privateKey: CryptoKey; keyId: URL },
    ): Promise<Request> {
      let request = new Request("https://example.com/inbox", {
        method: "POST",
        headers: {
          "Content-Type": "application/activity+json",
          accept: "application/ld+json",
        },
        body: JSON.stringify(await activity.toJsonLd(options)),
      });
      if (signature != null) {
        request = await signRequest(
          request,
          signature.privateKey,
          signature.keyId,
        );
      }
      return request;
    }

    function createFederationWithLoader(
      documentLoader: typeof mockDocumentLoader,
    ) {
      const federation = createFederation<void>({
        kv: new MemoryKvStore(),
        documentLoaderFactory: () => documentLoader,
        contextLoaderFactory: () => mockDocumentLoader,
      });
      const verified: vocab.Create[] = [];
      federation.setActorDispatcher("/users/{identifier}", () => {
        return new vocab.Person({});
      });
      const inboxListeners = federation.setInboxListeners(
        "/users/{identifier}/inbox",
        "/inbox",
      )
        .on(vocab.Create, (_ctx, activity) => {
          verified.push(activity);
        });
      return { federation, verified, inboxListeners };
    }

    await t.step("receives noSignature reason", async () => {
      const { federation, verified, inboxListeners } =
        createFederationWithLoader(
          mockDocumentLoader,
        );
      let receivedReason: unknown = null;
      inboxListeners.onUnverifiedActivity((_ctx, _activity, reason) => {
        receivedReason = reason;
        return new Response(null, { status: 202 });
      });

      const response = await federation.fetch(
        await createInboxRequest(
          new vocab.Create({
            id: new URL("https://remote.example/activities/no-signature"),
            actor: new URL("https://remote.example/actors/alice"),
          }),
        ),
        { contextData: undefined },
      );

      assertEquals(response.status, 202);
      assertEquals(receivedReason, { type: "noSignature" });
      assertEquals(verified, []);
    });

    await t.step("receives keyFetchError for 410 responses", async () => {
      const goneKeyId = new URL("https://gone.example/actors/alice#main-key");
      const goneLoader = async (url: string) => {
        if (url === goneKeyId.href) {
          throw new FetchError(
            goneKeyId,
            `HTTP 410: ${goneKeyId.href}`,
            new Response(null, { status: 410 }),
          );
        }
        return await mockDocumentLoader(url);
      };
      const { federation, verified, inboxListeners } =
        createFederationWithLoader(
          goneLoader,
        );
      let receivedReason: unknown = null;
      inboxListeners.onUnverifiedActivity((_ctx, _activity, reason) => {
        receivedReason = reason;
        return new Response(null, { status: 202 });
      });

      const response = await federation.fetch(
        await createInboxRequest(
          new vocab.Create({
            id: new URL("https://gone.example/activities/delete"),
            actor: new URL("https://gone.example/actors/alice"),
          }),
          { privateKey: rsaPrivateKey3, keyId: goneKeyId },
        ),
        { contextData: undefined },
      );

      assertEquals(response.status, 202);
      assertEquals(verified, []);
      assertEquals(
        (receivedReason as { type: string }).type,
        "keyFetchError",
      );
      assertEquals(
        (receivedReason as { keyId: URL }).keyId.href,
        goneKeyId.href,
      );
      assertEquals(
        (
          receivedReason as {
            result: { status: number; response: Response };
          }
        ).result.status,
        410,
      );
    });

    await t.step("preserves keyFetchError details across retries", async () => {
      const keyId = new URL("https://gone.example/actors/alice#main-key");
      let keyFetches = 0;
      const goneLoader = async (url: string) => {
        if (url === keyId.href) {
          keyFetches++;
          throw new FetchError(
            keyId,
            `HTTP 410: ${keyId.href}`,
            new Response(null, { status: 410 }),
          );
        }
        return await mockDocumentLoader(url);
      };
      const { federation, inboxListeners } = createFederationWithLoader(
        goneLoader,
      );
      const reasons: unknown[] = [];
      inboxListeners.onUnverifiedActivity((_ctx, _activity, reason) => {
        reasons.push(reason);
        return new Response(null, { status: 202 });
      });

      const request = await createInboxRequest(
        new vocab.Create({
          id: new URL("https://gone.example/activities/retry"),
          actor: new URL("https://gone.example/actors/alice"),
        }),
        { privateKey: rsaPrivateKey3, keyId },
      );

      const first = await federation.fetch(request.clone() as Request, {
        contextData: undefined,
      });
      const second = await federation.fetch(request.clone() as Request, {
        contextData: undefined,
      });

      assertEquals(first.status, 202);
      assertEquals(second.status, 202);
      assertEquals(keyFetches, 1);
      assertEquals(
        (reasons[0] as { type: string }).type,
        "keyFetchError",
      );
      assertEquals(
        (reasons[1] as { type: string }).type,
        "keyFetchError",
      );
      assertEquals(
        (
          reasons[1] as {
            result: { status: number; response: Response };
          }
        ).result.status,
        410,
      );
    });

    await t.step("falls back to 401 when handler returns void", async () => {
      const missingKeyId = new URL(
        "https://missing.example/actors/alice#main-key",
      );
      const missingLoader = async (url: string) => {
        if (url === missingKeyId.href) {
          throw new FetchError(
            missingKeyId,
            `HTTP 404: ${missingKeyId.href}`,
            new Response(null, { status: 404 }),
          );
        }
        return await mockDocumentLoader(url);
      };
      const { federation, verified, inboxListeners } =
        createFederationWithLoader(
          missingLoader,
        );
      let receivedReason: unknown = null;
      inboxListeners.onUnverifiedActivity((_ctx, _activity, reason) => {
        receivedReason = reason;
      });

      const response = await federation.fetch(
        await createInboxRequest(
          new vocab.Create({
            id: new URL("https://missing.example/activities/delete"),
            actor: new URL("https://missing.example/actors/alice"),
          }),
          { privateKey: rsaPrivateKey3, keyId: missingKeyId },
        ),
        { contextData: undefined },
      );

      assertEquals(response.status, 401);
      assertEquals(verified, []);
      assertEquals(
        (receivedReason as { type: string }).type,
        "keyFetchError",
      );
      assertEquals(
        (
          receivedReason as {
            result: { status: number; response: Response };
          }
        ).result.status,
        404,
      );
    });

    await t.step(
      "falls back to 401 and reports hook errors",
      async () => {
        const missingKeyId = new URL(
          "https://missing.example/actors/alice#main-key",
        );
        const missingLoader = async (url: string) => {
          if (url === missingKeyId.href) {
            throw new FetchError(
              missingKeyId,
              `HTTP 404: ${missingKeyId.href}`,
              new Response(null, { status: 404 }),
            );
          }
          return await mockDocumentLoader(url);
        };
        const { federation, verified, inboxListeners } =
          createFederationWithLoader(
            missingLoader,
          );
        let receivedErrorMessage: string | null = null;
        inboxListeners
          .onUnverifiedActivity(() => {
            throw new Error("Intended unverified hook failure");
          })
          .onError((_ctx, error) => {
            receivedErrorMessage = error.message;
          });

        const response = await federation.fetch(
          await createInboxRequest(
            new vocab.Create({
              id: new URL("https://missing.example/activities/error"),
              actor: new URL("https://missing.example/actors/alice"),
            }),
            { privateKey: rsaPrivateKey3, keyId: missingKeyId },
          ),
          { contextData: undefined },
        );

        assertEquals(response.status, 401);
        assertEquals(verified, []);
        assertEquals(
          receivedErrorMessage,
          "Intended unverified hook failure",
        );
      },
    );

    await t.step("receives invalidSignature reason", async () => {
      const { federation, verified, inboxListeners } =
        createFederationWithLoader(
          mockDocumentLoader,
        );
      let receivedReason: unknown = null;
      inboxListeners.onUnverifiedActivity((_ctx, _activity, reason) => {
        receivedReason = reason;
        return new Response(null, { status: 202 });
      });

      const keyId = new URL("https://example.com/person2#key3");
      const response = await federation.fetch(
        await createInboxRequest(
          new vocab.Create({
            id: new URL("https://example.com/activities/invalid-signature"),
            actor: new URL("https://example.com/person2"),
          }),
          { privateKey: rsaPrivateKey2, keyId },
        ),
        { contextData: undefined },
      );

      assertEquals(response.status, 202);
      assertEquals(verified, []);
      assertEquals(
        (receivedReason as { type: string }).type,
        "invalidSignature",
      );
      assertEquals(
        (receivedReason as { keyId: URL }).keyId.href,
        keyId.href,
      );
    });

    await t.step("does not run for verified activities", async () => {
      const { federation, verified, inboxListeners } =
        createFederationWithLoader(
          mockDocumentLoader,
        );
      let unverifiedCalls = 0;
      inboxListeners.onUnverifiedActivity(() => {
        unverifiedCalls++;
        return new Response(null, { status: 202 });
      });

      const response = await federation.fetch(
        await createInboxRequest(
          new vocab.Create({
            id: new URL("https://example.com/activities/verified"),
            actor: new URL("https://example.com/person2"),
          }),
          {
            privateKey: rsaPrivateKey3,
            keyId: new URL("https://example.com/person2#key3"),
          },
        ),
        { contextData: undefined },
      );

      assertEquals(response.status, 202);
      assertEquals(unverifiedCalls, 0);
      assertEquals(verified.length, 1);
    });
  });

  await t.step("onError()", async () => {
    const federation = createFederation<void>({
      kv,
      documentLoaderFactory: () => mockDocumentLoader,
      authenticatedDocumentLoaderFactory(identity) {
        const docLoader = getAuthenticatedDocumentLoader(identity);
        return (url: string) => {
          const urlObj = new URL(url);
          if (urlObj.host === "example.com") return docLoader(url);
          return mockDocumentLoader(url);
        };
      },
    });
    federation
      .setActorDispatcher(
        "/users/{identifier}",
        (_, identifier) => identifier === "john" ? new vocab.Person({}) : null,
      )
      .setKeyPairsDispatcher(() => [{
        privateKey: rsaPrivateKey2,
        publicKey: rsaPublicKey2.publicKey!,
      }]);
    const error = new Error("test");
    const errors: unknown[] = [];
    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
      .on(vocab.Create, () => {
        throw error;
      })
      .onError((_, e) => {
        errors.push(e);
      });

    const activity = new vocab.Create({
      actor: new URL("https://example.com/person"),
    });
    let request = new Request("https://example.com/users/john/inbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
        "Accept": "application/activity+json",
      },
      body: JSON.stringify(
        await activity.toJsonLd({ contextLoader: mockDocumentLoader }),
      ),
    });
    request = await signRequest(
      request,
      rsaPrivateKey2,
      new URL("https://example.com/key2"),
    );
    const response = await federation.fetch(request, {
      contextData: undefined,
    });
    assertEquals(errors.length, 1);
    assertEquals(errors[0], error);
    assertEquals(response.status, 500);
  });

  fetchMock.hardReset();
});

test("Federation.setOutboxListeners()", async (t) => {
  const kv = new MemoryKvStore();

  await t.step("path match", () => {
    const federation = createFederation<void>({
      kv,
      documentLoaderFactory: () => mockDocumentLoader,
    });
    federation.setOutboxDispatcher(
      "/users/{identifier}/outbox",
      () => ({ items: [] }),
    );
    assertThrows(
      () => federation.setOutboxListeners("/users/{identifier}/outbox2"),
      RouterError,
    );
  });

  await t.step("on() and authorize()", async () => {
    const postedFixture = {
      ...createFixture,
      actor: "https://example.com/users/john",
    };
    const federation = createFederation<void>({
      kv,
      documentLoaderFactory: () => mockDocumentLoader,
    });
    const received: string[] = [];
    federation
      .setActorDispatcher(
        "/users/{identifier}",
        (_ctx, identifier) =>
          identifier === "john" ? new vocab.Person({}) : null,
      )
      .setKeyPairsDispatcher(() => [{
        privateKey: rsaPrivateKey2,
        publicKey: rsaPublicKey2.publicKey!,
      }]);

    federation
      .setOutboxDispatcher(
        "/users/{identifier}/outbox",
        () => ({ items: [] }),
      )
      .authorize((_ctx, identifier) => identifier === "john");

    federation
      .setOutboxListeners("/users/{identifier}/outbox")
      .on(vocab.Activity, (ctx, activity) => {
        received.push(`${ctx.identifier}:${activity.id?.href}`);
      })
      .authorize((ctx, identifier) => {
        return identifier === "john" &&
          ctx.request.headers.get("authorization") === "Bearer token";
      });

    let response = await federation.fetch(
      new Request("https://example.com/users/john/outbox", {
        method: "POST",
        body: JSON.stringify(postedFixture),
        headers: {
          "content-type": "application/activity+json",
        },
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 401);
    assertEquals(received, []);

    response = await federation.fetch(
      new Request("https://example.com/users/john/outbox", {
        method: "POST",
        body: JSON.stringify(postedFixture),
        headers: {
          authorization: "Bearer token",
          "content-type": "application/activity+json",
        },
      }),
      { contextData: undefined },
    );
    assertEquals([response.status, await response.text()], [202, ""]);
    assertEquals(received, [
      `john:${createFixture.id}`,
    ]);

    response = await federation.fetch(
      new Request("https://example.com/users/no-one/outbox", {
        method: "POST",
        body: JSON.stringify(createFixture),
        headers: {
          authorization: "Bearer token",
          "content-type": "application/activity+json",
        },
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 401);
  });

  await t.step("POST without listeners returns 405", async () => {
    const federation = createFederation<void>({
      kv,
      documentLoaderFactory: () => mockDocumentLoader,
    });
    federation.setActorDispatcher(
      "/users/{identifier}",
      () => new vocab.Person({}),
    );
    federation.setOutboxDispatcher(
      "/users/{identifier}/outbox",
      () => ({ items: [] }),
    );

    const response = await federation.fetch(
      new Request("https://example.com/users/john/outbox", {
        method: "POST",
        body: JSON.stringify(createFixture),
        headers: {
          "content-type": "application/activity+json",
        },
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 405);
    assertEquals(response.headers.get("allow"), "GET, HEAD");
  });

  await t.step(
    "falls back to outbox dispatcher authorize when listener authorize is unset",
    async () => {
      const postedFixture = {
        ...createFixture,
        actor: "https://example.com/users/john",
      };
      const federation = createFederation<void>({
        kv,
        documentLoaderFactory: () => mockDocumentLoader,
      });
      const received: string[] = [];
      federation
        .setActorDispatcher(
          "/users/{identifier}",
          (_ctx, identifier) =>
            identifier === "john" ? new vocab.Person({}) : null,
        )
        .setKeyPairsDispatcher(() => [{
          privateKey: rsaPrivateKey2,
          publicKey: rsaPublicKey2.publicKey!,
        }]);

      federation
        .setOutboxDispatcher(
          "/users/{identifier}/outbox",
          () => ({ items: [] }),
        )
        .authorize((ctx, identifier) => {
          return identifier === "john" &&
            ctx.request.headers.get("authorization") === "Bearer token";
        });

      federation
        .setOutboxListeners("/users/{identifier}/outbox")
        .on(vocab.Activity, (ctx, activity) => {
          received.push(`${ctx.identifier}:${activity.id?.href}`);
        });

      let response = await federation.fetch(
        new Request("https://example.com/users/john/outbox", {
          method: "POST",
          body: JSON.stringify(postedFixture),
          headers: {
            "content-type": "application/activity+json",
          },
        }),
        { contextData: undefined },
      );
      assertEquals(response.status, 401);
      assertEquals(received, []);

      response = await federation.fetch(
        new Request("https://example.com/users/john/outbox", {
          method: "POST",
          body: JSON.stringify(postedFixture),
          headers: {
            authorization: "Bearer token",
            "content-type": "application/activity+json",
          },
        }),
        { contextData: undefined },
      );
      assertEquals([response.status, await response.text()], [202, ""]);
      assertEquals(received, [`john:${createFixture.id}`]);
    },
  );

  await t.step("warns when listener omits delivery", async () => {
    await withLogtapeLock(async () => {
      const postedFixture = {
        ...createFixture,
        actor: "https://example.com/users/john",
      };
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
          loggers: [{ category: [], sinks: ["buffer"] }],
        });

        const federation = createFederation<void>({
          kv,
          documentLoaderFactory: () => mockDocumentLoader,
        });
        federation
          .setActorDispatcher(
            "/users/{identifier}",
            (_ctx, identifier) =>
              identifier === "john" ? new vocab.Person({}) : null,
          )
          .setKeyPairsDispatcher(() => [{
            privateKey: rsaPrivateKey2,
            publicKey: rsaPublicKey2.publicKey!,
          }]);

        federation
          .setOutboxListeners("/users/{identifier}/outbox")
          .on(vocab.Activity, () => {})
          .authorize((ctx, identifier) => {
            return identifier === "john" &&
              ctx.request.headers.get("authorization") === "Bearer token";
          });

        const response = await federation.fetch(
          new Request("https://example.com/users/john/outbox", {
            method: "POST",
            body: JSON.stringify(postedFixture),
            headers: {
              authorization: "Bearer token",
              "content-type": "application/activity+json",
            },
          }),
          { contextData: undefined },
        );

        assertEquals(response.status, 202);
        assertEquals(
          records.some((record) =>
            record.rawMessage ===
              "Outbox listener for {identifier} returned without delivering the posted activity; ctx.sendActivity() or ctx.forwardActivity() may have been skipped or resulted in no delivery." &&
            record.properties.identifier === "john"
          ),
          true,
        );
      } finally {
        await reset();
      }
    });
  });

  await t.step("does not warn when listener calls sendActivity()", async () => {
    await withLogtapeLock(async () => {
      const postedFixture = {
        ...createFixture,
        actor: "https://example.com/users/john",
      };
      const records: LogRecord[] = [];
      await reset();
      fetchMock.spyGlobal();
      fetchMock.post("https://remote.example/inbox", {
        status: 202,
        body: "Accepted",
      });

      try {
        await configure({
          sinks: {
            buffer(record: LogRecord): void {
              records.push(record);
            },
          },
          filters: {},
          loggers: [{ category: [], sinks: ["buffer"] }],
        });

        const federation = createFederation<void>({
          kv,
          documentLoaderFactory: () => mockDocumentLoader,
        });
        federation
          .setActorDispatcher(
            "/users/{identifier}",
            (_ctx, identifier) =>
              identifier === "john" ? new vocab.Person({}) : null,
          )
          .setKeyPairsDispatcher(() => [{
            privateKey: rsaPrivateKey2,
            publicKey: rsaPublicKey2.publicKey!,
          }]);

        federation
          .setOutboxListeners("/users/{identifier}/outbox")
          .on(vocab.Activity, async (ctx, activity) => {
            await ctx.sendActivity(
              { identifier: ctx.identifier },
              new vocab.Person({
                id: new URL("https://remote.example/users/alice"),
                inbox: new URL("https://remote.example/inbox"),
              }),
              activity,
            );
          })
          .authorize((ctx, identifier) => {
            return identifier === "john" &&
              ctx.request.headers.get("authorization") === "Bearer token";
          });

        const response = await federation.fetch(
          new Request("https://example.com/users/john/outbox", {
            method: "POST",
            body: JSON.stringify(postedFixture),
            headers: {
              authorization: "Bearer token",
              "content-type": "application/activity+json",
            },
          }),
          { contextData: undefined },
        );

        assertEquals(response.status, 202);
        assertEquals(
          records.some((record) =>
            record.rawMessage ===
              "Outbox listener for {identifier} returned without delivering the posted activity; ctx.sendActivity() or ctx.forwardActivity() may have been skipped or resulted in no delivery."
          ),
          false,
        );
      } finally {
        fetchMock.hardReset();
        await reset();
      }
    });
  });

  await t.step(
    "warns when listener calls sendActivity() with zero inboxes",
    async () => {
      await withLogtapeLock(async () => {
        const postedFixture = {
          ...createFixture,
          actor: "https://example.com/users/john",
        };
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
            loggers: [{ category: [], sinks: ["buffer"] }],
          });

          const federation = createFederation<void>({
            kv,
            documentLoaderFactory: () => mockDocumentLoader,
          });
          federation
            .setActorDispatcher(
              "/users/{identifier}",
              (_ctx, identifier) =>
                identifier === "john" ? new vocab.Person({}) : null,
            )
            .setKeyPairsDispatcher(() => [{
              privateKey: rsaPrivateKey2,
              publicKey: rsaPublicKey2.publicKey!,
            }]);

          federation
            .setOutboxListeners("/users/{identifier}/outbox")
            .on(vocab.Activity, async (ctx, activity) => {
              await ctx.sendActivity(
                { identifier: ctx.identifier },
                [],
                activity,
              );
            })
            .authorize((ctx, identifier) => {
              return identifier === "john" &&
                ctx.request.headers.get("authorization") === "Bearer token";
            });

          const response = await federation.fetch(
            new Request("https://example.com/users/john/outbox", {
              method: "POST",
              body: JSON.stringify(postedFixture),
              headers: {
                authorization: "Bearer token",
                "content-type": "application/activity+json",
              },
            }),
            { contextData: undefined },
          );

          assertEquals(response.status, 202);
          assertEquals(
            records.some((record) =>
              record.rawMessage ===
                "Outbox listener for {identifier} returned without delivering the posted activity; ctx.sendActivity() or ctx.forwardActivity() may have been skipped or resulted in no delivery." &&
              record.properties.identifier === "john"
            ),
            true,
          );
        } finally {
          await reset();
        }
      });
    },
  );

  await t.step(
    "does not warn when listener calls forwardActivity()",
    async () => {
      await withLogtapeLock(async () => {
        const postedFixture = await signJsonLd(
          {
            ...createFixture,
            actor: "https://example.com/person2",
          },
          rsaPrivateKey3,
          rsaPublicKey3.id!,
          { contextLoader: mockDocumentLoader },
        );
        const records: LogRecord[] = [];
        let ldsVerified = false;
        await reset();
        fetchMock.spyGlobal();
        fetchMock.post("https://remote.example/inbox", async (cl) => {
          const verifyOptions = {
            documentLoader: mockDocumentLoader,
            contextLoader: mockDocumentLoader,
          };
          ldsVerified = await verifyJsonLd(
            await cl.request!.json(),
            verifyOptions,
          );
          return new Response(null, { status: ldsVerified ? 202 : 401 });
        });

        try {
          await configure({
            sinks: {
              buffer(record: LogRecord): void {
                records.push(record);
              },
            },
            filters: {},
            loggers: [{ category: [], sinks: ["buffer"] }],
          });

          const federation = createFederation<void>({
            kv,
            documentLoaderFactory: () => mockDocumentLoader,
          });
          federation
            .setActorDispatcher(
              "/{identifier}",
              (_ctx, identifier) =>
                identifier === "person2" ? new vocab.Person({}) : null,
            )
            .setKeyPairsDispatcher(() => [{
              privateKey: rsaPrivateKey2,
              publicKey: rsaPublicKey2.publicKey!,
            }]);

          federation
            .setOutboxListeners("/users/{identifier}/outbox")
            .on(vocab.Activity, async (ctx) => {
              await ctx.forwardActivity(
                [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
                {
                  id: new URL("https://remote.example/users/alice"),
                  inboxId: new URL("https://remote.example/inbox"),
                },
                { skipIfUnsigned: true },
              );
            })
            .authorize((ctx, identifier) => {
              return identifier === "person2" &&
                ctx.request.headers.get("authorization") === "Bearer token";
            });

          const response = await federation.fetch(
            new Request("https://example.com/users/person2/outbox", {
              method: "POST",
              body: JSON.stringify(postedFixture),
              headers: {
                authorization: "Bearer token",
                "content-type": "application/activity+json",
              },
            }),
            { contextData: undefined },
          );

          assertEquals(response.status, 202);
          assertEquals(ldsVerified, true);
          assertEquals(
            records.some((record) =>
              record.rawMessage ===
                "Outbox listener for {identifier} returned without delivering the posted activity; ctx.sendActivity() or ctx.forwardActivity() may have been skipped or resulted in no delivery."
            ),
            false,
          );
        } finally {
          fetchMock.hardReset();
          await reset();
        }
      });
    },
  );

  await t.step(
    "warns when forwardActivity resolves to zero inboxes",
    async () => {
      await withLogtapeLock(async () => {
        const postedFixture = {
          ...createFixture,
          actor: "https://example.com/users/john",
        };
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
            loggers: [{ category: [], sinks: ["buffer"] }],
          });

          const federation = createFederation<void>({
            kv,
            documentLoaderFactory: () => mockDocumentLoader,
          });
          federation
            .setActorDispatcher(
              "/users/{identifier}",
              (_ctx, identifier) =>
                identifier === "john" ? new vocab.Person({}) : null,
            )
            .setKeyPairsDispatcher(() => [{
              privateKey: rsaPrivateKey2,
              publicKey: rsaPublicKey2.publicKey!,
            }]);

          federation
            .setOutboxListeners("/users/{identifier}/outbox")
            .on(vocab.Activity, async (ctx) => {
              await ctx.forwardActivity(
                { identifier: ctx.identifier },
                [],
              );
            })
            .authorize((ctx, identifier) => {
              return identifier === "john" &&
                ctx.request.headers.get("authorization") === "Bearer token";
            });

          const response = await federation.fetch(
            new Request("https://example.com/users/john/outbox", {
              method: "POST",
              body: JSON.stringify(postedFixture),
              headers: {
                authorization: "Bearer token",
                "content-type": "application/activity+json",
              },
            }),
            { contextData: undefined },
          );

          assertEquals(response.status, 202);
          assertEquals(
            records.some((record) =>
              record.rawMessage ===
                "Outbox listener for {identifier} returned without delivering the posted activity; ctx.sendActivity() or ctx.forwardActivity() may have been skipped or resulted in no delivery." &&
              record.properties.identifier === "john"
            ),
            true,
          );
        } finally {
          await reset();
        }
      });
    },
  );

  await t.step(
    "forwardActivity starts the outbox queue automatically",
    async () => {
      const postedFixture = {
        ...createFixture,
        actor: "https://example.com/users/john",
      };
      let listenCalled = false;
      const enqueued: Message[] = [];
      const queue: MessageQueue = {
        enqueue(message: Message): Promise<void> {
          enqueued.push(message);
          return Promise.resolve();
        },
        listen(): Promise<void> {
          listenCalled = true;
          return Promise.resolve();
        },
      };
      const [meterProvider, recorder] = createTestMeterProvider();
      const federation = new FederationImpl<void>({
        kv,
        contextLoaderFactory: () => mockDocumentLoader,
        meterProvider,
        queue,
      });
      federation
        .setActorDispatcher(
          "/users/{identifier}",
          (_ctx, identifier) =>
            identifier === "john" ? new vocab.Person({}) : null,
        )
        .setKeyPairsDispatcher(() => [{
          privateKey: rsaPrivateKey2,
          publicKey: rsaPublicKey2.publicKey!,
        }]);

      federation
        .setOutboxListeners("/users/{identifier}/outbox")
        .on(vocab.Activity, async (ctx) => {
          await ctx.forwardActivity(
            { identifier: ctx.identifier },
            {
              id: new URL("https://remote.example/users/alice"),
              inboxId: new URL("https://remote.example/inbox"),
            },
          );
        })
        .authorize((ctx, identifier) => {
          return identifier === "john" &&
            ctx.request.headers.get("authorization") === "Bearer token";
        });

      const response = await federation.fetch(
        new Request("https://example.com/users/john/outbox", {
          method: "POST",
          body: JSON.stringify(postedFixture),
          headers: {
            authorization: "Bearer token",
            "content-type": "application/activity+json",
          },
        }),
        { contextData: undefined },
      );

      assertEquals(response.status, 202);
      assertEquals(listenCalled, true);
      assertEquals(enqueued.length, 1);
      assertEquals(enqueued[0].type, "outbox");
      assertEquals((enqueued[0] as OutboxMessage).actorIds, [
        "https://remote.example/users/alice",
      ]);

      const enqueuedMetrics = recorder.getMeasurements(
        "fedify.queue.task.enqueued",
      );
      assertEquals(enqueuedMetrics.length, 1);
      assertEquals(
        enqueuedMetrics[0].attributes["fedify.queue.role"],
        "outbox",
      );
      assertEquals(
        enqueuedMetrics[0].attributes["fedify.queue.task.attempt"],
        0,
      );
    },
  );
});

function makeUploadForm(
  options: { file?: boolean; object?: string | null } = {},
): FormData {
  const {
    file = true,
    object = JSON.stringify({
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Image",
      name: "A cat",
    }),
  } = options;
  const form = new FormData();
  if (file) {
    form.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "cat.png", { type: "image/png" }),
    );
  }
  if (object != null) {
    form.append(
      "object",
      new Blob([object], { type: "application/json" }),
    );
  }
  return form;
}

test("Federation.setMediaUploader()", async (t) => {
  const kv = new MemoryKvStore();

  await t.step("path validation", () => {
    const federation = createFederation<void>({
      kv,
      documentLoaderFactory: () => mockDocumentLoader,
    });
    federation.setMediaUploader(
      "/users/{identifier}/media",
      () => Promise.resolve(new URL("https://example.com/")),
    );
    // A media uploader may only be registered once.
    assertThrows(
      () =>
        federation.setMediaUploader(
          "/users/{identifier}/media2",
          () => Promise.resolve(new URL("https://example.com/")),
        ),
      RouterError,
    );
  });

  await t.step("getMediaUploaderUri() builds the endpoint URI", () => {
    const federation = createFederation<void>({
      kv,
      documentLoaderFactory: () => mockDocumentLoader,
    });
    federation.setMediaUploader(
      "/users/{identifier}/media",
      () => Promise.resolve(new URL("https://example.com/")),
    );
    const ctx = federation.createContext(
      new URL("https://example.com/"),
      undefined,
    );
    assertEquals(
      ctx.getMediaUploaderUri("alice").href,
      "https://example.com/users/alice/media",
    );
  });

  await t.step(
    "returns 201 Created when the callback returns an object",
    async () => {
      const federation = createFederation<void>({
        kv,
        documentLoaderFactory: () => mockDocumentLoader,
      });
      federation.setActorDispatcher(
        "/users/{identifier}",
        (_ctx, identifier) =>
          identifier === "john" ? new vocab.Person({}) : null,
      );
      federation.setObjectDispatcher(
        vocab.Image,
        "/objects/{uuid}",
        (_ctx, values) => new vocab.Image({ name: `Image ${values.uuid}` }),
      );
      let receivedFileType: string | undefined;
      let receivedName: string | null | undefined;
      federation
        .setMediaUploader(
          "/users/{identifier}/media",
          (ctx, _identifier, file, object) => {
            receivedFileType = file.type;
            receivedName = typeof object.name === "string"
              ? object.name
              : object.name?.toString();
            return Promise.resolve(
              new vocab.Image({
                id: ctx.getObjectUri(vocab.Image, { uuid: "abc" }),
                url: new URL("https://example.com/files/abc.png"),
                mediaType: file.type,
                name: object.name,
              }),
            );
          },
        )
        .authorize((_ctx, identifier) => identifier === "john");

      const response = await federation.fetch(
        new Request("https://example.com/users/john/media", {
          method: "POST",
          body: makeUploadForm(),
        }),
        { contextData: undefined },
      );
      assertEquals(response.status, 201);
      assertEquals(
        response.headers.get("location"),
        "https://example.com/objects/abc",
      );
      assertEquals(receivedFileType, "image/png");
      assertEquals(receivedName, "A cat");
      const body = await response.json() as { id?: string };
      assertEquals(body.id, "https://example.com/objects/abc");
    },
  );

  await t.step(
    "returns 202 Accepted when the callback returns a URL",
    async () => {
      const federation = createFederation<void>({
        kv,
        documentLoaderFactory: () => mockDocumentLoader,
      });
      federation.setActorDispatcher(
        "/users/{identifier}",
        () => new vocab.Person({}),
      );
      federation.setObjectDispatcher(
        vocab.Video,
        "/videos/{uuid}",
        (_ctx, values) => new vocab.Video({ name: `Video ${values.uuid}` }),
      );
      federation
        .setMediaUploader(
          "/users/{identifier}/media",
          (ctx) =>
            Promise.resolve(ctx.getObjectUri(vocab.Video, { uuid: "xyz" })),
        )
        .authorize(() => true);

      const response = await federation.fetch(
        new Request("https://example.com/users/john/media", {
          method: "POST",
          body: makeUploadForm(),
        }),
        { contextData: undefined },
      );
      assertEquals(response.status, 202);
      assertEquals(
        response.headers.get("location"),
        "https://example.com/videos/xyz",
      );
      assertEquals(await response.text(), "");
    },
  );

  await t.step("415 when the request is not multipart/form-data", async () => {
    const federation = createFederation<void>({
      kv,
      documentLoaderFactory: () => mockDocumentLoader,
    });
    federation.setMediaUploader(
      "/users/{identifier}/media",
      () => Promise.resolve(new URL("https://example.com/")),
    );
    const response = await federation.fetch(
      new Request("https://example.com/users/john/media", {
        method: "POST",
        body: JSON.stringify({ type: "Image" }),
        headers: { "content-type": "application/json" },
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 415);
  });

  await t.step(
    "500 when the returned object has no id (no Location possible)",
    async () => {
      const federation = createFederation<void>({
        kv,
        documentLoaderFactory: () => mockDocumentLoader,
      });
      federation.setActorDispatcher(
        "/users/{identifier}",
        () => new vocab.Person({}),
      );
      federation.setMediaUploader(
        "/users/{identifier}/media",
        // An object with no id cannot yield a 201 Location header.
        () => Promise.resolve(new vocab.Image({ name: "no id" })),
      );
      const response = await federation.fetch(
        new Request("https://example.com/users/john/media", {
          method: "POST",
          body: makeUploadForm(),
        }),
        { contextData: undefined },
      );
      assertEquals(response.status, 500);
      assertEquals(response.headers.get("location"), null);
    },
  );

  await t.step("400 when the file field is missing", async () => {
    const federation = createFederation<void>({
      kv,
      documentLoaderFactory: () => mockDocumentLoader,
    });
    federation.setActorDispatcher(
      "/users/{identifier}",
      () => new vocab.Person({}),
    );
    federation.setMediaUploader(
      "/users/{identifier}/media",
      () => Promise.resolve(new URL("https://example.com/")),
    );
    const response = await federation.fetch(
      new Request("https://example.com/users/john/media", {
        method: "POST",
        body: makeUploadForm({ file: false }),
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 400);
  });

  await t.step("400 when the object field is missing", async () => {
    const federation = createFederation<void>({
      kv,
      documentLoaderFactory: () => mockDocumentLoader,
    });
    federation.setActorDispatcher(
      "/users/{identifier}",
      () => new vocab.Person({}),
    );
    federation.setMediaUploader(
      "/users/{identifier}/media",
      () => Promise.resolve(new URL("https://example.com/")),
    );
    const response = await federation.fetch(
      new Request("https://example.com/users/john/media", {
        method: "POST",
        body: makeUploadForm({ object: null }),
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 400);
  });

  await t.step("400 when the object field is unparseable", async () => {
    const federation = createFederation<void>({
      kv,
      documentLoaderFactory: () => mockDocumentLoader,
    });
    federation.setActorDispatcher(
      "/users/{identifier}",
      () => new vocab.Person({}),
    );
    federation.setMediaUploader(
      "/users/{identifier}/media",
      () => Promise.resolve(new URL("https://example.com/")),
    );
    const response = await federation.fetch(
      new Request("https://example.com/users/john/media", {
        method: "POST",
        body: makeUploadForm({ object: "{ not json" }),
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 400);
  });

  await t.step("401 when authorize returns false", async () => {
    const federation = createFederation<void>({
      kv,
      documentLoaderFactory: () => mockDocumentLoader,
    });
    federation.setActorDispatcher(
      "/users/{identifier}",
      () => new vocab.Person({}),
    );
    let called = false;
    federation
      .setMediaUploader("/users/{identifier}/media", () => {
        called = true;
        return Promise.resolve(new URL("https://example.com/"));
      })
      .authorize(() => false);
    const response = await federation.fetch(
      new Request("https://example.com/users/john/media", {
        method: "POST",
        body: makeUploadForm(),
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 401);
    assertEquals(called, false);
  });

  await t.step(
    "404 when the actor does not exist (callback not invoked)",
    async () => {
      const federation = createFederation<void>({
        kv,
        documentLoaderFactory: () => mockDocumentLoader,
      });
      federation.setActorDispatcher(
        "/users/{identifier}",
        (_ctx, identifier) =>
          identifier === "john" ? new vocab.Person({}) : null,
      );
      let called = false;
      federation.setMediaUploader("/users/{identifier}/media", () => {
        called = true;
        return Promise.resolve(new URL("https://example.com/"));
      });
      const response = await federation.fetch(
        new Request("https://example.com/users/no-one/media", {
          method: "POST",
          body: makeUploadForm(),
        }),
        { contextData: undefined },
      );
      assertEquals(response.status, 404);
      assertEquals(called, false);
    },
  );

  await t.step(
    "404 when the actor is tombstoned (callback not invoked)",
    async () => {
      const federation = createFederation<void>({
        kv,
        documentLoaderFactory: () => mockDocumentLoader,
      });
      federation.setActorDispatcher(
        "/users/{identifier}",
        () => new vocab.Tombstone({}),
      );
      let called = false;
      federation.setMediaUploader("/users/{identifier}/media", () => {
        called = true;
        return Promise.resolve(new URL("https://example.com/"));
      });
      const response = await federation.fetch(
        new Request("https://example.com/users/john/media", {
          method: "POST",
          body: makeUploadForm(),
        }),
        { contextData: undefined },
      );
      assertEquals(response.status, 404);
      assertEquals(called, false);
    },
  );

  await t.step("405 for non-POST methods", async () => {
    const federation = createFederation<void>({
      kv,
      documentLoaderFactory: () => mockDocumentLoader,
    });
    federation.setMediaUploader(
      "/users/{identifier}/media",
      () => Promise.resolve(new URL("https://example.com/")),
    );
    const response = await federation.fetch(
      new Request("https://example.com/users/john/media", {
        method: "GET",
        headers: { accept: "application/activity+json" },
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 405);
    assertEquals(response.headers.get("allow"), "POST");
  });

  await t.step(
    "warns when the returned id is not a registered object route",
    async () => {
      await withLogtapeLock(async () => {
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
            loggers: [{ category: [], sinks: ["buffer"] }],
          });
          const federation = createFederation<void>({
            kv,
            documentLoaderFactory: () => mockDocumentLoader,
          });
          federation.setActorDispatcher(
            "/users/{identifier}",
            () => new vocab.Person({}),
          );
          federation.setMediaUploader(
            "/users/{identifier}/media",
            () =>
              // Not derived from ctx.getObjectUri(): no object dispatcher.
              Promise.resolve(
                new vocab.Image({
                  id: new URL("https://example.com/not-registered"),
                }),
              ),
          );
          const response = await federation.fetch(
            new Request("https://example.com/users/john/media", {
              method: "POST",
              body: makeUploadForm(),
            }),
            { contextData: undefined },
          );
          assertEquals(response.status, 201);
          assertEquals(
            records.some((record) =>
              record.category.join(".") === "fedify.federation.mediaUploader" &&
              record.level === "warning" &&
              record.properties.identifier === "john"
            ),
            true,
          );
        } finally {
          await reset();
        }
      });
    },
  );

  await t.step(
    "warns when the actor omits endpoints.uploadMedia",
    async () => {
      await withLogtapeLock(async () => {
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
            loggers: [{ category: [], sinks: ["buffer"] }],
          });
          const federation = createFederation<void>({
            kv,
            documentLoaderFactory: () => mockDocumentLoader,
          });
          federation.setActorDispatcher(
            "/users/{identifier}",
            (ctx, identifier) =>
              new vocab.Person({
                id: ctx.getActorUri(identifier),
                // No endpoints.uploadMedia even though a media uploader is set.
              }),
          );
          federation.setMediaUploader(
            "/users/{identifier}/media",
            () => Promise.resolve(new URL("https://example.com/")),
          );
          const response = await federation.fetch(
            new Request("https://example.com/users/john", {
              headers: { accept: "application/activity+json" },
            }),
            { contextData: undefined },
          );
          assertEquals(response.status, 200);
          assertEquals(
            records.some((record) =>
              record.rawMessage ===
                "You configured a media uploader, but the actor does not have " +
                  "a endpoints.uploadMedia property.  Set the property with " +
                  "Context.getMediaUploaderUri(identifier)."
            ),
            true,
          );
        } finally {
          await reset();
        }
      });
    },
  );

  await t.step(
    "does not warn when the actor advertises endpoints.uploadMedia",
    async () => {
      await withLogtapeLock(async () => {
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
            loggers: [{ category: [], sinks: ["buffer"] }],
          });
          const federation = createFederation<void>({
            kv,
            documentLoaderFactory: () => mockDocumentLoader,
          });
          federation.setActorDispatcher(
            "/users/{identifier}",
            (ctx, identifier) =>
              new vocab.Person({
                id: ctx.getActorUri(identifier),
                endpoints: new vocab.Endpoints({
                  uploadMedia: ctx.getMediaUploaderUri(identifier),
                }),
              }),
          );
          federation.setMediaUploader(
            "/users/{identifier}/media",
            () => Promise.resolve(new URL("https://example.com/")),
          );
          const response = await federation.fetch(
            new Request("https://example.com/users/john", {
              headers: { accept: "application/activity+json" },
            }),
            { contextData: undefined },
          );
          assertEquals(response.status, 200);
          assertEquals(
            records.some((record) =>
              typeof record.rawMessage === "string" &&
              record.rawMessage.includes("endpoints.uploadMedia")
            ),
            false,
          );
        } finally {
          await reset();
        }
      });
    },
  );
});

test("Federation.fetch() preserves original LD-signed payload for InboxContextImpl.activity", async () => {
  const remoteContextUrl = "https://remote.example/contexts/ext";
  const sourceContextLoader = async (resource: string) => {
    const url = new URL(resource).href;
    if (url === remoteContextUrl) {
      return {
        contextUrl: null,
        documentUrl: url,
        document: {
          "@context": {
            ext: "https://example.com/ext",
          },
        },
      };
    }
    return await mockDocumentLoader(url);
  };
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    documentLoaderFactory: () => mockDocumentLoader,
    contextLoaderFactory: () => sourceContextLoader,
  });
  federation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx, identifier) => identifier === "someone" ? new Person({}) : null,
  );
  let receivedRaw: unknown = null;
  let receivedTyped: Create | null = null;
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .on(Create, (ctx, activity) => {
      receivedRaw = (ctx as unknown as { activity: unknown }).activity;
      receivedTyped = activity;
    });
  const signed = await signJsonLd(
    {
      "@context": [
        remoteContextUrl,
        "https://www.w3.org/ns/activitystreams",
      ],
      id: "https://example.com/activities/preserve-raw",
      type: "Create",
      actor: "https://example.com/person2",
      ext: "preserve-me",
      object: {
        id: "https://example.com/notes/preserve-raw",
        type: "Note",
        attributedTo: "https://example.com/person2",
        content: "Hello, world!",
      },
    },
    rsaPrivateKey3,
    rsaPublicKey3.id!,
    { contextLoader: sourceContextLoader },
  );
  const response = await federation.fetch(
    new Request("https://example.com/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body: JSON.stringify(signed),
    }),
    { contextData: undefined },
  );
  assertEquals([response.status, await response.text()], [202, ""]);
  assertEquals(receivedRaw, signed);
  assertNotEquals(
    receivedRaw,
    await compactJsonLd(signed, sourceContextLoader),
  );
  const delivered = receivedTyped;
  assert(delivered != null);
  assertEquals(
    (delivered as Create).id?.href,
    "https://example.com/activities/preserve-raw",
  );
});

test("Federation.setInboxDispatcher()", async (t) => {
  const kv = new MemoryKvStore();

  await t.step("path match", () => {
    const federation = createFederation<void>({
      kv,
      documentLoaderFactory: () => mockDocumentLoader,
    });
    federation.setInboxListeners("/users/{identifier}/inbox");
    assertThrows(
      () =>
        federation.setInboxDispatcher(
          "/users/{identifier}/inbox2",
          () => ({ items: [] }),
        ),
      RouterError,
    );
  });

  await t.step("path match", () => {
    const federation = createFederation<void>({
      kv,
      documentLoaderFactory: () => mockDocumentLoader,
    });
    federation.setInboxListeners("/users/{identifier}/inbox");
    federation.setInboxDispatcher(
      "/users/{identifier}/inbox",
      () => ({ items: [] }),
    );
  });

  await t.step("wrong variables in path", () => {
    const federation = createFederation<void>({
      kv,
      documentLoaderFactory: () => mockDocumentLoader,
    });
    assertThrows(
      () =>
        federation.setInboxDispatcher(
          "/users/inbox" as `${string}{identifier}${string}`,
          () => ({ items: [] }),
        ),
      RouterError,
    );
    assertThrows(
      () =>
        federation.setInboxDispatcher(
          "/users/{identifier}/inbox/{identifier2}",
          () => ({ items: [] }),
        ),
      RouterError,
    );
    assertThrows(
      () =>
        federation.setInboxDispatcher(
          "/users/{identifier2}/inbox" as `${string}{identifier}${string}`,
          () => ({ items: [] }),
        ),
      RouterError,
    );
  });
});

test("FederationImpl.sendActivity()", async (t) => {
  fetchMock.spyGlobal();

  let verified: ("http" | "ld" | "proof")[] | null = null;
  let request: Request | null = null;
  fetchMock.post("https://example.com/inbox", async (cl) => {
    verified = [];
    request = cl.request!.clone() as Request;
    const options = {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
    };
    let json = await cl.request!.json();
    if (await verifyJsonLd(json, options)) verified.push("ld");
    json = detachSignature(json);
    let activity = await verifyObject(vocab.Activity, json, options);
    if (activity == null) {
      activity = await vocab.Activity.fromJsonLd(json, options);
    } else {
      verified.push("proof");
    }
    const key = await verifyRequest(request, options);
    if (key != null && await doesActorOwnKey(activity, key, options)) {
      verified.push("http");
    }
    if (verified.length > 0) return new Response(null, { status: 202 });
    return new Response(null, { status: 401 });
  });

  const kv = new MemoryKvStore();
  const federation = new FederationImpl<void>({
    kv,
    contextLoaderFactory: () => mockDocumentLoader,
  });
  const context = federation.createContext(new URL("https://example.com/"));

  await t.step("success", async () => {
    const activity = new vocab.Create({
      id: new URL("https://example.com/activity/1"),
      actor: new URL("https://example.com/person"),
    });
    const inboxes = {
      "https://example.com/inbox": {
        actorIds: ["https://example.com/recipient"],
        sharedInbox: false,
      },
    };
    await federation.sendActivity(
      [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
      inboxes,
      activity,
      { context },
    );
    assertEquals(verified, ["http"]);
    assertInstanceOf(request, Request);
    assertEquals(request?.method, "POST");
    assertEquals(request?.url, "https://example.com/inbox");
    assertEquals(
      request?.headers.get("Content-Type"),
      "application/activity+json",
    );

    verified = null;
    await federation.sendActivity(
      [{ privateKey: rsaPrivateKey3, keyId: rsaPublicKey3.id! }],
      inboxes,
      activity.clone({
        actor: new URL("https://example.com/person2"),
        tos: [vocab.PUBLIC_COLLECTION],
      }),
      { context },
    );
    assertEquals(verified, ["ld", "http"]);
    const posted = await request?.json() as Record<string, unknown>;
    assertEquals(
      posted?.to,
      vocab.PUBLIC_COLLECTION.href,
    );

    verified = null;
    await federation.sendActivity(
      [{ privateKey: rsaPrivateKey3, keyId: rsaPublicKey3.id! }],
      inboxes,
      new vocab.Create({
        id: new URL("https://example.com/activity/attachment"),
        actor: new URL("https://example.com/person2"),
        object: new vocab.Note({
          id: new URL("https://example.com/note/attachment"),
          attachments: [
            new vocab.Document({
              mediaType: "image/png",
              url: new URL("https://example.com/image.png"),
            }),
          ],
        }),
      }),
      { context },
    );
    assertEquals(verified, ["ld", "http"]);
    const postedWithAttachment = await request?.json() as Record<
      string,
      unknown
    >;
    const postedObject = postedWithAttachment.object as Record<
      string,
      unknown
    >;
    assertEquals(Array.isArray(postedObject.attachment), true);

    verified = null;
    await federation.sendActivity(
      [{ privateKey: rsaPrivateKey3, keyId: rsaPublicKey3.id! }],
      inboxes,
      activity.clone({
        actor: new URL("https://example.com/person2"),
      }),
      { context },
    );
    assertEquals(verified, ["ld", "http"]);
    assertInstanceOf(request, Request);
    assertEquals(request?.method, "POST");
    assertEquals(request?.url, "https://example.com/inbox");
    assertEquals(
      request?.headers.get("Content-Type"),
      "application/activity+json",
    );

    verified = null;
    await federation.sendActivity(
      [
        { privateKey: ed25519PrivateKey, keyId: ed25519Multikey.id! },
      ],
      inboxes,
      activity.clone({
        actor: new URL("https://example.com/person2"),
      }),
      { context },
    );
    assertEquals(verified, ["proof"]);
    assertInstanceOf(request, Request);
    assertEquals(request?.method, "POST");
    assertEquals(request?.url, "https://example.com/inbox");
    assertEquals(
      request?.headers.get("Content-Type"),
      "application/activity+json",
    );

    const preSignedActivity = new vocab.Create({
      id: new URL("https://example.com/activity/pre-signed-attachment"),
      actor: new URL("https://example.com/person2"),
      object: new vocab.Note({
        id: new URL("https://example.com/note/pre-signed-attachment"),
        attachments: [
          new vocab.Document({
            mediaType: "image/png",
            url: new URL("https://example.com/pre-signed-image.png"),
          }),
        ],
      }),
    });
    const preSignedJson = await preSignedActivity.toJsonLd({
      format: "compact",
      contextLoader: mockDocumentLoader,
    }) as Record<string, unknown>;
    const preSignedObject = preSignedJson.object as Record<string, unknown>;
    assertEquals(Array.isArray(preSignedObject.attachment), false);
    const created = Temporal.Now.instant();
    const proofConfig = {
      "@context": preSignedJson["@context"],
      type: "DataIntegrityProof",
      cryptosuite: "eddsa-jcs-2022",
      verificationMethod: ed25519Multikey.id!.href,
      proofPurpose: "assertionMethod",
      created: created.toString(),
    };
    const encoder = new TextEncoder();
    const proofDigest = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(serialize(proofConfig)),
    );
    const msgDigest = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(serialize(preSignedJson)),
    );
    const digest = new Uint8Array(
      proofDigest.byteLength + msgDigest.byteLength,
    );
    digest.set(new Uint8Array(proofDigest), 0);
    digest.set(new Uint8Array(msgDigest), proofDigest.byteLength);
    const proofValue = new Uint8Array(
      await crypto.subtle.sign("Ed25519", ed25519PrivateKey, digest),
    );
    verified = null;
    await federation.sendActivity(
      [
        { privateKey: ed25519PrivateKey, keyId: ed25519Multikey.id! },
      ],
      inboxes,
      preSignedActivity.clone({
        proofs: [
          new vocab.DataIntegrityProof({
            cryptosuite: "eddsa-jcs-2022",
            verificationMethod: ed25519Multikey.id!,
            proofPurpose: "assertionMethod",
            proofValue,
            created,
          }),
        ],
      }),
      { context },
    );
    assertEquals(verified, ["proof"]);
    const postedPreSigned = await request?.json() as Record<string, unknown>;
    const postedPreSignedObject = postedPreSigned.object as Record<
      string,
      unknown
    >;
    assertEquals(Array.isArray(postedPreSignedObject.attachment), false);

    verified = null;
    await federation.sendActivity(
      [
        { privateKey: rsaPrivateKey3, keyId: rsaPublicKey3.id! },
        { privateKey: ed25519PrivateKey, keyId: ed25519Multikey.id! },
      ],
      inboxes,
      activity.clone({
        actor: new URL("https://example.com/person2"),
      }),
      { context },
    );
    assertEquals(verified, ["ld", "proof", "http"]);
    assertInstanceOf(request, Request);
    assertEquals(request?.method, "POST");
    assertEquals(request?.url, "https://example.com/inbox");
    assertEquals(
      request?.headers.get("Content-Type"),
      "application/activity+json",
    );
  });

  fetchMock.hardReset();
});

test("FederationImpl.processQueuedTask()", async (t) => {
  await t.step("with MessageQueue having nativeRetrial", async () => {
    const kv = new MemoryKvStore();
    const queuedMessages: Message[] = [];
    const queue: MessageQueue = {
      nativeRetrial: true,
      enqueue(message, _options) {
        queuedMessages.push(message);
        return Promise.resolve();
      },
      listen(_handler, _options) {
        return Promise.resolve();
      },
    };
    const federation = new FederationImpl<void>({
      kv,
      queue,
    });
    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
      .on(vocab.Create, () => {
        throw new Error("Intended error for testing");
      });

    // outbox message
    await assertRejects(
      () =>
        federation.processQueuedTask(
          undefined,
          {
            type: "outbox",
            id: crypto.randomUUID(),
            baseUrl: "https://example.com",
            keys: [],
            activity: {
              "@context": "https://www.w3.org/ns/activitystreams",
              type: "Create",
              actor: "https://example.com/users/alice",
              object: { type: "Note", content: "test" },
            },
            activityType: "https://www.w3.org/ns/activitystreams#Create",
            inbox: "https://invalid-domain-that-does-not-exist.example/inbox",
            sharedInbox: false,
            started: new Date().toISOString(),
            attempt: 0,
            headers: {},
            traceContext: {},
          } satisfies OutboxMessage,
        ),
      Error,
    );
    assertEquals(queuedMessages, []);

    // inbox message
    await assertRejects(
      () =>
        federation.processQueuedTask(
          undefined,
          {
            type: "inbox",
            id: crypto.randomUUID(),
            baseUrl: "https://example.com",
            activity: {
              "@context": "https://www.w3.org/ns/activitystreams",
              type: "Create",
              actor: "https://remote.example/users/alice",
              object: {
                type: "Note",
                content: "Hello world",
              },
            },
            started: new Date().toISOString(),
            attempt: 0,
            identifier: null,
            traceContext: {},
          } satisfies InboxMessage,
        ),
      Error,
    );
    assertEquals(queuedMessages, []);
  });

  await t.step("with MessageQueue having no nativeRetrial", async () => {
    const kv = new MemoryKvStore();
    let queuedMessages: Message[] = [];
    const queue: MessageQueue = {
      enqueue(message, _options) {
        queuedMessages.push(message);
        return Promise.resolve();
      },
      listen(_handler, _options) {
        return Promise.resolve();
      },
    };
    const federation = new FederationImpl<void>({
      kv,
      queue,
    });
    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
      .on(vocab.Create, () => {
        throw new Error("Intended error for testing");
      });

    // outbox message
    const outboxMessage: OutboxMessage = {
      type: "outbox",
      id: crypto.randomUUID(),
      baseUrl: "https://example.com",
      keys: [],
      activity: {
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Create",
        actor: "https://example.com/users/alice",
        object: { type: "Note", content: "test" },
      },
      activityType: "https://www.w3.org/ns/activitystreams#Create",
      inbox: "https://invalid-domain-that-does-not-exist.example/inbox",
      sharedInbox: false,
      started: new Date().toISOString(),
      attempt: 0,
      headers: {},
      traceContext: {},
    };
    await federation.processQueuedTask(undefined, outboxMessage);
    assertEquals(queuedMessages, [{ ...outboxMessage, attempt: 1 }]);
    queuedMessages = [];

    // inbox message
    const inboxMessage: InboxMessage = {
      type: "inbox",
      id: crypto.randomUUID(),
      baseUrl: "https://example.com",
      activity: {
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Create",
        actor: "https://remote.example/users/alice",
        object: {
          type: "Note",
          content: "Hello world",
        },
      },
      started: new Date().toISOString(),
      attempt: 0,
      identifier: null,
      traceContext: {},
    };
    await federation.processQueuedTask(undefined, inboxMessage);
    assertEquals(queuedMessages, [{ ...inboxMessage, attempt: 1 }]);
  });

  await t.step(
    "records activitypub.outbox.activity retry on transient failure",
    async () => {
      const kv = new MemoryKvStore();
      const [meterProvider, recorder] = createTestMeterProvider();
      const queue: MessageQueue = {
        enqueue(_message, _options) {
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const federation = new FederationImpl<void>({
        kv,
        meterProvider,
        queue,
      });

      await federation.processQueuedTask(
        undefined,
        {
          type: "outbox",
          id: crypto.randomUUID(),
          baseUrl: "https://example.com",
          keys: [],
          activity: {
            "@context": "https://www.w3.org/ns/activitystreams",
            type: "Create",
            actor: "https://example.com/users/alice",
            object: { type: "Note", content: "test" },
          },
          activityType: "https://www.w3.org/ns/activitystreams#Create",
          inbox: "https://invalid-domain-that-does-not-exist.example/inbox",
          sharedInbox: false,
          started: new Date().toISOString(),
          attempt: 0,
          headers: {},
          traceContext: {},
        } satisfies OutboxMessage,
      );

      const outboxLifecycle = recorder.getMeasurements(
        "activitypub.outbox.activity",
      );
      assertEquals(outboxLifecycle.length, 1);
      assertEquals(outboxLifecycle[0].type, "counter");
      assertEquals(
        outboxLifecycle[0].attributes["activitypub.processing.result"],
        "retried",
      );
      assertEquals(
        outboxLifecycle[0].attributes["activitypub.activity.type"],
        "https://www.w3.org/ns/activitystreams#Create",
      );
    },
  );

  await t.step(
    "records activitypub.outbox.activity abandoned when retry policy gives up",
    async () => {
      const kv = new MemoryKvStore();
      const [meterProvider, recorder] = createTestMeterProvider();
      const queue: MessageQueue = {
        enqueue(_message, _options) {
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const federation = new FederationImpl<void>({
        kv,
        meterProvider,
        queue,
        outboxRetryPolicy: () => null,
      });

      await federation.processQueuedTask(
        undefined,
        {
          type: "outbox",
          id: crypto.randomUUID(),
          baseUrl: "https://example.com",
          keys: [],
          activity: {
            "@context": "https://www.w3.org/ns/activitystreams",
            type: "Follow",
            actor: "https://example.com/users/alice",
            object: "https://remote.example/users/bob",
          },
          activityType: "https://www.w3.org/ns/activitystreams#Follow",
          inbox: "https://invalid-domain-that-does-not-exist.example/inbox",
          sharedInbox: false,
          started: new Date().toISOString(),
          attempt: 0,
          headers: {},
          traceContext: {},
        } satisfies OutboxMessage,
      );

      const outboxLifecycle = recorder.getMeasurements(
        "activitypub.outbox.activity",
      );
      assertEquals(outboxLifecycle.length, 1);
      assertEquals(outboxLifecycle[0].type, "counter");
      assertEquals(
        outboxLifecycle[0].attributes["activitypub.processing.result"],
        "abandoned",
      );
      assertEquals(
        outboxLifecycle[0].attributes["activitypub.activity.type"],
        "https://www.w3.org/ns/activitystreams#Follow",
      );
    },
  );

  await t.step(
    "records activitypub.inbox.activity processed on successful queued dispatch",
    async () => {
      const kv = new MemoryKvStore();
      const [meterProvider, recorder] = createTestMeterProvider();
      const queue: MessageQueue = {
        enqueue(_message, _options) {
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const federation = new FederationImpl<void>({
        kv,
        meterProvider,
        queue,
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(vocab.Create, () => {});

      await federation.processQueuedTask(
        undefined,
        {
          type: "inbox",
          id: crypto.randomUUID(),
          baseUrl: "https://example.com",
          activity: {
            "@context": "https://www.w3.org/ns/activitystreams",
            type: "Create",
            id: "https://example.com/activities/queued-processed",
            actor: "https://remote.example/users/alice",
            object: { type: "Note", content: "Hello world" },
          },
          started: new Date().toISOString(),
          attempt: 0,
          identifier: null,
          traceContext: {},
        } satisfies InboxMessage,
      );

      const inboxLifecycle = recorder.getMeasurements(
        "activitypub.inbox.activity",
      );
      assertEquals(inboxLifecycle.length, 1);
      assertEquals(inboxLifecycle[0].type, "counter");
      assertEquals(
        inboxLifecycle[0].attributes["activitypub.processing.result"],
        "processed",
      );
      assertEquals(
        inboxLifecycle[0].attributes["activitypub.activity.type"],
        "https://www.w3.org/ns/activitystreams#Create",
      );
    },
  );

  await t.step(
    "records activitypub.inbox.activity retried on transient listener failure",
    async () => {
      const kv = new MemoryKvStore();
      const [meterProvider, recorder] = createTestMeterProvider();
      const queue: MessageQueue = {
        enqueue(_message, _options) {
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const federation = new FederationImpl<void>({
        kv,
        meterProvider,
        queue,
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(vocab.Create, () => {
          throw new Error("Intended error for testing");
        });

      await federation.processQueuedTask(
        undefined,
        {
          type: "inbox",
          id: crypto.randomUUID(),
          baseUrl: "https://example.com",
          activity: {
            "@context": "https://www.w3.org/ns/activitystreams",
            type: "Create",
            id: "https://example.com/activities/queued-retried",
            actor: "https://remote.example/users/alice",
            object: { type: "Note", content: "Hello world" },
          },
          started: new Date().toISOString(),
          attempt: 0,
          identifier: null,
          traceContext: {},
        } satisfies InboxMessage,
      );

      const inboxLifecycle = recorder.getMeasurements(
        "activitypub.inbox.activity",
      );
      assertEquals(inboxLifecycle.length, 1);
      assertEquals(
        inboxLifecycle[0].attributes["activitypub.processing.result"],
        "retried",
      );
      assertEquals(
        inboxLifecycle[0].attributes["activitypub.activity.type"],
        "https://www.w3.org/ns/activitystreams#Create",
      );
    },
  );

  await t.step(
    "records activitypub.inbox.activity abandoned when retry policy gives up",
    async () => {
      const kv = new MemoryKvStore();
      const [meterProvider, recorder] = createTestMeterProvider();
      const queue: MessageQueue = {
        enqueue(_message, _options) {
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const federation = new FederationImpl<void>({
        kv,
        meterProvider,
        queue,
        inboxRetryPolicy: () => null,
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(vocab.Create, () => {
          throw new Error("Intended error for testing");
        });

      await federation.processQueuedTask(
        undefined,
        {
          type: "inbox",
          id: crypto.randomUUID(),
          baseUrl: "https://example.com",
          activity: {
            "@context": "https://www.w3.org/ns/activitystreams",
            type: "Create",
            id: "https://example.com/activities/queued-abandoned",
            actor: "https://remote.example/users/alice",
            object: { type: "Note", content: "Hello world" },
          },
          started: new Date().toISOString(),
          attempt: 0,
          identifier: null,
          traceContext: {},
        } satisfies InboxMessage,
      );

      const inboxLifecycle = recorder.getMeasurements(
        "activitypub.inbox.activity",
      );
      assertEquals(inboxLifecycle.length, 1);
      assertEquals(
        inboxLifecycle[0].attributes["activitypub.processing.result"],
        "abandoned",
      );
      assertEquals(
        inboxLifecycle[0].attributes["activitypub.activity.type"],
        "https://www.w3.org/ns/activitystreams#Create",
      );
    },
  );

  await t.step("records queued inbox processing duration", async () => {
    const kv = new MemoryKvStore();
    const [meterProvider, recorder] = createTestMeterProvider();
    const queue: MessageQueue = {
      enqueue(_message, _options) {
        return Promise.resolve();
      },
      listen(_handler, _options) {
        return Promise.resolve();
      },
    };
    const federation = new FederationImpl<void>({
      kv,
      meterProvider,
      queue,
    });
    let handled = false;
    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
      .on(vocab.Create, () => {
        handled = true;
      });

    await federation.processQueuedTask(
      undefined,
      {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: {
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "Create",
          id: "https://remote.example/activities/1",
          actor: "https://remote.example/users/alice",
          object: {
            type: "Note",
            content: "Hello world",
          },
        },
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage,
    );

    assert(handled);
    const durations = recorder.getMeasurements(
      "activitypub.inbox.processing_duration",
    );
    assertEquals(durations.length, 1);
    assertEquals(
      durations[0].attributes["activitypub.activity.type"],
      "https://www.w3.org/ns/activitystreams#Create",
    );

    const started = recorder.getMeasurements("fedify.queue.task.started");
    assertEquals(started.length, 1);
    assertEquals(started[0].attributes["fedify.queue.role"], "inbox");

    const completed = recorder.getMeasurements("fedify.queue.task.completed");
    assertEquals(completed.length, 1);
    assertEquals(completed[0].attributes["fedify.queue.role"], "inbox");
    assertEquals(
      completed[0].attributes["fedify.queue.task.result"],
      "completed",
    );
    assertEquals(
      completed[0].attributes["activitypub.activity.type"],
      "https://www.w3.org/ns/activitystreams#Create",
    );

    assertEquals(
      recorder.getMeasurements("fedify.queue.task.failed").length,
      0,
    );

    const taskDurations = recorder.getMeasurements(
      "fedify.queue.task.duration",
    );
    assertEquals(taskDurations.length, 1);
    assertEquals(taskDurations[0].type, "histogram");
    assertEquals(taskDurations[0].attributes["fedify.queue.role"], "inbox");
    assertEquals(
      taskDurations[0].attributes["fedify.queue.task.result"],
      "completed",
    );

    const inFlight = recorder.getMeasurements("fedify.queue.task.in_flight");
    assertEquals(inFlight.length, 2);
    assertEquals(inFlight[0].type, "upDownCounter");
    assertEquals(inFlight[0].value, 1);
    assertEquals(inFlight[1].value, -1);
    // The increment and decrement attribute bags must match exactly so that
    // the in-flight gauge always nets to zero per attribute series.
    assertEquals(inFlight[0].attributes, inFlight[1].attributes);
    assertEquals(inFlight[0].attributes["fedify.queue.role"], "inbox");
    assertEquals(
      inFlight[0].attributes["activitypub.activity.type"],
      undefined,
    );
  });

  await t.step(
    "with restrictive context loader and normalized LD-signed inbox activity",
    async () => {
      const remoteContextUrl = "https://remote.example/contexts/ext";
      const sourceContextLoader = async (resource: string) => {
        const url = new URL(resource).href;
        if (url === remoteContextUrl) {
          return {
            contextUrl: null,
            documentUrl: url,
            document: {
              "@context": {
                ext: "https://example.com/ext",
              },
            },
          };
        }
        return await mockDocumentLoader(url);
      };
      const restrictiveContextLoader = async (resource: string) => {
        const url = new URL(resource).href;
        if (
          url === "https://www.w3.org/ns/activitystreams" ||
          url === "https://w3id.org/identity/v1"
        ) {
          return await mockDocumentLoader(url);
        }
        throw new Error(`Unexpected context: ${url}`);
      };
      const kv = new MemoryKvStore();
      let receivedCount = 0;
      let received: Create | null = null;
      let receivedRaw: unknown = null;
      const federation = new FederationImpl<void>({
        kv,
        contextLoaderFactory: () => restrictiveContextLoader,
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, (ctx, activity) => {
          receivedCount++;
          receivedRaw = (ctx as unknown as { activity: unknown }).activity;
          received = activity;
        });
      const signed = await signJsonLd(
        {
          "@context": [
            remoteContextUrl,
            "https://www.w3.org/ns/activitystreams",
          ],
          id: "https://remote.example/activities/1",
          type: "Create",
          actor: "https://remote.example/users/alice",
          ext: "preserve-me",
          object: {
            id: "https://remote.example/notes/1",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello, world!",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        { contextLoader: sourceContextLoader },
      );
      const normalizedActivity = await compactJsonLd(
        signed,
        sourceContextLoader,
      );
      const messageId = crypto.randomUUID();
      await federation.processQueuedTask(
        undefined,
        {
          type: "inbox",
          id: messageId,
          baseUrl: "https://example.com",
          activity: signed,
          normalizedActivity,
          started: new Date().toISOString(),
          attempt: 0,
          identifier: null,
          traceContext: {},
        } satisfies InboxMessage,
      );
      const delivered = received;
      assert(delivered != null);
      const deliveredCreate = delivered as Create;
      assertInstanceOf(deliveredCreate, Create);
      assertEquals(
        deliveredCreate.id?.href,
        "https://remote.example/activities/1",
      );
      assertEquals(receivedRaw, signed);
      await federation.processQueuedTask(
        undefined,
        {
          type: "inbox",
          id: messageId,
          baseUrl: "https://example.com",
          activity: signed,
          normalizedActivity,
          started: new Date().toISOString(),
          attempt: 0,
          identifier: null,
          traceContext: {},
        } satisfies InboxMessage,
      );
      assertEquals(receivedCount, 1);
    },
  );

  await t.step(
    "cached normalizedActivity is rechecked for unsafe JSON-LD keywords",
    async () => {
      const queuedMessages: Message[] = [];
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      let receivedCount = 0;
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          receivedCount++;
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: "https://remote.example/activities/unsafe-normalized-cache",
          type: "Create",
          actor: "https://remote.example/users/alice",
          object: {
            id: "https://remote.example/notes/unsafe-normalized-cache",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from unsafe normalized cache",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        { contextLoader: mockDocumentLoader },
      );
      const normalizedActivity = await compactJsonLd(
        signed,
        mockDocumentLoader,
      );
      const tamperedNormalizedActivity = {
        ...(normalizedActivity as Record<string, unknown>),
        signature: {
          ...((normalizedActivity as { signature: Record<string, unknown> })
            .signature),
          "@included": [
            {
              id: "https://remote.example/activities/inside-signature",
              type: "Undo",
            },
          ],
        },
      };
      await federation.processQueuedTask(
        undefined,
        {
          type: "inbox",
          id: crypto.randomUUID(),
          baseUrl: "https://example.com",
          activity: signed,
          normalizedActivity: tamperedNormalizedActivity,
          ldSignatureVerified: false,
          started: new Date().toISOString(),
          attempt: 0,
          identifier: null,
          traceContext: {},
        } satisfies InboxMessage,
      );
      assertEquals(receivedCount, 0);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, []);
    },
  );

  await t.step(
    "old queued LDS inbox messages without normalizedActivity still work",
    async () => {
      const restrictiveContextLoader = async (resource: string) => {
        const url = new URL(resource).href;
        if (
          url === "https://www.w3.org/ns/activitystreams" ||
          url === "https://w3id.org/identity/v1"
        ) {
          return await mockDocumentLoader(url);
        }
        throw new Error(`Unexpected context: ${url}`);
      };
      const kv = new MemoryKvStore();
      let received: Create | null = null;
      const federation = new FederationImpl<void>({
        kv,
        contextLoaderFactory: () => restrictiveContextLoader,
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, (_ctx, activity) => {
          received = activity;
        });
      const compacted = await compactJsonLd(
        await signJsonLd(
          {
            "@context": "https://www.w3.org/ns/activitystreams",
            id: "https://remote.example/activities/legacy",
            type: "Create",
            actor: "https://remote.example/users/alice",
            object: {
              id: "https://remote.example/notes/legacy",
              type: "Note",
              attributedTo: "https://remote.example/users/alice",
              content: "Hello from legacy queue",
            },
          },
          rsaPrivateKey3,
          rsaPublicKey3.id!,
          { contextLoader: mockDocumentLoader },
        ),
        restrictiveContextLoader,
      );
      await federation.processQueuedTask(
        undefined,
        {
          type: "inbox",
          id: crypto.randomUUID(),
          baseUrl: "https://example.com",
          activity: compacted,
          started: new Date().toISOString(),
          attempt: 0,
          identifier: null,
          traceContext: {},
        } satisfies InboxMessage,
      );
      assert(received != null);
      assertEquals(
        (received as Create).id?.href,
        "https://remote.example/activities/legacy",
      );
    },
  );

  await t.step(
    "queued signature-bearing non-LDS inbox messages keep parse-time normalization contexts",
    async () => {
      const signingContextLoader = async (resource: string) => {
        const url = new URL(resource).href;
        if (
          url === "https://www.w3.org/ns/activitystreams" ||
          url === "https://w3id.org/identity/v1" ||
          url === "https://w3id.org/security/v1" ||
          url === "https://w3id.org/security/data-integrity/v1"
        ) {
          return await mockDocumentLoader(url);
        }
        throw new Error(`Unexpected context: ${url}`);
      };
      const processingContextLoader = async (resource: string) => {
        const url = new URL(resource).href;
        if (
          url === "https://w3id.org/identity/v1" ||
          url === "https://w3id.org/security/v1" ||
          url === "https://w3id.org/security/data-integrity/v1"
        ) {
          throw new Error(
            "queued non-LDS signed payloads should parse with the normalization loader's built-in signature contexts",
          );
        }
        return await signingContextLoader(resource);
      };
      const kv = new MemoryKvStore();
      let received: Create | null = null;
      let receivedRaw: unknown = null;
      const federation = new FederationImpl<void>({
        kv,
        contextLoaderFactory: () => processingContextLoader,
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, (ctx, activity) => {
          receivedRaw = (ctx as unknown as { activity: unknown }).activity;
          received = activity;
        });
      const signed = await signJsonLd(
        {
          "@context": [
            "https://www.w3.org/ns/activitystreams",
            "https://w3id.org/security/v1",
          ],
          id: "https://remote.example/activities/non-lds-queued-signature",
          type: "Create",
          actor: "https://remote.example/users/alice",
          object: {
            id: "https://remote.example/notes/non-lds-queued-signature",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from non-LDS queued signature",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        { contextLoader: signingContextLoader },
      );
      const signedPayload = signed as Record<string, unknown>;
      assert(
        Array.isArray(signedPayload["@context"]) &&
          signedPayload["@context"].includes("https://w3id.org/security/v1"),
      );
      await federation.processQueuedTask(
        undefined,
        {
          type: "inbox",
          id: crypto.randomUUID(),
          baseUrl: "https://example.com",
          activity: signed,
          ldSignatureVerified: false,
          started: new Date().toISOString(),
          attempt: 0,
          identifier: null,
          traceContext: {},
        } satisfies InboxMessage,
      );
      if (received == null) throw new Error("Inbox activity not delivered.");
      const delivered = received as Create;
      assertEquals(
        delivered.id?.href,
        "https://remote.example/activities/non-lds-queued-signature",
      );
      assertEquals(receivedRaw, signed);
    },
  );

  await t.step(
    "queued signature-bearing non-LDS inbox messages reuse normalizedActivity for custom contexts",
    async () => {
      const remoteContextUrl = "https://remote.example/contexts/ext";
      const sourceContextLoader = async (resource: string) => {
        const url = new URL(resource).href;
        if (url === remoteContextUrl) {
          return {
            contextUrl: null,
            documentUrl: url,
            document: {
              "@context": {
                ext: "https://example.com/ext",
              },
            },
          };
        }
        return await mockDocumentLoader(url);
      };
      const restrictiveContextLoader = async (resource: string) => {
        const url = new URL(resource).href;
        if (
          url === "https://www.w3.org/ns/activitystreams" ||
          url === "https://w3id.org/identity/v1"
        ) {
          return await mockDocumentLoader(url);
        }
        throw new Error(`Unexpected context: ${url}`);
      };
      const kv = new MemoryKvStore();
      let received: Create | null = null;
      let receivedRaw: unknown = null;
      const federation = new FederationImpl<void>({
        kv,
        contextLoaderFactory: () => restrictiveContextLoader,
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, (ctx, activity) => {
          receivedRaw = (ctx as unknown as { activity: unknown }).activity;
          received = activity;
        });
      const unsignedBody = {
        "@context": [
          remoteContextUrl,
          "https://www.w3.org/ns/activitystreams",
          "https://w3id.org/security/v1",
        ],
        id: "https://remote.example/activities/non-lds-queued-custom-context",
        type: "Create",
        actor: "https://remote.example/users/alice",
        ext: "preserve-me",
        object: {
          id: "https://remote.example/notes/non-lds-queued-custom-context",
          type: "Note",
          attributedTo: "https://remote.example/users/alice",
          content: "Hello from non-LDS queued custom context",
        },
        signature: {
          type: "RsaSignature2017",
          creator: "not a url",
          created: "2024-09-12T16:50:46Z",
          signatureValue: "Zm9v",
        },
      };
      const normalizedActivity = await compactJsonLd(
        unsignedBody,
        sourceContextLoader,
      );
      await federation.processQueuedTask(
        undefined,
        {
          type: "inbox",
          id: crypto.randomUUID(),
          baseUrl: "https://example.com",
          activity: unsignedBody,
          normalizedActivity,
          ldSignatureVerified: false,
          started: new Date().toISOString(),
          attempt: 0,
          identifier: null,
          traceContext: {},
        } satisfies InboxMessage,
      );
      if (received == null) throw new Error("Inbox activity not delivered.");
      const delivered = received as Create;
      assertEquals(
        delivered.id?.href,
        "https://remote.example/activities/non-lds-queued-custom-context",
      );
      assertEquals(receivedRaw, unsignedBody);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages without normalizedActivity retry through worker error handling",
    async () => {
      const remoteContextUrl = "https://remote.example/contexts/ext";
      const restrictiveContextLoader = async (resource: string) => {
        const url = new URL(resource).href;
        if (
          url === "https://www.w3.org/ns/activitystreams" ||
          url === "https://w3id.org/identity/v1"
        ) {
          return await mockDocumentLoader(url);
        }
        throw new Error(`Unexpected context: ${url}`);
      };
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoaderFactory: () => restrictiveContextLoader,
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": [
            remoteContextUrl,
            "https://www.w3.org/ns/activitystreams",
          ],
          id: "https://remote.example/activities/legacy-raw",
          type: "Create",
          actor: "https://remote.example/users/alice",
          ext: "preserve-me",
          object: {
            id: "https://remote.example/notes/legacy-raw",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from raw legacy queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        {
          contextLoader: async (resource: string) => {
            const url = new URL(resource).href;
            if (url === remoteContextUrl) {
              return {
                contextUrl: null,
                documentUrl: url,
                document: {
                  "@context": {
                    ext: "https://example.com/ext",
                  },
                },
              };
            }
            return await mockDocumentLoader(url);
          },
        },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: signed,
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages.length, 1);
      const retried = queuedMessages[0] as InboxMessage;
      assertEquals(retried.attempt, 1);
      assertEquals(retried.activity, inboxMessage.activity);
    },
  );

  await t.step(
    "without inbox queue retriable inbox parse failures bubble to caller",
    async () => {
      const remoteContextUrl = "https://remote.example/contexts/ext";
      const sourceContextLoader = async (resource: string) => {
        const url = new URL(resource).href;
        if (url === remoteContextUrl) {
          return {
            contextUrl: null,
            documentUrl: url,
            document: {
              "@context": {
                ext: "https://example.com/ext",
              },
            },
          };
        }
        return await mockDocumentLoader(url);
      };
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv: new MemoryKvStore(),
        contextLoaderFactory: () => async (resource: string) => {
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          if (url === remoteContextUrl) {
            throw new Error(`Transient remote context failure: ${url}`);
          }
          throw new Error(`Unexpected context: ${url}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": [
            remoteContextUrl,
            "https://www.w3.org/ns/activitystreams",
          ],
          id: "https://remote.example/activities/manual-retry",
          type: "Create",
          actor: "https://remote.example/users/alice",
          ext: "preserve-me",
          object: {
            id: "https://remote.example/notes/manual-retry",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from manual retry queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        { contextLoader: sourceContextLoader },
      );
      await assertRejects(
        () =>
          federation.processQueuedTask(
            undefined,
            {
              type: "inbox",
              id: crypto.randomUUID(),
              baseUrl: "https://example.com",
              activity: signed,
              started: new Date().toISOString(),
              attempt: 0,
              identifier: null,
              traceContext: {},
            } satisfies InboxMessage,
          ),
        Error,
      );
      assertEquals(errorCount, 1);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages with transient InvalidUrl failures retry",
    async () => {
      const remoteContextUrl = "https://remote.example/contexts/ext";
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoaderFactory: () => async (resource: string) => {
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          if (url === remoteContextUrl) {
            const error = new Error(
              `Transient remote context failure: ${url}`,
            ) as Error & { details?: { code: string; url: string } };
            error.name = "jsonld.InvalidUrl";
            error.details = {
              code: "loading remote context failed",
              url,
            };
            throw error;
          }
          throw new Error(`Unexpected context: ${url}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": [
            remoteContextUrl,
            "https://www.w3.org/ns/activitystreams",
          ],
          id: "https://remote.example/activities/legacy-invalid-context",
          type: "Create",
          actor: "https://remote.example/users/alice",
          ext: "preserve-me",
          object: {
            id: "https://remote.example/notes/legacy-invalid-context",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from invalid legacy queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        {
          contextLoader: async (resource: string) => {
            const url = new URL(resource).href;
            if (url === remoteContextUrl) {
              return {
                contextUrl: null,
                documentUrl: url,
                document: {
                  "@context": {
                    ext: "https://example.com/ext",
                  },
                },
              };
            }
            return await mockDocumentLoader(url);
          },
        },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: signed,
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages.length, 1);
      const retried = queuedMessages[0] as InboxMessage;
      assertEquals(retried.attempt, 1);
      assertEquals(retried.activity, inboxMessage.activity);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages with opaque context ids retry",
    async () => {
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoaderFactory: () => async (resource: string) => {
          if (resource === "app-context") {
            const error = new Error(
              `Opaque context backend is unavailable: ${resource}`,
            ) as Error & { details?: { code: string; url: string } };
            error.name = "jsonld.InvalidUrl";
            error.details = {
              code: "loading remote context failed",
              url: resource,
            };
            throw error;
          }
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          throw new Error(`Unexpected context: ${resource}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: "https://remote.example/activities/legacy-malformed-context",
          type: "Create",
          actor: "https://remote.example/users/alice",
          object: {
            id: "https://remote.example/notes/legacy-malformed-context",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from malformed legacy queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        { contextLoader: mockDocumentLoader },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: {
          ...signed,
          "@context": [
            "app-context",
            "https://www.w3.org/ns/activitystreams",
          ],
        },
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, [{ ...inboxMessage, attempt: 1 }]);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages with Invalid URL TypeErrors retry",
    async () => {
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoaderFactory: () => async (resource: string) => {
          if (resource === "app:context") {
            throw new TypeError(`Invalid URL: ${resource}`);
          }
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          throw new Error(`Unexpected context: ${resource}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: "https://remote.example/activities/legacy-typeerror-invalid-url",
          type: "Create",
          actor: "https://remote.example/users/alice",
          object: {
            id: "https://remote.example/notes/legacy-typeerror-invalid-url",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from invalid-url typeerror queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        { contextLoader: mockDocumentLoader },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: {
          ...signed,
          "@context": [
            "app:context",
            "https://www.w3.org/ns/activitystreams",
          ],
        },
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages.length, 1);
      const retried = queuedMessages[0] as InboxMessage;
      assertEquals(retried.attempt, 1);
      assertEquals(retried.activity, inboxMessage.activity);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages with malformed absolute context refs do not retry",
    async () => {
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoaderFactory: () => async (resource: string) => {
          if (resource === "http:/[") {
            throw new TypeError(`Invalid URL: ${resource}`);
          }
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          throw new Error(`Unexpected context: ${resource}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": "https://www.w3.org/ns/activitystreams",
          id:
            "https://remote.example/activities/legacy-malformed-absolute-context",
          type: "Create",
          actor: "https://remote.example/users/alice",
          object: {
            id:
              "https://remote.example/notes/legacy-malformed-absolute-context",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from malformed absolute context queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        { contextLoader: mockDocumentLoader },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: {
          ...signed,
          "@context": [
            "http:/[",
            "https://www.w3.org/ns/activitystreams",
          ],
        },
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, []);
    },
  );

  await t.step(
    "malformed IRI fields are permanent queued inbox parse errors",
    async () => {
      const queuedMessages: Message[] = [];
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      await federation.processQueuedTask(
        undefined,
        {
          type: "inbox",
          id: crypto.randomUUID(),
          baseUrl: "https://example.com",
          activity: {
            "@context": "https://www.w3.org/ns/activitystreams",
            id: "http://[",
            type: "Create",
            actor: "https://remote.example/users/alice",
            object: {
              id: "https://remote.example/notes/invalid-iri",
              type: "Note",
              attributedTo: "https://remote.example/users/alice",
              content: "Hello from invalid IRI queue",
            },
          },
          started: new Date().toISOString(),
          attempt: 0,
          identifier: null,
          traceContext: {},
        } satisfies InboxMessage,
      );
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, []);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages with network-path context ids retry",
    async () => {
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoaderFactory: () => async (resource: string) => {
          if (resource === "//cdn.example/ctx") {
            const error = new Error(
              `Network-path context backend is unavailable: ${resource}`,
            ) as Error & { details?: { code: string; url: string } };
            error.name = "jsonld.InvalidUrl";
            error.details = {
              code: "loading remote context failed",
              url: resource,
            };
            throw error;
          }
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          throw new Error(`Unexpected context: ${resource}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: "https://remote.example/activities/legacy-network-path-context",
          type: "Create",
          actor: "https://remote.example/users/alice",
          object: {
            id: "https://remote.example/notes/legacy-network-path-context",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from network-path legacy queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        { contextLoader: mockDocumentLoader },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: {
          ...signed,
          "@context": [
            "//cdn.example/ctx",
            "https://www.w3.org/ns/activitystreams",
          ],
        },
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, [{ ...inboxMessage, attempt: 1 }]);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages with malformed network-path refs do not retry",
    async () => {
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoaderFactory: () => async (resource: string) => {
          if (resource === "//[") {
            const error = new Error(
              `Malformed network-path context: ${resource}`,
            ) as Error & { details?: { code: string; url: string } };
            error.name = "jsonld.InvalidUrl";
            error.details = {
              code: "loading remote context failed",
              url: resource,
            };
            throw error;
          }
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          throw new Error(`Unexpected context: ${resource}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": "https://www.w3.org/ns/activitystreams",
          id:
            "https://remote.example/activities/legacy-malformed-network-path-context",
          type: "Create",
          actor: "https://remote.example/users/alice",
          object: {
            id:
              "https://remote.example/notes/legacy-malformed-network-path-context",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from malformed network-path legacy queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        { contextLoader: mockDocumentLoader },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: {
          ...signed,
          "@context": [
            "//[",
            "https://www.w3.org/ns/activitystreams",
          ],
        },
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, []);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages with malformed context URLs do not retry",
    async () => {
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoaderFactory: () => async (resource: string) => {
          if (resource === "not a url") {
            const error = new Error(
              `Invalid remote context URL: ${resource}`,
            ) as Error & { details?: { code: string; url: string } };
            error.name = "jsonld.InvalidUrl";
            error.details = {
              code: "loading remote context failed",
              url: resource,
            };
            throw error;
          }
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          throw new Error(`Unexpected context: ${resource}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: "https://remote.example/activities/legacy-malformed-context",
          type: "Create",
          actor: "https://remote.example/users/alice",
          object: {
            id: "https://remote.example/notes/legacy-malformed-context",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from malformed legacy queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        { contextLoader: mockDocumentLoader },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: {
          ...signed,
          "@context": [
            "not a url",
            "https://www.w3.org/ns/activitystreams",
          ],
        },
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, []);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages with invalid percent escapes do not retry",
    async () => {
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoaderFactory: () => async (resource: string) => {
          if (resource === "foo%zz") {
            const error = new Error(
              `Invalid remote context URL: ${resource}`,
            ) as Error & { details?: { code: string; url: string } };
            error.name = "jsonld.InvalidUrl";
            error.details = {
              code: "loading remote context failed",
              url: resource,
            };
            throw error;
          }
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          throw new Error(`Unexpected context: ${resource}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": "https://www.w3.org/ns/activitystreams",
          id:
            "https://remote.example/activities/legacy-malformed-percent-context",
          type: "Create",
          actor: "https://remote.example/users/alice",
          object: {
            id: "https://remote.example/notes/legacy-malformed-percent-context",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from malformed percent legacy queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        { contextLoader: mockDocumentLoader },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: {
          ...signed,
          "@context": [
            "foo%zz",
            "https://www.w3.org/ns/activitystreams",
          ],
        },
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, []);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages with invalid remote contexts do not retry",
    async () => {
      const remoteContextUrl = "https://remote.example/contexts/ext";
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoaderFactory: () => async (resource: string) => {
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          if (url === remoteContextUrl) {
            return {
              contextUrl: null,
              documentUrl: url,
              document: ["not", "an", "object"],
            };
          }
          throw new Error(`Unexpected context: ${url}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": [
            remoteContextUrl,
            "https://www.w3.org/ns/activitystreams",
          ],
          id: "https://remote.example/activities/legacy-invalid-remote-context",
          type: "Create",
          actor: "https://remote.example/users/alice",
          ext: "preserve-me",
          object: {
            id: "https://remote.example/notes/legacy-invalid-remote-context",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from invalid remote context queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        {
          contextLoader: async (resource: string) => {
            const url = new URL(resource).href;
            if (url === remoteContextUrl) {
              return {
                contextUrl: null,
                documentUrl: url,
                document: {
                  "@context": {
                    ext: "https://example.com/ext",
                  },
                },
              };
            }
            return await mockDocumentLoader(url);
          },
        },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: signed,
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, []);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages with string remote contexts retry",
    async () => {
      const remoteContextUrl = "https://remote.example/contexts/ext";
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoaderFactory: () => async (resource: string) => {
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          if (url === remoteContextUrl) {
            return {
              contextUrl: null,
              documentUrl: url,
              document: "{not valid json",
            };
          }
          throw new Error(`Unexpected context: ${url}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": [
            remoteContextUrl,
            "https://www.w3.org/ns/activitystreams",
          ],
          id: "https://remote.example/activities/legacy-string-remote-context",
          type: "Create",
          actor: "https://remote.example/users/alice",
          ext: "preserve-me",
          object: {
            id: "https://remote.example/notes/legacy-string-remote-context",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from string remote context queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        {
          contextLoader: async (resource: string) => {
            const url = new URL(resource).href;
            if (url === remoteContextUrl) {
              return {
                contextUrl: null,
                documentUrl: url,
                document: {
                  "@context": {
                    ext: "https://example.com/ext",
                  },
                },
              };
            }
            return await mockDocumentLoader(url);
          },
        },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: signed,
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, [{ ...inboxMessage, attempt: 1 }]);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages with loader TypeErrors retry",
    async () => {
      const remoteContextUrl = "https://remote.example/contexts/ext";
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoaderFactory: () => async (resource: string) => {
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          if (url === remoteContextUrl) {
            throw new TypeError(
              `Cannot initialize remote context loader: ${url}`,
            );
          }
          throw new Error(`Unexpected context: ${url}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": [
            remoteContextUrl,
            "https://www.w3.org/ns/activitystreams",
          ],
          id: "https://remote.example/activities/legacy-typeerror-context",
          type: "Create",
          actor: "https://remote.example/users/alice",
          ext: "preserve-me",
          object: {
            id: "https://remote.example/notes/legacy-typeerror-context",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from typeerror legacy queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        {
          contextLoader: async (resource: string) => {
            const url = new URL(resource).href;
            if (url === remoteContextUrl) {
              return {
                contextUrl: null,
                documentUrl: url,
                document: {
                  "@context": {
                    ext: "https://example.com/ext",
                  },
                },
              };
            }
            return await mockDocumentLoader(url);
          },
        },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: signed,
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, [{ ...inboxMessage, attempt: 1 }]);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages with syntax errors in remote contexts retry",
    async () => {
      const remoteContextUrl = "https://remote.example/contexts/ext";
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoaderFactory: () => async (resource: string) => {
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          if (url === remoteContextUrl) {
            const error = new Error(
              `Transient syntax failure: ${url}`,
            ) as Error & { details?: { code: string } };
            error.name = "jsonld.SyntaxError";
            error.details = { code: "loading remote context failed" };
            throw error;
          }
          throw new Error(`Unexpected context: ${url}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": [
            remoteContextUrl,
            "https://www.w3.org/ns/activitystreams",
          ],
          id: "https://remote.example/activities/legacy-syntax-context",
          type: "Create",
          actor: "https://remote.example/users/alice",
          ext: "preserve-me",
          object: {
            id: "https://remote.example/notes/legacy-syntax-context",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from syntax legacy queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        {
          contextLoader: async (resource: string) => {
            const url = new URL(resource).href;
            if (url === remoteContextUrl) {
              return {
                contextUrl: null,
                documentUrl: url,
                document: {
                  "@context": {
                    ext: "https://example.com/ext",
                  },
                },
              };
            }
            return await mockDocumentLoader(url);
          },
        },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: signed,
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, [{ ...inboxMessage, attempt: 1 }]);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages with loader RangeErrors retry",
    async () => {
      const remoteContextUrl = "https://remote.example/contexts/ext";
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoaderFactory: () => async (resource: string) => {
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          if (url === remoteContextUrl) {
            throw new RangeError(
              `Temporary remote context cache window exceeded: ${url}`,
            );
          }
          throw new Error(`Unexpected context: ${url}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": [
            remoteContextUrl,
            "https://www.w3.org/ns/activitystreams",
          ],
          id: "https://remote.example/activities/legacy-rangeerror-context",
          type: "Create",
          actor: "https://remote.example/users/alice",
          ext: "preserve-me",
          object: {
            id: "https://remote.example/notes/legacy-rangeerror-context",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from rangeerror legacy queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        {
          contextLoader: async (resource: string) => {
            const url = new URL(resource).href;
            if (url === remoteContextUrl) {
              return {
                contextUrl: null,
                documentUrl: url,
                document: {
                  "@context": {
                    ext: "https://example.com/ext",
                  },
                },
              };
            }
            return await mockDocumentLoader(url);
          },
        },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: signed,
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, [{ ...inboxMessage, attempt: 1 }]);
    },
  );

  await t.step(
    "permanent queued inbox parse errors do not re-enqueue poison messages",
    async () => {
      const queuedMessages: Message[] = [];
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      await federation.processQueuedTask(
        undefined,
        {
          type: "inbox",
          id: crypto.randomUUID(),
          baseUrl: "https://example.com",
          activity: {
            "@context": "https://www.w3.org/ns/activitystreams",
            id: "https://remote.example/objects/not-an-activity",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Not an activity",
          },
          started: new Date().toISOString(),
          attempt: 0,
          identifier: null,
          traceContext: {},
        } satisfies InboxMessage,
      );
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, []);
    },
  );

  await t.step(
    "malformed Temporal fields are permanent queued inbox parse errors",
    async () => {
      const queuedMessages: Message[] = [];
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        documentLoaderFactory: () => mockDocumentLoader,
        contextLoaderFactory: () => mockDocumentLoader,
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      await federation.processQueuedTask(
        undefined,
        {
          type: "inbox",
          id: crypto.randomUUID(),
          baseUrl: "https://example.com",
          activity: {
            "@context": [
              "https://www.w3.org/ns/activitystreams",
              "https://w3id.org/security/data-integrity/v1",
            ],
            id: "https://remote.example/activities/invalid-proof-created",
            type: "Create",
            actor: "https://remote.example/users/alice",
            object: {
              id: "https://remote.example/notes/invalid-proof-created",
              type: "Note",
              attributedTo: "https://remote.example/users/alice",
              content: "Hello, world!",
            },
            proof: {
              type: "DataIntegrityProof",
              cryptosuite: "eddsa-jcs-2022",
              verificationMethod:
                "https://remote.example/users/alice#ed25519-key",
              proofPurpose: "assertionMethod",
              created: { "@value": "not-a-date" },
              proofValue:
                "zLaewdp4H9kqtwyrLatK4cjY5oRHwVcw4gibPSUDYDMhi4M49v8pcYk3ZB6D69dNpAPbUmY8ocuJ3m9KhKJEEg7z",
            },
          },
          started: new Date().toISOString(),
          attempt: 0,
          identifier: null,
          traceContext: {},
        } satisfies InboxMessage,
      );
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, []);
    },
  );
});

test("FederationImpl.processQueuedTask() permanent failure", async (t) => {
  fetchMock.spyGlobal();

  fetchMock.post("https://gone.example/inbox", {
    status: 410,
    body: "Gone",
  });
  fetchMock.post("https://notfound.example/inbox", {
    status: 404,
    body: "Not Found",
  });
  fetchMock.post("https://error.example/inbox", {
    status: 500,
    body: "Internal Server Error",
  });
  fetchMock.post("https://legal.example/inbox", {
    status: 451,
    body: "Unavailable For Legal Reasons",
  });

  interface PermanentFailureSetup {
    federation: FederationImpl<void>;
    queuedMessages: Message[];
  }

  function setup(
    options: {
      permanentFailureStatusCodes?: readonly number[];
      nativeRetrial?: boolean;
      meterProvider?: ConstructorParameters<typeof FederationImpl<void>>[0][
        "meterProvider"
      ];
      tracerProvider?: ConstructorParameters<typeof FederationImpl<void>>[0][
        "tracerProvider"
      ];
    } = {},
  ): PermanentFailureSetup {
    const kv = new MemoryKvStore();
    const queuedMessages: Message[] = [];
    const queue: MessageQueue = {
      ...(options.nativeRetrial ? { nativeRetrial: true } : {}),
      enqueue(message, _options) {
        queuedMessages.push(message);
        return Promise.resolve();
      },
      listen(_handler, _options) {
        return Promise.resolve();
      },
    };
    const federation = new FederationImpl<void>({
      kv,
      queue,
      ...(options.permanentFailureStatusCodes
        ? { permanentFailureStatusCodes: options.permanentFailureStatusCodes }
        : {}),
      ...(options.meterProvider
        ? { meterProvider: options.meterProvider }
        : {}),
      ...(options.tracerProvider
        ? { tracerProvider: options.tracerProvider }
        : {}),
    });
    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");
    return { federation, queuedMessages };
  }

  function createOutboxMessage(
    inbox: string,
    activityId: string,
    actorIds?: string[],
  ): OutboxMessage {
    return {
      type: "outbox",
      id: crypto.randomUUID(),
      baseUrl: "https://example.com",
      keys: [],
      activity: {
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Create",
        id: activityId,
        actor: "https://example.com/users/alice",
        object: { type: "Note", content: "test" },
      },
      activityType: "https://www.w3.org/ns/activitystreams#Create",
      inbox,
      sharedInbox: false,
      ...(actorIds != null ? { actorIds } : {}),
      started: new Date().toISOString(),
      attempt: 0,
      headers: {},
      traceContext: {},
    };
  }

  await t.step("410 Gone triggers permanent failure handler", async () => {
    const [meterProvider, recorder] = createTestMeterProvider();
    const [tracerProvider, exporter] = createTestTracerProvider();
    const { federation, queuedMessages } = setup({
      meterProvider,
      tracerProvider,
    });
    let handlerCalled = false;
    let handlerValues: Record<string, unknown> = {};
    federation.setOutboxPermanentFailureHandler((_ctx, values) => {
      handlerCalled = true;
      handlerValues = { ...values };
    });

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage(
        "https://gone.example/inbox",
        "https://example.com/activity/1",
        [
          "https://gone.example/users/bob",
          "https://gone.example/users/charlie",
        ],
      ),
    );
    assert(handlerCalled, "Permanent failure handler should be called");
    assertEquals(
      handlerValues.inbox,
      new URL("https://gone.example/inbox"),
    );
    assertEquals(handlerValues.statusCode, 410);
    assertInstanceOf(handlerValues.activity, vocab.Create);
    assertEquals(handlerValues.actorIds, [
      new URL("https://gone.example/users/bob"),
      new URL("https://gone.example/users/charlie"),
    ]);
    // Should NOT be re-enqueued for retry
    assertEquals(queuedMessages, []);

    const failures = recorder.getMeasurements(
      "activitypub.delivery.permanent_failure",
    );
    assertEquals(failures.length, 1);
    assertEquals(failures[0].value, 1);
    assertEquals(
      failures[0].attributes["activitypub.remote.host"],
      "gone.example",
    );
    assertEquals(
      failures[0].attributes["http.response.status_code"],
      410,
    );

    const abandoned = recorder.getMeasurements(
      "activitypub.outbox.activity",
    );
    assertEquals(abandoned.length, 1);
    assertEquals(
      abandoned[0].attributes["activitypub.processing.result"],
      "abandoned",
    );
    assertEquals(
      abandoned[0].attributes["activitypub.activity.type"],
      "https://www.w3.org/ns/activitystreams#Create",
    );

    const events = exporter.getEvents(
      "activitypub.outbox",
      "activitypub.delivery.failed",
    );
    assertEquals(events.length, 1);
    assertEquals(
      events[0].attributes?.["activitypub.remote.host"],
      "gone.example",
    );
    assertEquals(events[0].attributes?.["activitypub.delivery.attempt"], 0);
    assertEquals(
      events[0].attributes?.["activitypub.delivery.permanent_failure"],
      true,
    );
    assertEquals(events[0].attributes?.["http.response.status_code"], 410);
  });

  await t.step("404 Not Found triggers permanent failure handler", async () => {
    const { federation, queuedMessages } = setup();
    let handlerCalled = false;
    let handlerStatusCode = 0;
    federation.setOutboxPermanentFailureHandler((_ctx, values) => {
      handlerCalled = true;
      handlerStatusCode = values.statusCode;
    });

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage(
        "https://notfound.example/inbox",
        "https://example.com/activity/2",
        ["https://notfound.example/users/bob"],
      ),
    );
    assert(handlerCalled, "Permanent failure handler should be called");
    assertEquals(handlerStatusCode, 404);
    // Should NOT be re-enqueued for retry
    assertEquals(queuedMessages, []);
  });

  await t.step(
    "500 error does NOT trigger permanent failure handler",
    async () => {
      const { federation, queuedMessages } = setup();
      let handlerCalled = false;
      federation.setOutboxPermanentFailureHandler(() => {
        handlerCalled = true;
      });

      await federation.processQueuedTask(
        undefined,
        createOutboxMessage(
          "https://error.example/inbox",
          "https://example.com/activity/3",
          ["https://error.example/users/bob"],
        ),
      );
      assertFalse(
        handlerCalled,
        "Permanent failure handler should NOT be called",
      );
      // Should be re-enqueued for retry (normal retry behavior)
      assertEquals(queuedMessages.length, 1);
      assertEquals((queuedMessages[0] as OutboxMessage).attempt, 1);
    },
  );

  await t.step("custom permanentFailureStatusCodes", async () => {
    const { federation, queuedMessages } = setup({
      permanentFailureStatusCodes: [404, 410, 451],
    });
    let handlerCalled = false;
    let handlerStatusCode = 0;
    federation.setOutboxPermanentFailureHandler((_ctx, values) => {
      handlerCalled = true;
      handlerStatusCode = values.statusCode;
    });

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage(
        "https://legal.example/inbox",
        "https://example.com/activity/4",
        ["https://legal.example/users/bob"],
      ),
    );
    assert(handlerCalled, "Permanent failure handler should be called for 451");
    assertEquals(handlerStatusCode, 451);
    // Should NOT be re-enqueued for retry
    assertEquals(queuedMessages, []);
  });

  await t.step("handler exception is caught and logged", async () => {
    const { federation, queuedMessages } = setup();
    federation.setOutboxPermanentFailureHandler(() => {
      throw new Error("Handler error that should be ignored");
    });

    // Should not throw even though the handler throws
    await federation.processQueuedTask(
      undefined,
      createOutboxMessage(
        "https://gone.example/inbox",
        "https://example.com/activity/5",
        ["https://gone.example/users/bob"],
      ),
    );
    // Should NOT be re-enqueued for retry
    assertEquals(queuedMessages, []);
  });

  await t.step(
    "permanent failure skips retry without handler registered",
    async () => {
      const { federation, queuedMessages } = setup();
      // No handler registered

      await federation.processQueuedTask(
        undefined,
        createOutboxMessage(
          "https://gone.example/inbox",
          "https://example.com/activity/6",
          [],
        ),
      );
      // Should NOT be re-enqueued for retry even without a handler
      assertEquals(queuedMessages, []);
    },
  );

  await t.step(
    "nativeRetrial: permanent failure does not re-throw",
    async () => {
      const { federation, queuedMessages } = setup({
        nativeRetrial: true,
      });
      let handlerCalled = false;
      federation.setOutboxPermanentFailureHandler(() => {
        handlerCalled = true;
      });

      // Should NOT throw (unlike non-permanent failures with nativeRetrial)
      await federation.processQueuedTask(
        undefined,
        createOutboxMessage(
          "https://gone.example/inbox",
          "https://example.com/activity/7",
          ["https://gone.example/users/bob"],
        ),
      );
      assert(handlerCalled, "Permanent failure handler should be called");
      assertEquals(queuedMessages, []);
    },
  );

  await t.step(
    "actorIds missing from message defaults to empty array",
    async () => {
      const { federation, queuedMessages } = setup();
      let handlerActorIds: readonly URL[] = [];
      federation.setOutboxPermanentFailureHandler((_ctx, values) => {
        handlerActorIds = values.actorIds;
      });

      await federation.processQueuedTask(
        undefined,
        // No actorIds field (simulating old message format)
        createOutboxMessage(
          "https://gone.example/inbox",
          "https://example.com/activity/8",
        ),
      );
      assertEquals(handlerActorIds, []);
      assertEquals(queuedMessages, []);
    },
  );

  await t.step("malformed inbox does not break failure handling", async () => {
    await withLogtapeLock(async () => {
      const [tracerProvider, exporter] = createTestTracerProvider();
      const { federation, queuedMessages } = setup({ tracerProvider });
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
          loggers: [{ category: [], sinks: ["buffer"] }],
        });

        await federation.processQueuedTask(
          undefined,
          createOutboxMessage(
            "not a url",
            "https://example.com/activity/9",
            ["https://gone.example/users/bob"],
          ),
        );

        assertEquals(queuedMessages.length, 1);
        assertEquals((queuedMessages[0] as OutboxMessage).attempt, 1);
        const events = exporter.getEvents(
          "activitypub.outbox",
          "activitypub.delivery.failed",
        );
        assertEquals(events.length, 1);
        assertEquals(
          events[0].attributes?.["activitypub.remote.host"],
          undefined,
        );
        assertEquals(events[0].attributes?.["activitypub.delivery.attempt"], 0);
        assertEquals(
          records.some((record) =>
            record.rawMessage ===
              "Invalid inbox URL in queued outbox message: {inbox}" &&
            record.properties.inbox === "not a url"
          ),
          true,
        );
      } finally {
        await reset();
      }
    });
  });

  fetchMock.hardReset();
});

test("FederationImpl.processQueuedTask() circuit breaker", async (t) => {
  fetchMock.spyGlobal();

  interface Queued {
    message: Message;
    options: Parameters<MessageQueue["enqueue"]>[1];
  }

  interface CircuitBreakerSetup {
    federation: FederationImpl<void>;
    kv: MemoryKvStore;
    queued: Queued[];
  }

  function setup(
    options: ConstructorParameters<typeof FederationImpl<void>>[0][
      "circuitBreaker"
    ],
    federationOptions: Pick<
      ConstructorParameters<typeof FederationImpl<void>>[0],
      | "meterProvider"
      | "tracerProvider"
      | "permanentFailureStatusCodes"
      | "outboxRetryPolicy"
    > = {},
    queueOptions: Pick<MessageQueue, "nativeRetrial"> = {},
  ): CircuitBreakerSetup {
    const kv = new MemoryKvStore();
    const queued: Queued[] = [];
    const queue: MessageQueue = {
      nativeRetrial: queueOptions.nativeRetrial,
      enqueue(message, options) {
        queued.push({ message, options });
        return Promise.resolve();
      },
      listen(_handler, _options) {
        return Promise.resolve();
      },
    };
    const federation = new FederationImpl<void>({
      kv,
      queue,
      circuitBreaker: options,
      ...federationOptions,
    });
    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");
    return { federation, kv, queued };
  }

  function createOutboxMessage(
    inbox: string,
    overrides: Partial<OutboxMessage> = {},
  ): OutboxMessage {
    return {
      type: "outbox",
      id: crypto.randomUUID(),
      baseUrl: "https://example.com",
      keys: [],
      activity: {
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Create",
        id: "https://example.com/activity/circuit",
        actor: "https://example.com/users/alice",
        object: { type: "Note", content: "test" },
      },
      activityId: "https://example.com/activity/circuit",
      activityType: "https://www.w3.org/ns/activitystreams#Create",
      inbox,
      sharedInbox: false,
      actorIds: ["https://breaker.example/users/bob"],
      started: new Date().toISOString(),
      attempt: 0,
      headers: {},
      traceContext: {},
      ...overrides,
    };
  }

  await t.step("is not created without an outbox queue", () => {
    const federation = new FederationImpl<void>({
      kv: new MemoryKvStore(),
    });
    assertEquals(federation.circuitBreaker, undefined);
  });

  await t.step("5xx opens circuit and holds the failed message", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    fetchMock.post("https://breaker.example/inbox", {
      status: 500,
      body: "server error",
    });
    const { federation, queued, kv } = setup({
      failureThreshold: 1,
      failureWindow: { minutes: 10 },
      recoveryDelay: { minutes: 30 },
    });
    const orderingKey = "https://example.com/object/breaker";

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://breaker.example/inbox", { orderingKey }),
    );

    assertEquals(queued.length, 1);
    const held = queued[0].message as OutboxMessage;
    assertEquals(held.attempt, 0);
    assertEquals(held.orderingKey, orderingKey);
    assertEquals(held.circuitHeld, true);
    assertExists(held.circuitHeldSince);
    assertEquals(queued[0].options?.orderingKey, orderingKey);
    assertEquals(
      queued[0].options?.delay,
      Temporal.Duration.from({ minutes: 30 }),
    );
    const state = await kv.get<Record<string, unknown>>([
      "_fedify",
      "circuit",
      "breaker.example",
    ]);
    assertEquals(state?.state, "open");
    assertEquals(Array.isArray(state?.failures), true);
    assertEquals((state?.failures as unknown[]).length, 1);
    assertExists(state?.opened);
  });

  await t.step("open circuit requeues without sending", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    let requests = 0;
    fetchMock.post("https://open.example/inbox", () => {
      requests++;
      return { status: 500, body: "server error" };
    });
    const { federation, queued } = setup({
      failureThreshold: 1,
      recoveryDelay: { hours: 1 },
    });
    const orderingKey = "https://example.com/object/open";

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://open.example/inbox", { orderingKey }),
    );
    const held = queued[0].message as OutboxMessage;
    queued.length = 0;
    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://open.example/inbox", {
        circuitHeld: true,
        circuitHeldSince: held.circuitHeldSince,
        orderingKey,
      }),
    );

    assertEquals(requests, 1);
    assertEquals(queued.length, 1);
    const requeued = queued[0].message as OutboxMessage;
    assertEquals(requeued.attempt, 0);
    assertEquals(requeued.orderingKey, orderingKey);
    assertEquals(requeued.circuitHeld, true);
    assertEquals(requeued.circuitHeldSince, held.circuitHeldSince);
    assertEquals(queued[0].options?.orderingKey, orderingKey);
    assertEquals(
      queued[0].options?.delay,
      Temporal.Duration.from({ hours: 1 }),
    );
  });

  await t.step("circuit keys include non-default ports", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    let defaultPortRequests = 0;
    fetchMock.post("https://ports.example:8443/inbox", {
      status: 500,
      body: "server error",
    });
    fetchMock.post("https://ports.example/inbox", () => {
      defaultPortRequests++;
      return { status: 202, body: "" };
    });
    const { federation, queued, kv } = setup({
      failureThreshold: 1,
      recoveryDelay: { hours: 1 },
    });

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://ports.example:8443/inbox"),
    );
    assertEquals(
      (await kv.get<Record<string, unknown>>([
        "_fedify",
        "circuit",
        "ports.example:8443",
      ]))?.state,
      "open",
    );
    assertEquals(
      await kv.get(["_fedify", "circuit", "ports.example"]),
      undefined,
    );

    queued.length = 0;
    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://ports.example/inbox"),
    );

    assertEquals(defaultPortRequests, 1);
    assertEquals(queued, []);
  });

  await t.step("post-send circuit errors do not retry delivery", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    fetchMock.post("https://success-bookkeeping.example/inbox", {
      status: 202,
      body: "",
    });
    const { federation, queued, kv } = setup({
      failureThreshold: 1,
    });
    await kv.set(["_fedify", "circuit", "success-bookkeeping.example"], {
      state: "closed",
      failures: [],
    });
    kv.cas = () => Promise.resolve(false);

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://success-bookkeeping.example/inbox"),
    );

    assertEquals(queued, []);
  });

  await t.step("pre-send circuit errors do not block delivery", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    let requests = 0;
    fetchMock.post("https://presend-bookkeeping.example/inbox", () => {
      requests++;
      return { status: 202, body: "" };
    });
    const { federation, queued, kv } = setup({ failureThreshold: 1 });
    kv.get = () => Promise.reject(new Error("kv get failed"));

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://presend-bookkeeping.example/inbox"),
    );

    assertEquals(requests, 1);
    assertEquals(queued, []);
  });

  await t.step("circuit failure errors fall back to retry", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    fetchMock.post("https://failure-bookkeeping.example/inbox", {
      status: 500,
      body: "server error",
    });
    const { federation, queued, kv } = setup(
      {
        failureThreshold: 1,
      },
      { outboxRetryPolicy: () => Temporal.Duration.from({ seconds: 3 }) },
    );
    kv.cas = () => Promise.resolve(false);

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://failure-bookkeeping.example/inbox"),
    );

    assertEquals(queued.length, 1);
    const retry = queued[0].message as OutboxMessage;
    assertEquals(retry.attempt, 1);
    assertEquals(retry.circuitHeld, undefined);
    assertEquals(
      queued[0].options?.delay,
      Temporal.Duration.from({ seconds: 3 }),
    );
  });

  await t.step("local delivery errors do not open circuit", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    const { federation, queued, kv } = setup(
      { failureThreshold: 1 },
      { outboxRetryPolicy: () => Temporal.Duration.from({ seconds: 3 }) },
    );

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://local-error.example/inbox", {
        headers: { "Invalid Header": "x" },
      }),
    );

    assertEquals(queued.length, 1);
    const retry = queued[0].message as OutboxMessage;
    assertEquals(retry.attempt, 1);
    assertEquals(retry.circuitHeld, undefined);
    assertEquals(
      queued[0].options?.delay,
      Temporal.Duration.from({ seconds: 3 }),
    );
    assertEquals(
      await kv.get(["_fedify", "circuit", "local-error.example"]),
      undefined,
    );
  });

  await t.step("calendar retry delays are enqueued", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    fetchMock.post("https://calendar-delay.example/inbox", {
      status: 500,
      body: "server error",
    });
    const { federation, queued } = setup(
      {
        failureThreshold: 5,
      },
      { outboxRetryPolicy: () => Temporal.Duration.from({ days: 1 }) },
    );

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://calendar-delay.example/inbox"),
    );

    assertEquals(queued.length, 1);
    assertEquals(
      queued[0].options?.delay,
      Temporal.Duration.from({ days: 1 }),
    );
  });

  await t.step("negative calendar retry delays are clamped", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    fetchMock.post("https://negative-calendar-delay.example/inbox", {
      status: 500,
      body: "server error",
    });
    const { federation, queued } = setup(
      {
        failureThreshold: 5,
      },
      { outboxRetryPolicy: () => Temporal.Duration.from({ days: -1 }) },
    );

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://negative-calendar-delay.example/inbox"),
    );

    assertEquals(queued.length, 1);
    assertEquals(
      queued[0].options?.delay,
      Temporal.Duration.from({ seconds: 0 }),
    );
  });

  await t.step("circuit hold respects retry give-up", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    fetchMock.post("https://hold-give-up.example/inbox", {
      status: 500,
      body: "server error",
    });
    const { federation, queued, kv } = setup(
      {
        failureThreshold: 1,
        recoveryDelay: { minutes: 30 },
      },
      { outboxRetryPolicy: () => null },
    );

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://hold-give-up.example/inbox"),
    );

    assertEquals(queued, []);
    assertEquals(
      (await kv.get<Record<string, unknown>>([
        "_fedify",
        "circuit",
        "hold-give-up.example",
      ]))?.state,
      "open",
    );
  });

  await t.step("circuit decision errors fall back to retry", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    fetchMock.post("https://decision-bookkeeping.example/inbox", {
      status: 500,
      body: "server error",
    });
    const { federation, queued, kv } = setup(
      {
        failureThreshold: 1,
      },
      { outboxRetryPolicy: () => Temporal.Duration.from({ seconds: 4 }) },
    );
    const originalGet = kv.get.bind(kv);
    let getCalls = 0;
    kv.get = (...args) => {
      getCalls++;
      return getCalls === 1
        ? originalGet(...args)
        : Promise.reject(new Error("kv get failed"));
    };

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://decision-bookkeeping.example/inbox"),
    );

    assertEquals(queued.length, 1);
    const retry = queued[0].message as OutboxMessage;
    assertEquals(retry.attempt, 1);
    assertEquals(retry.circuitHeld, undefined);
    assertEquals(
      queued[0].options?.delay,
      Temporal.Duration.from({ seconds: 4 }),
    );
  });

  await t.step("circuit reachable errors keep permanent failure", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    fetchMock.post("https://permanent-bookkeeping.example/inbox", {
      status: 500,
      body: "server error",
    });
    const { federation, queued, kv } = setup(
      {
        failureThreshold: 1,
      },
      { permanentFailureStatusCodes: [500] },
    );
    await kv.set(["_fedify", "circuit", "permanent-bookkeeping.example"], {
      state: "half-open",
      failures: ["2026-05-25T00:00:00Z"],
      opened: "2026-05-25T00:00:00Z",
      halfOpened: "2026-05-25T00:00:00Z",
    });
    const originalCas = kv.cas.bind(kv);
    let casCalls = 0;
    kv.cas = (...args) => {
      casCalls++;
      return casCalls === 1 ? originalCas(...args) : Promise.resolve(false);
    };
    let permanentFailureStatusCode: unknown;
    federation.setOutboxPermanentFailureHandler((_ctx, values) => {
      permanentFailureStatusCode = values.statusCode;
    });

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://permanent-bookkeeping.example/inbox"),
    );

    assertEquals(queued, []);
    assertEquals(permanentFailureStatusCode, 500);
  });

  await t.step("429 respects Retry-After without opening circuit", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    fetchMock.post("https://rate.example/inbox", {
      status: 429,
      headers: { "Retry-After": "120" },
      body: "rate limited",
    });
    const { federation, queued, kv } = setup({
      failureThreshold: 1,
      recoveryDelay: { minutes: 30 },
    });
    const orderingKey = "https://example.com/object/rate";

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://rate.example/inbox", { orderingKey }),
    );

    assertEquals(queued.length, 1);
    const retry = queued[0].message as OutboxMessage;
    assertEquals(retry.attempt, 1);
    assertEquals(retry.orderingKey, orderingKey);
    assertEquals(retry.circuitHeld, undefined);
    assertEquals(queued[0].options?.orderingKey, orderingKey);
    assertEquals(
      queued[0].options?.delay,
      Temporal.Duration.from({ seconds: 120 }),
    );
    assertEquals(
      await kv.get(["_fedify", "circuit", "rate.example"]),
      undefined,
    );
  });

  await t.step(
    "429 respects Retry-After with circuit breaker disabled",
    async () => {
      fetchMock.hardReset();
      fetchMock.spyGlobal();
      fetchMock.post("https://rate-disabled.example/inbox", {
        status: 429,
        headers: { "Retry-After": "120" },
        body: "rate limited",
      });
      const { federation, queued, kv } = setup(false, {}, {
        nativeRetrial: true,
      });
      assertEquals(federation.circuitBreaker, undefined);

      await federation.processQueuedTask(
        undefined,
        createOutboxMessage("https://rate-disabled.example/inbox", {
          orderingKey: "https://example.com/object/rate-limited",
        }),
      );

      assertEquals(queued.length, 1);
      const retry = queued[0].message as OutboxMessage;
      assertEquals(retry.attempt, 1);
      assertEquals(retry.circuitHeld, undefined);
      assertEquals(
        queued[0].options?.delay,
        Temporal.Duration.from({ seconds: 120 }),
      );
      assertEquals(
        queued[0].options?.orderingKey,
        "https://example.com/object/rate-limited",
      );
      assertEquals(
        await kv.get(["_fedify", "circuit", "rate-disabled.example"]),
        undefined,
      );
    },
  );

  await t.step("429 Retry-After still respects retry give-up", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    fetchMock.post("https://give-up.example/inbox", {
      status: 429,
      headers: { "Retry-After": "120" },
      body: "rate limited",
    });
    const { federation, queued, kv } = setup(
      { failureThreshold: 1 },
      { outboxRetryPolicy: () => null },
    );

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://give-up.example/inbox"),
    );

    assertEquals(queued, []);
    assertEquals(
      await kv.get(["_fedify", "circuit", "give-up.example"]),
      undefined,
    );
  });

  await t.step("503 respects Retry-After while counting failure", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    fetchMock.post("https://unavailable.example/inbox", {
      status: 503,
      headers: { "Retry-After": "120" },
      body: "temporarily unavailable",
    });
    const { federation, queued, kv } = setup(
      {
        failureThreshold: 5,
        failureWindow: { minutes: 10 },
      },
      { outboxRetryPolicy: () => Temporal.Duration.from({ seconds: 3 }) },
    );
    const orderingKey = "https://example.com/object/unavailable";

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://unavailable.example/inbox", {
        orderingKey,
      }),
    );

    assertEquals(queued.length, 1);
    const retry = queued[0].message as OutboxMessage;
    assertEquals(retry.attempt, 1);
    assertEquals(retry.circuitHeld, undefined);
    assertEquals(retry.orderingKey, orderingKey);
    assertEquals(
      queued[0].options?.delay,
      Temporal.Duration.from({ seconds: 120 }),
    );
    assertEquals(queued[0].options?.orderingKey, orderingKey);
    const state = await kv.get<Record<string, unknown>>([
      "_fedify",
      "circuit",
      "unavailable.example",
    ]);
    assertEquals(state?.state, "closed");
    assertEquals((state?.failures as unknown[]).length, 1);
  });

  await t.step("503 Retry-After delays newly opened circuit hold", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    fetchMock.post("https://open-retry-after.example/inbox", {
      status: 503,
      headers: { "Retry-After": "3600" },
      body: "temporarily unavailable",
    });
    const { federation, queued, kv } = setup(
      {
        failureThreshold: 1,
        recoveryDelay: { seconds: 30 },
      },
      { outboxRetryPolicy: () => Temporal.Duration.from({ seconds: 3 }) },
    );

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://open-retry-after.example/inbox"),
    );

    assertEquals(queued.length, 1);
    const held = queued[0].message as OutboxMessage;
    assertEquals(held.attempt, 0);
    assertEquals(held.circuitHeld, true);
    assertEquals(queued[0].options?.delay?.toString(), "PT3600S");
    const state = await kv.get<Record<string, unknown>>([
      "_fedify",
      "circuit",
      "open-retry-after.example",
    ]);
    assertEquals(state?.state, "open");
  });

  await t.step("malformed Retry-After falls back to retry policy", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    fetchMock.post("https://huge-retry-after.example/inbox", {
      status: 429,
      headers: { "Retry-After": "999999999999999999999999999999" },
      body: "rate limited",
    });
    const { federation, queued, kv } = setup(
      { failureThreshold: 1 },
      { outboxRetryPolicy: () => Temporal.Duration.from({ seconds: 3 }) },
    );

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://huge-retry-after.example/inbox"),
    );

    assertEquals(queued.length, 1);
    assertEquals(
      queued[0].options?.delay?.total({ unit: "second" }),
      3,
    );
    assertEquals(
      await kv.get(["_fedify", "circuit", "huge-retry-after.example"]),
      undefined,
    );
  });

  await t.step(
    "invalid Retry-After date falls back to retry policy",
    async () => {
      fetchMock.hardReset();
      fetchMock.spyGlobal();
      fetchMock.post("https://invalid-retry-after.example/inbox", {
        status: 429,
        headers: { "Retry-After": "1.5" },
        body: "rate limited",
      });
      const { federation, queued, kv } = setup(
        { failureThreshold: 1 },
        { outboxRetryPolicy: () => Temporal.Duration.from({ seconds: 3 }) },
      );

      await federation.processQueuedTask(
        undefined,
        createOutboxMessage("https://invalid-retry-after.example/inbox"),
      );

      assertEquals(queued.length, 1);
      assertEquals(
        queued[0].options?.delay?.total({ unit: "second" }),
        3,
      );
      assertEquals(
        await kv.get(["_fedify", "circuit", "invalid-retry-after.example"]),
        undefined,
      );
    },
  );

  await t.step("asctime Retry-After date is interpreted as UTC", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    const retryAfter = "Wed Dec 31 23:59:59 2036";
    fetchMock.post("https://asctime-retry-after.example/inbox", {
      status: 429,
      headers: { "Retry-After": retryAfter },
      body: "rate limited",
    });
    const { federation, queued } = setup(
      { failureThreshold: 1 },
      { outboxRetryPolicy: () => Temporal.Duration.from({ seconds: 3 }) },
    );
    const before = Temporal.Now.instant();

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://asctime-retry-after.example/inbox"),
    );

    const after = Temporal.Now.instant();
    const retryAtMs = Date.parse(`${retryAfter} GMT`);
    assertEquals(queued.length, 1);
    const delayMs = queued[0].options?.delay?.total({ unit: "millisecond" });
    assertExists(delayMs);
    assertEquals(delayMs <= retryAtMs - before.epochMilliseconds, true);
    assertEquals(delayMs >= retryAtMs - after.epochMilliseconds, true);
  });

  await t.step("permanent 5xx does not open circuit", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    fetchMock.post("https://permanent-500.example/inbox", {
      status: 500,
      body: "server error",
    });
    const { federation, queued, kv } = setup(
      { failureThreshold: 1 },
      { permanentFailureStatusCodes: [500] },
    );
    let permanentFailureStatusCode: unknown;
    federation.setOutboxPermanentFailureHandler((_ctx, values) => {
      permanentFailureStatusCode = values.statusCode;
    });

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://permanent-500.example/inbox"),
    );

    assertEquals(queued, []);
    assertEquals(permanentFailureStatusCode, 500);
    assertEquals(
      await kv.get(["_fedify", "circuit", "permanent-500.example"]),
      undefined,
    );
  });

  await t.step("permanent 5xx closes half-open circuit", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    fetchMock.post("https://permanent-probe.example/inbox", {
      status: 500,
      body: "server error",
    });
    const { federation, queued, kv } = setup(
      {
        failureThreshold: 1,
        releaseInterval: { seconds: 1 },
      },
      { permanentFailureStatusCodes: [500] },
    );
    await kv.set(["_fedify", "circuit", "permanent-probe.example"], {
      state: "half-open",
      failures: ["2026-05-25T00:00:00Z"],
      opened: "2026-05-25T00:00:00Z",
      halfOpened: "2026-05-25T00:00:00Z",
    });
    let permanentFailureStatusCode: unknown;
    federation.setOutboxPermanentFailureHandler((_ctx, values) => {
      permanentFailureStatusCode = values.statusCode;
    });

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://permanent-probe.example/inbox"),
    );

    assertEquals(queued, []);
    assertEquals(permanentFailureStatusCode, 500);
    assertEquals(
      await kv.get(["_fedify", "circuit", "permanent-probe.example"]),
      undefined,
    );
  });

  await t.step("permanent 4xx closes half-open circuit", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    fetchMock.post("https://gone.example/inbox", {
      status: 410,
      body: "gone",
    });
    const { federation, queued, kv } = setup({
      failureThreshold: 1,
      releaseInterval: { seconds: 1 },
    });
    await kv.set(["_fedify", "circuit", "gone.example"], {
      state: "half-open",
      failures: ["2026-05-25T00:00:00Z"],
      opened: "2026-05-25T00:00:00Z",
      halfOpened: "2026-05-25T00:00:00Z",
    });
    let permanentFailureStatusCode: unknown;
    federation.setOutboxPermanentFailureHandler((_ctx, values) => {
      permanentFailureStatusCode = values.statusCode;
    });

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://gone.example/inbox"),
    );

    assertEquals(queued, []);
    assertEquals(permanentFailureStatusCode, 410);
    assertEquals(
      await kv.get(["_fedify", "circuit", "gone.example"]),
      undefined,
    );
  });

  await t.step("false disables circuit handling", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    fetchMock.post("https://disabled.example/inbox", {
      status: 500,
      body: "server error",
    });
    const { federation, queued, kv } = setup(false);

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://disabled.example/inbox"),
    );

    assertEquals(queued.length, 1);
    const retry = queued[0].message as OutboxMessage;
    assertEquals(retry.attempt, 1);
    assertEquals(retry.circuitHeld, undefined);
    assertEquals(
      await kv.get(["_fedify", "circuit", "disabled.example"]),
      undefined,
    );
  });

  await t.step("state changes are recorded in metrics and spans", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    fetchMock.post("https://telemetry.example/inbox", {
      status: 500,
      body: "server error",
    });
    const [meterProvider, recorder] = createTestMeterProvider();
    const [tracerProvider, exporter] = createTestTracerProvider();
    const { federation, queued } = setup(
      { failureThreshold: 1 },
      { meterProvider, tracerProvider },
    );

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://telemetry.example/inbox"),
    );

    assertEquals(queued.length, 1);
    const measurements = recorder.getMeasurements(
      "activitypub.circuit_breaker.state_change",
    );
    assertEquals(measurements.length, 1);
    assertEquals(
      measurements[0].attributes["activitypub.remote.host"],
      "telemetry.example",
    );
    assertEquals(
      measurements[0].attributes["activitypub.circuit_breaker.state"],
      "open",
    );
    const events = exporter.getEvents(
      "activitypub.outbox",
      "activitypub.circuit_breaker.state_change",
    );
    assertEquals(events.length, 1);
    assertEquals(
      events[0].attributes?.["activitypub.remote.host"],
      "telemetry.example",
    );
    assertEquals(
      events[0].attributes?.["activitypub.circuit_breaker.previous_state"],
      "closed",
    );
    assertEquals(
      events[0].attributes?.["activitypub.circuit_breaker.state"],
      "open",
    );
    const heldEvents = exporter.getEvents(
      "activitypub.outbox",
      "activitypub.circuit_breaker.held",
    );
    assertEquals(heldEvents.length, 1);
    assertEquals(
      heldEvents[0].attributes?.["activitypub.remote.host"],
      "telemetry.example",
    );
    assertEquals(
      heldEvents[0].attributes?.["activitypub.circuit_breaker.state"],
      "open",
    );
  });

  await t.step("held half-open circuit is recorded in spans", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    const now = Temporal.Instant.from("2026-05-25T00:00:30Z");
    const [tracerProvider, exporter] = createTestTracerProvider();
    const { federation, queued, kv } = setup(
      {
        failureThreshold: 1,
        recoveryDelay: { minutes: 5 },
        releaseInterval: { minutes: 1 },
      },
      { tracerProvider },
    );
    federation.circuitBreaker = new CircuitBreaker({
      kv,
      prefix: ["_fedify", "circuit"],
      now: () => now,
      options: {
        failureThreshold: 1,
        recoveryDelay: { minutes: 5 },
        releaseInterval: { minutes: 1 },
      },
    });
    await kv.set(["_fedify", "circuit", "half-open-telemetry.example"], {
      state: "half-open",
      failures: ["2026-05-25T00:00:00Z"],
      opened: "2026-05-25T00:00:00Z",
      halfOpened: "2026-05-25T00:00:00Z",
    });

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://half-open-telemetry.example/inbox", {
        circuitHeld: true,
        circuitHeldSince: "2026-05-25T00:00:00Z",
      }),
    );

    assertEquals(queued.length, 1);
    const events = exporter.getEvents(
      "activitypub.outbox",
      "activitypub.circuit_breaker.held",
    );
    assertEquals(events.length, 1);
    assertEquals(
      events[0].attributes?.["activitypub.remote.host"],
      "half-open-telemetry.example",
    );
    assertEquals(
      events[0].attributes?.["activitypub.circuit_breaker.state"],
      "half_open",
    );
  });

  await t.step(
    "stale half-open probe does not record open transition",
    async () => {
      fetchMock.hardReset();
      fetchMock.spyGlobal();
      fetchMock.post("https://stale-probe-telemetry.example/inbox", {
        status: 202,
        body: "",
      });
      const now = Temporal.Instant.from("2026-05-25T00:00:02Z");
      const [tracerProvider, exporter] = createTestTracerProvider();
      const { federation, kv } = setup(
        {
          failureThreshold: 1,
          recoveryDelay: { seconds: 1 },
        },
        { tracerProvider },
      );
      federation.circuitBreaker = new CircuitBreaker({
        kv,
        prefix: ["_fedify", "circuit"],
        now: () => now,
        options: {
          failureThreshold: 1,
          recoveryDelay: { seconds: 1 },
        },
      });
      await kv.set(["_fedify", "circuit", "stale-probe-telemetry.example"], {
        state: "half-open",
        failures: ["2026-05-25T00:00:00Z"],
        opened: "2026-05-25T00:00:00Z",
        halfOpened: "2026-05-25T00:00:00Z",
      });

      await federation.processQueuedTask(
        undefined,
        createOutboxMessage("https://stale-probe-telemetry.example/inbox"),
      );

      const events = exporter.getEvents(
        "activitypub.outbox",
        "activitypub.circuit_breaker.state_change",
      );
      assertEquals(events.length, 1);
      assertEquals(
        events[0].attributes?.["activitypub.circuit_breaker.previous_state"],
        "half_open",
      );
      assertEquals(
        events[0].attributes?.["activitypub.circuit_breaker.state"],
        "closed",
      );
    },
  );

  await t.step("expired held activity is dropped", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    const now = Temporal.Instant.from("2026-05-25T00:00:02Z");
    let dropped: { remoteHost: string; heldSince: Temporal.Instant } | null =
      null;
    const { federation, queued, kv } = setup(false);
    federation.circuitBreaker = new CircuitBreaker({
      kv,
      prefix: ["_fedify", "circuit"],
      now: () => now,
      options: {
        failureThreshold: 1,
        heldActivityTtl: { seconds: 1 },
        onActivityDrop(remoteHost, details) {
          dropped = { remoteHost, heldSince: details.heldSince };
        },
      },
    });
    let permanentFailureReason: unknown;
    federation.setOutboxPermanentFailureHandler((_ctx, values) => {
      permanentFailureReason = values.reason;
    });

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://ttl.example/inbox", {
        circuitHeld: true,
        circuitHeldSince: "2026-05-25T00:00:00Z",
      }),
    );

    assertEquals(queued, []);
    assertEquals(dropped, {
      remoteHost: "ttl.example",
      heldSince: Temporal.Instant.from("2026-05-25T00:00:00Z"),
    });
    assertEquals(permanentFailureReason, "circuit-breaker-ttl");
  });

  await t.step("expired held probe is dropped after failed send", async () => {
    fetchMock.hardReset();
    fetchMock.spyGlobal();
    let now = Temporal.Instant.from("2026-05-25T00:00:01Z");
    const heldSince = Temporal.Instant.from("2026-05-25T00:00:00Z");
    fetchMock.post("https://expired-probe.example/inbox", () => {
      now = Temporal.Instant.from("2026-05-25T00:00:03Z");
      return { status: 500, body: "server error" };
    });
    let dropped: { remoteHost: string; heldSince: Temporal.Instant } | null =
      null;
    const { federation, queued, kv } = setup({
      failureThreshold: 1,
      recoveryDelay: { seconds: 1 },
      heldActivityTtl: { seconds: 2 },
      releaseInterval: { seconds: 1 },
    });
    federation.circuitBreaker = new CircuitBreaker({
      kv,
      prefix: ["_fedify", "circuit"],
      now: () => now,
      options: {
        failureThreshold: 1,
        recoveryDelay: { seconds: 1 },
        heldActivityTtl: { seconds: 2 },
        releaseInterval: { seconds: 1 },
        onActivityDrop(remoteHost, details) {
          dropped = { remoteHost, heldSince: details.heldSince };
        },
      },
    });
    await kv.set(["_fedify", "circuit", "expired-probe.example"], {
      state: "half-open",
      failures: ["2026-05-25T00:00:00Z"],
      opened: "2026-05-25T00:00:00Z",
      halfOpened: "2026-05-25T00:00:00Z",
    });
    let permanentFailureReason: unknown;
    federation.setOutboxPermanentFailureHandler((_ctx, values) => {
      permanentFailureReason = values.reason;
    });

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage("https://expired-probe.example/inbox", {
        circuitHeld: true,
        circuitHeldSince: heldSince.toString(),
      }),
    );

    assertEquals(queued, []);
    assertEquals(dropped, {
      remoteHost: "expired-probe.example",
      heldSince,
    });
    assertEquals(permanentFailureReason, "circuit-breaker-ttl");
  });

  fetchMock.hardReset();
});

test("FederationImpl.processQueuedTask() queue task metrics", async (t) => {
  await t.step(
    "records failed result when worker re-throws (nativeRetrial)",
    async () => {
      // With nativeRetrial=true the worker leaves retry handling to the queue
      // backend, so an inbox listener exception propagates back out of
      // processQueuedTask and is recorded as a failed outcome.
      const kv = new MemoryKvStore();
      const [meterProvider, recorder] = createTestMeterProvider();
      const queue: MessageQueue = {
        nativeRetrial: true,
        enqueue(_message, _options) {
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const federation = new FederationImpl<void>({
        kv,
        meterProvider,
        queue,
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(vocab.Create, () => {
          throw new Error("Intended error for testing");
        });

      await assertRejects(
        () =>
          federation.processQueuedTask(
            undefined,
            {
              type: "inbox",
              id: crypto.randomUUID(),
              baseUrl: "https://example.com",
              activity: {
                "@context": "https://www.w3.org/ns/activitystreams",
                type: "Create",
                id: "https://remote.example/activities/2",
                actor: "https://remote.example/users/alice",
                object: { type: "Note", content: "Hello world" },
              },
              started: new Date().toISOString(),
              attempt: 0,
              identifier: null,
              traceContext: {},
            } satisfies InboxMessage,
          ),
        Error,
      );

      assertEquals(
        recorder.getMeasurements("fedify.queue.task.completed").length,
        0,
      );
      const failed = recorder.getMeasurements("fedify.queue.task.failed");
      assertEquals(failed.length, 1);
      assertEquals(failed[0].attributes["fedify.queue.role"], "inbox");
      assertEquals(failed[0].attributes["fedify.queue.task.result"], "failed");
      assertEquals(failed[0].attributes["fedify.queue.native_retrial"], true);
      assertEquals(
        failed[0].attributes["activitypub.activity.type"],
        "https://www.w3.org/ns/activitystreams#Create",
      );

      const taskDurations = recorder.getMeasurements(
        "fedify.queue.task.duration",
      );
      assertEquals(taskDurations.length, 1);
      assertEquals(
        taskDurations[0].attributes["fedify.queue.task.result"],
        "failed",
      );

      const inFlight = recorder.getMeasurements("fedify.queue.task.in_flight");
      assertEquals(inFlight.length, 2);
      assertEquals(inFlight[0].value, 1);
      assertEquals(inFlight[1].value, -1);
      assertEquals(inFlight[0].attributes, inFlight[1].attributes);
    },
  );

  await t.step(
    "records completed when retry handler swallows listener error",
    async () => {
      // With nativeRetrial=false the worker schedules a retry and returns
      // normally, so processQueuedTask records a completed outcome and a
      // separate retry enqueue.
      const kv = new MemoryKvStore();
      const [meterProvider, recorder] = createTestMeterProvider();
      const queuedMessages: Message[] = [];
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const federation = new FederationImpl<void>({
        kv,
        meterProvider,
        queue,
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(vocab.Create, () => {
          throw new Error("Intended error for testing");
        });

      await federation.processQueuedTask(
        undefined,
        {
          type: "inbox",
          id: crypto.randomUUID(),
          baseUrl: "https://example.com",
          activity: {
            "@context": "https://www.w3.org/ns/activitystreams",
            type: "Create",
            id: "https://remote.example/activities/retry",
            actor: "https://remote.example/users/alice",
            object: { type: "Note", content: "Hello world" },
          },
          started: new Date().toISOString(),
          attempt: 0,
          identifier: null,
          traceContext: {},
        } satisfies InboxMessage,
      );
      assertEquals(queuedMessages.length, 1);

      const completed = recorder.getMeasurements("fedify.queue.task.completed");
      assertEquals(completed.length, 1);
      assertEquals(
        completed[0].attributes["fedify.queue.task.result"],
        "completed",
      );

      const enqueued = recorder.getMeasurements("fedify.queue.task.enqueued");
      assertEquals(enqueued.length, 1);
      assertEquals(enqueued[0].attributes["fedify.queue.role"], "inbox");
      assertEquals(enqueued[0].attributes["fedify.queue.task.attempt"], 1);
      assertEquals(
        enqueued[0].attributes["activitypub.activity.type"],
        "https://www.w3.org/ns/activitystreams#Create",
      );
    },
  );

  await t.step(
    "records aborted result when worker re-throws AbortError",
    async () => {
      const kv = new MemoryKvStore();
      const [meterProvider, recorder] = createTestMeterProvider();
      const [tracerProvider, exporter] = createTestTracerProvider();
      const queue: MessageQueue = {
        nativeRetrial: true,
        enqueue(_message, _options) {
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const federation = new FederationImpl<void>({
        kv,
        meterProvider,
        tracerProvider,
        queue,
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(vocab.Create, () => {
          throw new DOMException("aborted", "AbortError");
        });

      await assertRejects(
        () =>
          federation.processQueuedTask(
            undefined,
            {
              type: "inbox",
              id: crypto.randomUUID(),
              baseUrl: "https://example.com",
              activity: {
                "@context": "https://www.w3.org/ns/activitystreams",
                type: "Create",
                id: "https://remote.example/activities/3",
                actor: "https://remote.example/users/alice",
                object: { type: "Note", content: "Hello world" },
              },
              started: new Date().toISOString(),
              attempt: 0,
              identifier: null,
              traceContext: {},
            } satisfies InboxMessage,
          ),
        DOMException,
      );

      assertEquals(
        recorder.getMeasurements("fedify.queue.task.failed").length,
        0,
      );
      assertEquals(
        recorder.getMeasurements("fedify.queue.task.completed").length,
        0,
      );
      const taskDurations = recorder.getMeasurements(
        "fedify.queue.task.duration",
      );
      assertEquals(taskDurations.length, 1);
      assertEquals(
        taskDurations[0].attributes["fedify.queue.task.result"],
        "aborted",
      );

      // Per OpenTelemetry guidance, the inbox span should remain UNSET for
      // cancellation and not flip into ERROR status.
      const inboxSpans = exporter.getSpans("activitypub.inbox");
      assertEquals(inboxSpans.length, 1);
      assertEquals(inboxSpans[0].status.code, SpanStatusCode.UNSET);
    },
  );

  await t.step("records native_retrial and backend attributes", async () => {
    const kv = new MemoryKvStore();
    const [meterProvider, recorder] = createTestMeterProvider();
    class TestMessageQueue implements MessageQueue {
      readonly nativeRetrial = true;
      enqueue(_message: unknown, _options?: unknown): Promise<void> {
        return Promise.resolve();
      }
      listen(_handler: unknown, _options?: unknown): Promise<void> {
        return Promise.resolve();
      }
    }
    const federation = new FederationImpl<void>({
      kv,
      meterProvider,
      queue: new TestMessageQueue(),
    });
    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
      .on(vocab.Create, () => {});

    await federation.processQueuedTask(
      undefined,
      {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: {
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "Create",
          id: "https://remote.example/activities/4",
          actor: "https://remote.example/users/alice",
          object: { type: "Note", content: "Hello world" },
        },
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage,
    );

    const completed = recorder.getMeasurements("fedify.queue.task.completed");
    assertEquals(completed.length, 1);
    assertEquals(
      completed[0].attributes["fedify.queue.backend"],
      "TestMessageQueue",
    );
    assertEquals(completed[0].attributes["fedify.queue.native_retrial"], true);
  });

  await t.step(
    "records outbox worker metrics on successful delivery",
    async () => {
      const kv = new MemoryKvStore();
      const [meterProvider, recorder] = createTestMeterProvider();
      const queue: MessageQueue = {
        enqueue(_message, _options) {
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const federation = new FederationImpl<void>({
        kv,
        meterProvider,
        queue,
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");

      fetchMock.spyGlobal();
      fetchMock.post("https://remote.example/inbox", { status: 202 });
      try {
        await federation.processQueuedTask(
          undefined,
          {
            type: "outbox",
            id: crypto.randomUUID(),
            baseUrl: "https://example.com",
            keys: [],
            activity: {
              "@context": "https://www.w3.org/ns/activitystreams",
              type: "Create",
              id: "https://example.com/activities/1",
              actor: "https://example.com/users/alice",
              object: { type: "Note", content: "test" },
            },
            activityType: "https://www.w3.org/ns/activitystreams#Create",
            inbox: "https://remote.example/inbox",
            sharedInbox: false,
            started: new Date().toISOString(),
            attempt: 0,
            headers: {},
            traceContext: {},
          } satisfies OutboxMessage,
        );
      } finally {
        fetchMock.hardReset();
      }

      const started = recorder.getMeasurements("fedify.queue.task.started");
      assertEquals(started.length, 1);
      assertEquals(started[0].attributes["fedify.queue.role"], "outbox");
      assertEquals(
        started[0].attributes["activitypub.activity.type"],
        "https://www.w3.org/ns/activitystreams#Create",
      );

      const completed = recorder.getMeasurements("fedify.queue.task.completed");
      assertEquals(completed.length, 1);
      assertEquals(
        completed[0].attributes["fedify.queue.task.result"],
        "completed",
      );

      // Successful outbox delivery should not re-enqueue, so no enqueued
      // measurement is expected on this path.  The guard catches accidental
      // double-counting if the implementation ever changes.
      assertEquals(
        recorder.getMeasurements("fedify.queue.task.enqueued").length,
        0,
      );
    },
  );

  await t.step(
    "records started/completed for a fanout task with no recipients",
    async () => {
      // A fanout task with no inboxes drops out before sendActivity validates
      // keys, so the worker still completes successfully.
      const kv = new MemoryKvStore();
      const [meterProvider, recorder] = createTestMeterProvider();
      const exportedKey = await crypto.subtle.exportKey(
        "jwk",
        rsaPrivateKey3,
      );
      const queue: MessageQueue = {
        enqueue(_message, _options) {
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const federation = new FederationImpl<void>({
        kv,
        meterProvider,
        queue,
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");

      await federation.processQueuedTask(undefined, {
        type: "fanout",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        keys: [
          {
            keyId: "https://example.com/users/alice#main-key",
            privateKey: exportedKey,
          },
        ],
        inboxes: {},
        activity: {
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "Create",
          id: "https://example.com/activities/1",
          actor: "https://example.com/users/alice",
          object: { type: "Note", content: "test" },
        },
        activityType: "https://www.w3.org/ns/activitystreams#Create",
        traceContext: {},
      });

      const started = recorder.getMeasurements("fedify.queue.task.started");
      assertEquals(started.length, 1);
      assertEquals(started[0].attributes["fedify.queue.role"], "fanout");
      assertEquals(
        started[0].attributes["activitypub.activity.type"],
        "https://www.w3.org/ns/activitystreams#Create",
      );

      const completed = recorder.getMeasurements("fedify.queue.task.completed");
      assertEquals(completed.length, 1);
      assertEquals(completed[0].attributes["fedify.queue.role"], "fanout");
      assertEquals(
        completed[0].attributes["fedify.queue.task.result"],
        "completed",
      );
    },
  );
});

test("ContextImpl.lookupObject()", async (t) => {
  // Note that this test only checks if allowPrivateAddress option affects
  // the ContextImpl.lookupObject() method.  Other aspects of the method are
  // tested in the lookupObject() tests.

  fetchMock.spyGlobal();

  fetchMock.get("begin:https://localhost/.well-known/webfinger", {
    headers: { "Content-Type": "application/jrd+json" },
    body: {
      subject: "acct:test@localhost",
      links: [
        {
          rel: "self",
          type: "application/activity+json",
          href: "https://localhost/actor",
        },
      ],
    },
  });

  fetchMock.get("https://localhost/actor", {
    headers: { "Content-Type": "application/activity+json" },
    body: {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Person",
      "id": "https://localhost/actor",
      "preferredUsername": "test",
    },
  });

  await t.step("allowPrivateAddress: true", async () => {
    const federation = createFederation<void>({
      kv: new MemoryKvStore(),
      allowPrivateAddress: true,
    });
    const ctx = federation.createContext(new URL("https://example.com/"));
    const result = await ctx.lookupObject("@test@localhost");
    assertInstanceOf(result, vocab.Person);
    assertEquals(result.id, new URL("https://localhost/actor"));
    assertEquals(result.preferredUsername, "test");
  });

  await t.step("allowPrivateAddress: false", async () => {
    const federation = createFederation<void>({
      kv: new MemoryKvStore(),
      allowPrivateAddress: false,
    });
    const ctx = federation.createContext(new URL("https://example.com/"));
    const result = await ctx.lookupObject("@test@localhost");
    assertEquals(result, null);
  });

  fetchMock.hardReset();
});

test("ContextImpl.sendActivity()", async (t) => {
  fetchMock.spyGlobal();

  let verified: ("http" | "ld" | "proof")[] | null = null;
  let request: Request | null = null;
  let collectionSyncHeader: string | null = null;
  fetchMock.post("https://example.com/inbox", async (cl) => {
    verified = [];
    request = cl.request!.clone() as Request;
    collectionSyncHeader = cl.request!.headers.get(
      "Collection-Synchronization",
    );
    const options = {
      async documentLoader(url: string) {
        const response = await federation.fetch(
          new Request(url, { headers: { "accept": "application/ld+json" } }),
          { contextData: undefined },
        );
        if (response.ok) {
          return {
            contextUrl: null,
            document: await response.json(),
            documentUrl: response.url,
          };
        }
        return await mockDocumentLoader(url);
      },
      contextLoader: mockDocumentLoader,
      keyCache: {
        async get(keyId: URL) {
          const ctx = federation.createContext(
            new URL("https://example.com/"),
            undefined,
          );
          const keys = await ctx.getActorKeyPairs("1");
          for (const key of keys) {
            if (key.keyId.href === keyId.href) {
              return key.cryptographicKey;
            }
            if (key.multikey.id?.href === keyId.href) {
              return key.multikey;
            }
          }
          return undefined;
        },
        async set(
          _keyId: URL,
          _key: vocab.CryptographicKey | vocab.Multikey | null,
        ) {
        },
      } satisfies KeyCache,
    };
    let json = await cl.request!.json();
    if (await verifyJsonLd(json, options)) verified.push("ld");
    json = detachSignature(json);
    let activity = await verifyObject(vocab.Activity, json, options);
    if (activity == null) {
      activity = await vocab.Activity.fromJsonLd(json, options);
    } else {
      verified.push("proof");
    }
    const key = await verifyRequest(request, options);
    if (key != null && await doesActorOwnKey(activity, key, options)) {
      verified.push("http");
    }
    if (verified.length > 0) return new Response(null, { status: 202 });
    return new Response(null, { status: 401 });
  });

  const kv = new MemoryKvStore();
  const federation = new FederationImpl<void>({
    kv,
    contextLoaderFactory: () => mockDocumentLoader,
  });

  federation
    .setActorDispatcher("/{identifier}", async (ctx, identifier) => {
      if (identifier !== "1") return null;
      const keys = await ctx.getActorKeyPairs(identifier);
      return new vocab.Person({
        id: ctx.getActorUri(identifier),
        preferredUsername: "john",
        publicKey: keys[0].cryptographicKey,
        assertionMethods: keys.map((k) => k.multikey),
      });
    })
    .setKeyPairsDispatcher((_ctx, identifier) => {
      if (identifier !== "1") return [];
      return [
        { privateKey: rsaPrivateKey2, publicKey: rsaPublicKey2.publicKey! },
        {
          privateKey: ed25519PrivateKey,
          publicKey: ed25519PublicKey.publicKey!,
        },
      ];
    })
    .mapHandle((_ctx, username) => username === "john" ? "1" : null);

  federation.setFollowersDispatcher(
    "/users/{identifier}/followers",
    () => ({
      items: [
        {
          id: new URL("https://example.com/recipient"),
          inboxId: new URL("https://example.com/inbox"),
        },
      ],
    }),
  );

  await t.step("success", async () => {
    const activity = new vocab.Create({
      actor: new URL("https://example.com/person"),
    });
    const ctx = new ContextImpl({
      data: undefined,
      federation,
      url: new URL("https://example.com/"),
      documentLoader: documentLoader,
      contextLoader: documentLoader,
    });
    await ctx.sendActivity(
      [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      activity,
    );
    assertEquals(verified, ["http"]);
    assertInstanceOf(request, Request);
    assertEquals(request?.method, "POST");
    assertEquals(request?.url, "https://example.com/inbox");
    assertEquals(
      request?.headers.get("Content-Type"),
      "application/activity+json",
    );

    verified = null;
    await ctx.sendActivity(
      [{ privateKey: rsaPrivateKey3, keyId: rsaPublicKey3.id! }],
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      activity.clone({
        actor: new URL("https://example.com/person2"),
      }),
    );
    assertEquals(verified, ["ld", "http"]);
    assertInstanceOf(request, Request);
    assertEquals(request?.method, "POST");
    assertEquals(request?.url, "https://example.com/inbox");
    assertEquals(
      request?.headers.get("Content-Type"),
      "application/activity+json",
    );

    verified = null;
    await ctx.sendActivity(
      { identifier: "1" },
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      activity.clone({ actor: ctx.getActorUri("1") }),
    );
    assertEquals(verified, ["ld", "proof", "http"]);
    assertInstanceOf(request, Request);
    assertEquals(request?.method, "POST");
    assertEquals(request?.url, "https://example.com/inbox");
    assertEquals(
      request?.headers.get("Content-Type"),
      "application/activity+json",
    );

    verified = null;
    await ctx.sendActivity(
      { username: "john" },
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      activity.clone({ actor: ctx.getActorUri("1") }),
    );
    assertEquals(verified, ["ld", "proof", "http"]);
    assertInstanceOf(request, Request);
    assertEquals(request?.method, "POST");
    assertEquals(request?.url, "https://example.com/inbox");
    assertEquals(
      request?.headers.get("Content-Type"),
      "application/activity+json",
    );

    const actorEdKey = (await ctx.getActorKeyPairs("1")).find((key) =>
      key.privateKey.algorithm.name === "Ed25519"
    );
    assert(actorEdKey != null);
    assert(actorEdKey.multikey.id != null);
    const signedWithNormalizedProof = await signObject(
      new vocab.Create({
        id: new URL("https://example.com/activity/signed-attachment"),
        actor: ctx.getActorUri("1"),
        object: new vocab.Note({
          id: new URL("https://example.com/note/signed-attachment"),
          attachments: [
            new vocab.Document({
              mediaType: "image/png",
              url: new URL("https://example.com/signed-image.png"),
            }),
          ],
        }),
      }),
      actorEdKey.privateKey,
      actorEdKey.multikey.id,
      { contextLoader: documentLoader },
    );
    verified = null;
    await ctx.sendActivity(
      [{ privateKey: actorEdKey.privateKey, keyId: actorEdKey.multikey.id }],
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      signedWithNormalizedProof,
      { normalizeExistingProofs: true },
    );
    assertEquals(verified, ["proof"]);
    const postedSigned = await request?.json() as Record<string, unknown>;
    const postedSignedObject = postedSigned.object as Record<string, unknown>;
    assertEquals(Array.isArray(postedSignedObject.attachment), true);

    await assertRejects(() =>
      ctx.sendActivity(
        { identifier: "not-found" },
        {
          id: new URL("https://example.com/recipient"),
          inboxId: new URL("https://example.com/inbox"),
        },
        activity.clone({ actor: ctx.getActorUri("1") }),
      )
    );

    await assertRejects(() =>
      ctx.sendActivity(
        { username: "not-found" },
        {
          id: new URL("https://example.com/recipient"),
          inboxId: new URL("https://example.com/inbox"),
        },
        activity.clone({ actor: ctx.getActorUri("1") }),
      )
    );
  });

  await t.step("records recipient span attributes correctly", async () => {
    const [tracerProvider, exporter] = createTestTracerProvider();
    const federation3 = new FederationImpl<void>({
      kv,
      contextLoaderFactory: () => mockDocumentLoader,
      tracerProvider,
    });
    const ctx = federation3.createContext(
      new URL("https://example.com/"),
      undefined,
    );
    const activity = new vocab.Create({
      id: new URL("https://example.com/activity/telemetry"),
      actor: new URL("https://example.com/person"),
      to: new URL("https://example.com/to"),
      cc: new URL("https://example.com/cc"),
      bto: new URL("https://example.com/bto"),
      bcc: new URL("https://example.com/bcc"),
    });

    await ctx.sendActivity(
      [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      activity,
    );

    const span = exporter.getSpan("activitypub.outbox");
    assert(span != null);
    assertEquals(
      span.attributes["activitypub.activity.cc"],
      ["https://example.com/cc"],
    );
    assertEquals(
      span.attributes["activitypub.activity.bcc"],
      ["https://example.com/bcc"],
    );
  });

  const queue: MessageQueue & { messages: Message[]; clear(): void } = {
    messages: [],
    enqueue(message) {
      this.messages.push(message);
      return Promise.resolve();
    },
    async listen() {
    },
    clear() {
      while (this.messages.length > 0) this.messages.shift();
    },
  };
  const federation2 = new FederationImpl<void>({
    kv,
    contextLoaderFactory: () => mockDocumentLoader,
    queue,
  });
  federation2
    .setActorDispatcher("/{identifier}", async (ctx, identifier) => {
      if (identifier !== "john") return null;
      const keys = await ctx.getActorKeyPairs(identifier);
      return new vocab.Person({
        id: ctx.getActorUri(identifier),
        preferredUsername: "john",
        publicKey: keys[0].cryptographicKey,
        assertionMethods: keys.map((k) => k.multikey),
      });
    })
    .setKeyPairsDispatcher((_ctx, identifier) => {
      if (identifier !== "john") return [];
      return [
        { privateKey: rsaPrivateKey2, publicKey: rsaPublicKey2.publicKey! },
        {
          privateKey: ed25519PrivateKey,
          publicKey: ed25519PublicKey.publicKey!,
        },
      ];
    });
  const ctx2 = new ContextImpl({
    data: undefined,
    federation: federation2,
    url: new URL("https://example.com/"),
    documentLoader: documentLoader,
    contextLoader: documentLoader,
  });

  await t.step('fanout: "force"', async () => {
    const activity = new vocab.Create({
      id: new URL("https://example.com/activity/1"),
      actor: new URL("https://example.com/person"),
    });
    await ctx2.sendActivity(
      { username: "john" },
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      activity,
      { fanout: "force" },
    );
    assertEquals(queue.messages.length, 1);
    assert(queue.messages[0].type === "fanout");
    const fanoutMsg = queue.messages[0];
    assertEquals(fanoutMsg.activityId, "https://example.com/activity/1");
    assertEquals(
      fanoutMsg.activityType,
      "https://www.w3.org/ns/activitystreams#Create",
    );
    assertEquals(fanoutMsg.baseUrl, "https://example.com");
    assertEquals(fanoutMsg.collectionSync, undefined);
    assertEquals(fanoutMsg.orderingKey, undefined);
    assertEquals(fanoutMsg.inboxes, {
      "https://example.com/inbox": {
        actorIds: ["https://example.com/recipient"],
        sharedInbox: false,
      },
    });
    // Regression test for <https://github.com/fedify-dev/fedify/issues/663>:
    // The activity in the fanout message should be pre-signed with OIP before
    // fanout, and the proof must reference the Multikey ID (#multikey-N),
    // not the CryptographicKey ID (#main-key or #key-N):
    const signedActivity = await vocab.Create.fromJsonLd(fanoutMsg.activity, {
      contextLoader: documentLoader,
      documentLoader: documentLoader,
    });
    assertEquals(signedActivity.id?.href, "https://example.com/activity/1");
    let proofCount = 0;
    for await (
      const proof of signedActivity.getProofs({
        contextLoader: documentLoader,
      })
    ) {
      assertEquals(
        proof.verificationMethodId?.href,
        "https://example.com/john#multikey-2",
      );
      proofCount++;
    }
    assertEquals(proofCount, 1);
  });

  queue.clear();

  await t.step(
    'fanout: "force" preserves pre-signed proof normalization',
    async () => {
      const ctxForProof = new ContextImpl({
        data: undefined,
        federation,
        url: new URL("https://example.com/"),
        documentLoader: documentLoader,
        contextLoader: documentLoader,
      });
      const actorEdKey = (await ctxForProof.getActorKeyPairs("1")).find((key) =>
        key.privateKey.algorithm.name === "Ed25519"
      );
      assert(actorEdKey != null);
      assert(actorEdKey.multikey.id != null);
      const signedWithNormalizedProof = await signObject(
        new vocab.Create({
          id: new URL("https://example.com/activity/signed-attachment-fanout"),
          actor: ctxForProof.getActorUri("1"),
          object: new vocab.Note({
            id: new URL("https://example.com/note/signed-attachment-fanout"),
            attachments: [
              new vocab.Document({
                mediaType: "image/png",
                url: new URL("https://example.com/signed-fanout-image.png"),
              }),
            ],
          }),
        }),
        actorEdKey.privateKey,
        actorEdKey.multikey.id,
        { contextLoader: documentLoader },
      );
      await ctx2.sendActivity(
        [{ privateKey: actorEdKey.privateKey, keyId: actorEdKey.multikey.id }],
        {
          id: new URL("https://example.com/recipient"),
          inboxId: new URL("https://example.com/inbox"),
        },
        signedWithNormalizedProof,
        { fanout: "force", normalizeExistingProofs: true },
      );
      assertEquals(queue.messages.length, 1);
      assert(queue.messages[0].type === "fanout");
      const fanoutMsg = queue.messages[0];
      assertEquals(fanoutMsg.normalizeExistingProofs, true);

      queue.clear();
      await federation2.processQueuedTask(undefined, fanoutMsg);
      assertEquals(queue.messages.length, 1);
      const outboxMsg = queue.messages[0] as Message;
      assert(outboxMsg.type === "outbox");

      verified = null;
      await federation2.processQueuedTask(undefined, outboxMsg);
      assertEquals(verified, ["proof"]);
      const postedSigned = await request?.json() as Record<string, unknown>;
      const postedSignedObject = postedSigned.object as Record<string, unknown>;
      assertEquals(Array.isArray(postedSignedObject.attachment), true);
    },
  );

  queue.clear();

  await t.step('fanout: "skip"', async () => {
    const activity = new vocab.Create({
      id: new URL("https://example.com/activity/1"),
      actor: new URL("https://example.com/person"),
    });
    await ctx2.sendActivity(
      { username: "john" },
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      activity,
      { fanout: "skip" },
    );
    assertEquals(queue.messages, [
      {
        ...queue.messages[0],
        type: "outbox",
      },
    ]);
  });

  queue.clear();

  await t.step('fanout: "auto"', async () => {
    const activity = new vocab.Create({
      id: new URL("https://example.com/activity/1"),
      actor: new URL("https://example.com/person"),
    });
    await ctx2.sendActivity(
      { username: "john" },
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      activity,
      { fanout: "auto" },
    );
    assertEquals(queue.messages, [
      {
        ...queue.messages[0],
        type: "outbox",
      },
    ]);

    queue.clear();
    await ctx2.sendActivity(
      { username: "john" },
      [
        {
          id: new URL("https://example.com/recipient"),
          inboxId: new URL("https://example.com/inbox"),
        },
        {
          id: new URL("https://example2.com/recipient"),
          inboxId: new URL("https://example2.com/inbox"),
        },
        {
          id: new URL("https://example3.com/recipient"),
          inboxId: new URL("https://example3.com/inbox"),
        },
        {
          id: new URL("https://example4.com/recipient"),
          inboxId: new URL("https://example4.com/inbox"),
        },
        {
          id: new URL("https://example5.com/recipient"),
          inboxId: new URL("https://example5.com/inbox"),
        },
      ],
      activity,
      { fanout: "auto" },
    );
    assertEquals(queue.messages, [
      {
        ...queue.messages[0],
        type: "fanout",
      },
    ]);
  });

  await t.step(
    "fanout: fanoutQueue.enqueue() is awaited before sendActivity() returns",
    async () => {
      // Regression test for <https://github.com/fedify-dev/fedify/issues/661>.
      // The fanout branch of sendActivityInternal() must await
      // fanoutQueue.enqueue() so that the message is guaranteed to be
      // enqueued before sendActivity() returns.  On runtimes like Cloudflare
      // Workers that may terminate an isolate as soon as the response is sent,
      // a floating (non-awaited) enqueue() promise can be silently dropped,
      // causing fanout messages to be lost.
      //
      // This test uses a queue whose enqueue() resolves only after a
      // macro-task delay (setTimeout 0).  If enqueue() is not awaited,
      // sendActivity() will return before the message is recorded, and the
      // assertion below will fail.
      const asyncEnqueued: Message[] = [];
      const asyncQueue: MessageQueue = {
        enqueue(message: Message): Promise<void> {
          return new Promise<void>((resolve) => {
            setTimeout(() => {
              asyncEnqueued.push(message);
              resolve();
            }, 0);
          });
        },
        async listen(): Promise<void> {},
      };
      const fed = new FederationImpl<void>({
        kv,
        contextLoaderFactory: () => mockDocumentLoader,
        queue: asyncQueue,
        manuallyStartQueue: true,
      });
      fed
        .setActorDispatcher("/{identifier}", async (ctx, identifier) => {
          if (identifier !== "john") return null;
          const keys = await ctx.getActorKeyPairs(identifier);
          return new vocab.Person({
            id: ctx.getActorUri(identifier),
            preferredUsername: "john",
            publicKey: keys[0].cryptographicKey,
            assertionMethods: keys.map((k) => k.multikey),
          });
        })
        .setKeyPairsDispatcher((_ctx, identifier) => {
          if (identifier !== "john") return [];
          return [
            { privateKey: rsaPrivateKey2, publicKey: rsaPublicKey2.publicKey! },
            {
              privateKey: ed25519PrivateKey,
              publicKey: ed25519PublicKey.publicKey!,
            },
          ];
        });
      const ctx3 = new ContextImpl({
        data: undefined,
        federation: fed,
        url: new URL("https://example.com/"),
        documentLoader: mockDocumentLoader,
        contextLoader: mockDocumentLoader,
      });
      const activity = new vocab.Create({
        id: new URL("https://example.com/activity/1"),
        actor: new URL("https://example.com/person"),
      });
      await ctx3.sendActivity(
        { username: "john" },
        {
          id: new URL("https://example.com/recipient"),
          inboxId: new URL("https://example.com/inbox"),
        },
        activity,
        { fanout: "force" },
      );
      assertEquals(
        asyncEnqueued.length,
        1,
        "fanoutQueue.enqueue() must be awaited before sendActivity() returns",
      );
    },
  );

  collectionSyncHeader = null;

  await t.step("followers collection without syncCollection", async () => {
    const ctx = new ContextImpl({
      data: undefined,
      federation,
      url: new URL("https://example.com/"),
      documentLoader: documentLoader,
      contextLoader: documentLoader,
    });

    const activity = new vocab.Create({
      id: new URL("https://example.com/activity/1"),
      actor: ctx.getActorUri("1"),
      to: ctx.getFollowersUri("1"),
    });

    await ctx.sendActivity({ identifier: "1" }, "followers", activity);

    assertEquals(collectionSyncHeader, null);
  });

  collectionSyncHeader = null;

  await t.step("followers collection with syncCollection", async () => {
    const ctx = new ContextImpl({
      data: undefined,
      federation,
      url: new URL("https://example.com/"),
      documentLoader: documentLoader,
      contextLoader: documentLoader,
    });

    const activity = new vocab.Create({
      id: new URL("https://example.com/activity/2"),
      actor: ctx.getActorUri("1"),
      to: ctx.getFollowersUri("1"),
    });

    await ctx.sendActivity(
      { identifier: "1" },
      "followers",
      activity,
      { syncCollection: true, preferSharedInbox: true },
    );

    assertNotEquals(collectionSyncHeader, null);
  });

  queue.clear();

  await t.step('orderingKey with fanout: "force"', async () => {
    const activity = new vocab.Create({
      id: new URL("https://example.com/activity/ordering-1"),
      actor: new URL("https://example.com/person"),
    });
    await ctx2.sendActivity(
      { username: "john" },
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      activity,
      { fanout: "force", orderingKey: "https://example.com/note/1" },
    );
    assertEquals(queue.messages.length, 1);
    const fanoutMessage = queue.messages[0];
    assertEquals(fanoutMessage.type, "fanout");
    if (fanoutMessage.type === "fanout") {
      assertEquals(
        fanoutMessage.orderingKey,
        "https://example.com/note/1",
      );
    }
  });

  queue.clear();

  await t.step('orderingKey with fanout: "skip"', async () => {
    const activity = new vocab.Create({
      id: new URL("https://example.com/activity/ordering-2"),
      actor: new URL("https://example.com/person"),
    });
    await ctx2.sendActivity(
      { username: "john" },
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      activity,
      { fanout: "skip", orderingKey: "https://example.com/note/2" },
    );
    assertEquals(queue.messages.length, 1);
    const outboxMessage = queue.messages[0];
    assertEquals(outboxMessage.type, "outbox");
    // outbox message should have orderingKey transformed to include inbox origin
    if (outboxMessage.type === "outbox") {
      assertEquals(
        outboxMessage.orderingKey,
        "https://example.com/note/2\nhttps://example.com",
      );
    }
  });

  queue.clear();

  await t.step("orderingKey not specified", async () => {
    const activity = new vocab.Create({
      id: new URL("https://example.com/activity/ordering-3"),
      actor: new URL("https://example.com/person"),
    });
    await ctx2.sendActivity(
      { username: "john" },
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      activity,
      { fanout: "force" },
    );
    assertEquals(queue.messages.length, 1);
    const fanoutMessage2 = queue.messages[0];
    assertEquals(fanoutMessage2.type, "fanout");
    if (fanoutMessage2.type === "fanout") {
      assertEquals(fanoutMessage2.orderingKey, undefined);
    }
  });

  fetchMock.hardReset();
});

test("ContextImpl.sendActivity() records fanout recipient metrics", async () => {
  const kv = new MemoryKvStore();
  const [meterProvider, recorder] = createTestMeterProvider();
  const queue: MessageQueue & { messages: Message[] } = {
    messages: [],
    enqueue(message) {
      this.messages.push(message);
      return Promise.resolve();
    },
    async listen() {},
  };
  const federation = new FederationImpl<void>({
    kv,
    contextLoaderFactory: () => mockDocumentLoader,
    queue,
    meterProvider,
  });
  federation
    .setActorDispatcher("/{identifier}", async (ctx, identifier) => {
      if (identifier !== "john") return null;
      const keys = await ctx.getActorKeyPairs(identifier);
      return new vocab.Person({
        id: ctx.getActorUri(identifier),
        preferredUsername: "john",
        publicKey: keys[0].cryptographicKey,
        assertionMethods: keys.map((k) => k.multikey),
      });
    })
    .setKeyPairsDispatcher((_ctx, identifier) => {
      if (identifier !== "john") return [];
      return [
        { privateKey: rsaPrivateKey2, publicKey: rsaPublicKey2.publicKey! },
        {
          privateKey: ed25519PrivateKey,
          publicKey: ed25519PublicKey.publicKey!,
        },
      ];
    });
  const ctx = new ContextImpl({
    data: undefined,
    federation,
    url: new URL("https://example.com/"),
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  const activity = new vocab.Create({
    id: new URL("https://example.com/activity/1"),
    actor: new URL("https://example.com/person"),
  });
  const recipients = Array.from({ length: 7 }, (_, i) => ({
    id: new URL(`https://example${i + 1}.com/recipient`),
    inboxId: new URL(`https://example${i + 1}.com/inbox`),
  }));
  await ctx.sendActivity({ username: "john" }, recipients, activity, {
    fanout: "force",
  });

  assertEquals(queue.messages.length, 1);
  assertEquals(queue.messages[0].type, "fanout");

  const measurements = recorder.getMeasurements(
    "activitypub.fanout.recipients",
  );
  assertEquals(measurements.length, 1);
  assertEquals(measurements[0].type, "histogram");
  assertEquals(measurements[0].value, recipients.length);
  assertEquals(
    measurements[0].attributes["activitypub.activity.type"],
    "https://www.w3.org/ns/activitystreams#Create",
  );
});

test({
  name: "ContextImpl.routeActivity()",
  permissions: { env: true, read: true },
  async fn() {
    const federation = new FederationImpl({
      kv: new MemoryKvStore(),
    });

    const activities: [string | null, vocab.Activity][] = [];
    federation
      .setInboxListeners("/u/{identifier}/i", "/i")
      .on(vocab.Offer, (ctx, offer) => {
        activities.push([ctx.recipient, offer]);
      });

    const ctx = new ContextImpl({
      url: new URL("https://example.com/"),
      federation,
      data: undefined,
      documentLoader: mockDocumentLoader,
      contextLoader: documentLoader,
    });

    // Unsigned & non-dereferenceable activity
    assertFalse(
      await ctx.routeActivity(
        null,
        new vocab.Offer({
          actor: new URL("https://example.com/person"),
        }),
      ),
    );
    assertEquals(activities, []);

    // Signed activity without recipient (shared inbox)
    const signedOffer = await signObject(
      new vocab.Offer({
        actor: new URL("https://example.com/person2"),
      }),
      ed25519PrivateKey,
      ed25519Multikey.id!,
    );
    assert(await ctx.routeActivity(null, signedOffer));
    assertEquals(activities, [[null, signedOffer]]);

    // Signed activity with recipient (personal inbox)
    const signedInvite = await signObject(
      new vocab.Invite({
        actor: new URL("https://example.com/person2"),
      }),
      ed25519PrivateKey,
      ed25519Multikey.id!,
    );
    assert(await ctx.routeActivity("id", signedInvite));
    assertEquals(activities, [[null, signedOffer], ["id", signedInvite]]);

    // Unsigned activity dereferenced to 404
    assertFalse(
      await ctx.routeActivity(
        null,
        new vocab.Create({
          id: new URL("https://example.com/not-found"),
          actor: new URL("https://example.com/person"),
        }),
      ),
    );
    assertEquals(activities, [[null, signedOffer], ["id", signedInvite]]);

    // Unsigned activity dereferenced to 200, but not an Activity
    assertFalse(
      await ctx.routeActivity(
        null,
        new vocab.Create({
          id: new URL("https://example.com/person"),
          actor: new URL("https://example.com/person"),
        }),
      ),
    );
    assertEquals(activities, [[null, signedOffer], ["id", signedInvite]]);

    // Unsigned activity dereferenced to 200, but has a different id
    assertFalse(
      await ctx.routeActivity(
        null,
        new vocab.Announce({
          id: new URL("https://example.com/announce#diffrent-id"),
          actor: new URL("https://example.com/person"),
        }),
      ),
    );
    assertEquals(activities, [[null, signedOffer], ["id", signedInvite]]);

    // Unsigned activity dereferenced to 200, but has no actor
    assertFalse(
      await ctx.routeActivity(
        null,
        new vocab.Announce({
          id: new URL("https://example.com/announce"),
          // Although the actor is set here, the fetched document has no actor.
          // See also fedify/testing/fixtures/example.com/announce
          actor: new URL("https://example.com/person"),
        }),
      ),
    );
    assertEquals(activities, [[null, signedOffer], ["id", signedInvite]]);

    // Unsigned activity dereferenced to 200, but actor is cross-origin
    assertFalse(
      await ctx.routeActivity(
        null,
        new vocab.Create({
          id: new URL("https://example.com/cross-origin-actor"),
          actor: new URL("https://cross-origin.com/actor"),
        }),
      ),
    );
    assertEquals(activities, [[null, signedOffer], ["id", signedInvite]]);

    // Unsigned activity dereferenced to 200, but no inbox listener corresponds
    assert(
      await ctx.routeActivity(
        null,
        new vocab.Create({
          id: new URL("https://example.com/create"),
          actor: new URL("https://example.com/person"),
        }),
      ),
    );
    assertEquals(activities, [[null, signedOffer], ["id", signedInvite]]);

    // Unsigned activity dereferenced to 200
    assert(
      await ctx.routeActivity(
        null,
        new vocab.Invite({
          id: new URL("https://example.com/invite"),
          actor: new URL("https://example.com/person"),
        }),
      ),
    );
    assertEquals(
      activities,
      [
        [null, signedOffer],
        ["id", signedInvite],
        [
          null,
          new vocab.Invite({
            id: new URL("https://example.com/invite"),
            actor: new URL("https://example.com/person"),
            object: new URL("https://example.com/object"),
          }),
        ],
      ],
    );
  },
});

test({
  name: "ContextImpl.routeActivity() forwards meterProvider to inbox enqueue",
  permissions: { env: true, read: true },
  async fn() {
    const [meterProvider, recorder] = createTestMeterProvider();
    const enqueued: Message[] = [];
    const queue: MessageQueue = {
      enqueue(message): Promise<void> {
        enqueued.push(message);
        return Promise.resolve();
      },
      listen(): Promise<void> {
        return Promise.resolve();
      },
    };
    const federation = new FederationImpl<void>({
      kv: new MemoryKvStore(),
      meterProvider,
      queue,
    });
    federation.setInboxListeners("/u/{identifier}/i", "/i");

    const ctx = new ContextImpl({
      url: new URL("https://example.com/"),
      federation,
      data: undefined,
      documentLoader: mockDocumentLoader,
      contextLoader: documentLoader,
    });

    const signedOffer = await signObject(
      new vocab.Offer({
        actor: new URL("https://example.com/person2"),
      }),
      ed25519PrivateKey,
      ed25519Multikey.id!,
    );
    assert(await ctx.routeActivity(null, signedOffer));
    assertEquals(enqueued.length, 1);

    const enqueuedMetrics = recorder.getMeasurements(
      "fedify.queue.task.enqueued",
    );
    assertEquals(enqueuedMetrics.length, 1);
    assertEquals(
      enqueuedMetrics[0].attributes["fedify.queue.role"],
      "inbox",
    );
    assertEquals(
      enqueuedMetrics[0].attributes["fedify.queue.task.attempt"],
      0,
    );
  },
});

test({
  name: "ContextImpl.routeActivity() records inbox.activity lifecycle metrics",
  permissions: { env: true, read: true },
  async fn() {
    const [meterProvider, recorder] = createTestMeterProvider();
    const queue: MessageQueue = {
      enqueue(): Promise<void> {
        return Promise.resolve();
      },
      listen(): Promise<void> {
        return Promise.resolve();
      },
    };
    const federation = new FederationImpl<void>({
      kv: new MemoryKvStore(),
      meterProvider,
      queue,
    });
    federation.setInboxListeners("/u/{identifier}/i", "/i");

    const ctx = new ContextImpl({
      url: new URL("https://example.com/"),
      federation,
      data: undefined,
      documentLoader: mockDocumentLoader,
      contextLoader: documentLoader,
    });

    const signedOffer = await signObject(
      new vocab.Offer({
        id: new URL("https://example.com/offer-queued"),
        actor: new URL("https://example.com/person2"),
      }),
      ed25519PrivateKey,
      ed25519Multikey.id!,
    );
    assert(await ctx.routeActivity(null, signedOffer));

    const queued = recorder.getMeasurements("activitypub.inbox.activity");
    assertEquals(queued.length, 1);
    assertEquals(queued[0].type, "counter");
    assertEquals(
      queued[0].attributes["activitypub.processing.result"],
      "queued",
    );
    assertEquals(
      queued[0].attributes["activitypub.activity.type"],
      "https://www.w3.org/ns/activitystreams#Offer",
    );
  },
});

test({
  name:
    "ContextImpl.routeActivity() records inbox.activity processed without queue",
  permissions: { env: true, read: true },
  async fn() {
    const [meterProvider, recorder] = createTestMeterProvider();
    const federation = new FederationImpl<void>({
      kv: new MemoryKvStore(),
      meterProvider,
    });
    federation.setInboxListeners("/u/{identifier}/i", "/i")
      .on(vocab.Offer, () => {});

    const ctx = new ContextImpl({
      url: new URL("https://example.com/"),
      federation,
      data: undefined,
      documentLoader: mockDocumentLoader,
      contextLoader: documentLoader,
    });

    const signedOffer = await signObject(
      new vocab.Offer({
        id: new URL("https://example.com/offer-processed"),
        actor: new URL("https://example.com/person2"),
      }),
      ed25519PrivateKey,
      ed25519Multikey.id!,
    );
    assert(await ctx.routeActivity(null, signedOffer));

    const processed = recorder.getMeasurements("activitypub.inbox.activity");
    assertEquals(processed.length, 1);
    assertEquals(
      processed[0].attributes["activitypub.processing.result"],
      "processed",
    );
    assertEquals(
      processed[0].attributes["activitypub.activity.type"],
      "https://www.w3.org/ns/activitystreams#Offer",
    );
  },
});

test({
  name:
    "ContextImpl.routeActivity() records inbox.activity rejected for unsupported type and duplicates",
  permissions: { env: true, read: true },
  async fn() {
    const [meterProvider, recorder] = createTestMeterProvider();
    const federation = new FederationImpl<void>({
      kv: new MemoryKvStore(),
      meterProvider,
    });
    federation.setInboxListeners("/u/{identifier}/i", "/i")
      .on(vocab.Offer, () => {});

    const ctx = new ContextImpl({
      url: new URL("https://example.com/"),
      federation,
      data: undefined,
      documentLoader: mockDocumentLoader,
      contextLoader: documentLoader,
    });

    // Unsupported activity type (Create has no listener).
    const signedCreate = await signObject(
      new vocab.Create({
        id: new URL("https://example.com/create-unsupported"),
        actor: new URL("https://example.com/person2"),
      }),
      ed25519PrivateKey,
      ed25519Multikey.id!,
    );
    assert(await ctx.routeActivity(null, signedCreate));

    // Duplicate Offer activity (re-route same id → idempotency cache hit).
    const dupOffer = await signObject(
      new vocab.Offer({
        id: new URL("https://example.com/offer-duplicate"),
        actor: new URL("https://example.com/person2"),
      }),
      ed25519PrivateKey,
      ed25519Multikey.id!,
    );
    assert(await ctx.routeActivity(null, dupOffer));
    assert(await ctx.routeActivity(null, dupOffer));

    const measurements = recorder.getMeasurements("activitypub.inbox.activity");
    const rejected = measurements.filter((m) =>
      m.attributes["activitypub.processing.result"] === "rejected"
    );
    // One for the unsupported Create, one for the duplicate Offer.
    assertEquals(rejected.length, 2);
    assertEquals(
      rejected[0].attributes["activitypub.activity.type"],
      "https://www.w3.org/ns/activitystreams#Create",
    );
    assertEquals(
      rejected[1].attributes["activitypub.activity.type"],
      "https://www.w3.org/ns/activitystreams#Offer",
    );
  },
});

test("ContextImpl.routeActivity() marks queued signed activities as non-LDS", async () => {
  let queuedMessage: InboxMessage | null = null;
  const queue: MessageQueue = {
    enqueue(message) {
      queuedMessage = message as InboxMessage;
      return Promise.resolve();
    },
    async listen() {
    },
  };
  const federation = new FederationImpl({
    kv: new MemoryKvStore(),
    queue,
  });
  federation
    .setInboxListeners("/u/{identifier}/i", "/i")
    .on(Offer, () => {
      throw new Error("listener should not run for queued routeActivity");
    });

  const ctx = new ContextImpl({
    url: new URL("https://example.com/"),
    federation,
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: documentLoader,
  });

  const signedOffer = await signObject(
    new Offer({
      actor: new URL("https://example.com/person2"),
    }),
    ed25519PrivateKey,
    ed25519Multikey.id!,
  );
  assert(await ctx.routeActivity(null, signedOffer));
  if (queuedMessage == null) throw new Error("Inbox message not queued.");
  const inboxMessage = queuedMessage as InboxMessage;
  assertEquals(inboxMessage.ldSignatureVerified, false);
  assertEquals(inboxMessage.normalizedActivity, undefined);
});

test("ContextImpl.getCollectionUri()", () => {
  const federation = new FederationImpl({ kv: new MemoryKvStore() });
  const base = "https://example.com";

  const ctx = new ContextImpl({
    url: new URL(base),
    federation,
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: documentLoader,
  });

  const values = { id: "123" };
  const dispatcher = (_ctx: unknown, _values: { id: string }) => ({
    items: [],
  });
  let url: URL;
  // Registered with string name
  const strName = "registered";

  federation.setCollectionDispatcher(
    strName,
    vocab.Object,
    "/string-route/{id}",
    dispatcher,
  );
  url = ctx.getCollectionUri(strName, values);
  assertEquals(url.href, `${base}/string-route/123`);

  // Registered with unnamed symbol name
  const unnamedSymName = Symbol(strName);
  federation.setCollectionDispatcher(
    unnamedSymName,
    vocab.Object,
    "/symbol-route/{id}",
    dispatcher,
  );
  url = ctx.getCollectionUri(unnamedSymName, values);
  assertEquals(url.href, `${base}/symbol-route/123`);

  // Registered with named symbol name
  const namedSymName = Symbol.for(strName);
  federation.setCollectionDispatcher(
    namedSymName,
    vocab.Object,
    "/named-symbol-route/{id}",
    dispatcher,
  );
  url = ctx.getCollectionUri(namedSymName, values);
  assertEquals(url.href, `${base}/named-symbol-route/123`);

  // Not registered
  const notReg = "not-registered";
  assertThrows(() => ctx.getCollectionUri(notReg, values));
  assertThrows(() => ctx.getCollectionUri(Symbol(notReg), values));
  assertThrows(() => ctx.getCollectionUri(Symbol.for(notReg), values));
});

test("InboxContextImpl.forwardActivity()", async (t) => {
  fetchMock.spyGlobal();

  let verified: ("http" | "ld" | "proof")[] | null = null;
  let request: Request | null = null;
  fetchMock.post("https://example.com/inbox", async (cl) => {
    verified = [];
    request = cl.request!.clone() as Request;
    const options = {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
    };
    let json = await cl.request!.json();
    if (await verifyJsonLd(json, options)) verified.push("ld");
    json = detachSignature(json);
    let activity = await verifyObject(vocab.Activity, json, options);
    if (activity == null) {
      activity = await vocab.Activity.fromJsonLd(json, options);
    } else {
      verified.push("proof");
    }
    const key = await verifyRequest(request, options);
    if (key != null && await doesActorOwnKey(activity, key, options)) {
      verified.push("http");
    }
    if (verified.length > 0) return new Response(null, { status: 202 });
    return new Response(null, { status: 401 });
  });

  const kv = new MemoryKvStore();
  const federation = new FederationImpl<void>({
    kv,
    contextLoaderFactory: () => mockDocumentLoader,
  });

  await t.step("skip", async () => {
    const activity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Create",
      "id": "https://example.com/activity",
      "actor": "https://example.com/person2",
    };
    const ctx = new InboxContextImpl(
      null,
      activity,
      "https://example.com/activity",
      "https://www.w3.org/ns/activitystreams#Create",
      {
        data: undefined,
        federation,
        url: new URL("https://example.com/"),
        documentLoader: documentLoader,
        contextLoader: documentLoader,
      },
    );
    await ctx.forwardActivity(
      [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      { skipIfUnsigned: true },
    );
    assertEquals(verified, null);
  });

  await t.step("unsigned", async () => {
    const activity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Create",
      "id": "https://example.com/activity",
      "actor": "https://example.com/person2",
    };
    const ctx = new InboxContextImpl(
      null,
      activity,
      "https://example.com/activity",
      "https://www.w3.org/ns/activitystreams#Create",
      {
        data: undefined,
        federation,
        url: new URL("https://example.com/"),
        documentLoader: documentLoader,
        contextLoader: documentLoader,
      },
    );
    await assertRejects(() =>
      ctx.forwardActivity(
        [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
        {
          id: new URL("https://example.com/recipient"),
          inboxId: new URL("https://example.com/inbox"),
        },
      )
    );
    assertEquals(verified, []);
  });

  await t.step("Object Integrity Proofs", async () => {
    const activity = await signObject(
      new vocab.Create({
        id: new URL("https://example.com/activity"),
        actor: new URL("https://example.com/person2"),
      }),
      ed25519PrivateKey,
      ed25519Multikey.id!,
      { contextLoader: mockDocumentLoader, documentLoader: mockDocumentLoader },
    );
    const ctx = new InboxContextImpl(
      null,
      await activity.toJsonLd({ contextLoader: mockDocumentLoader }),
      activity.id?.href,
      getTypeId(activity).href,
      {
        data: undefined,
        federation,
        url: new URL("https://example.com/"),
        documentLoader: documentLoader,
        contextLoader: documentLoader,
      },
    );
    await ctx.forwardActivity(
      [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      { skipIfUnsigned: true },
    );
    assertEquals(verified, ["proof"]);
  });

  await t.step("LD Signatures", async () => {
    const activity = await signJsonLd(
      {
        "@context": "https://www.w3.org/ns/activitystreams",
        "type": "Create",
        "id": "https://example.com/activity",
        "actor": "https://example.com/person2",
      },
      rsaPrivateKey3,
      rsaPublicKey3.id!,
      { contextLoader: mockDocumentLoader },
    );
    const ctx = new InboxContextImpl(
      null,
      activity,
      "https://example.com/activity",
      "https://www.w3.org/ns/activitystreams#Create",
      {
        data: undefined,
        federation,
        url: new URL("https://example.com/"),
        documentLoader: documentLoader,
        contextLoader: documentLoader,
      },
    );
    await ctx.forwardActivity(
      [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      { skipIfUnsigned: true },
    );
    assertEquals(verified, ["ld"]);
  });

  await t.step("alternate LD signature shapes", async () => {
    const activity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Create",
      "id": "https://example.com/activity",
      "actor": "https://example.com/person2",
      "signature": {
        "type": "Ed25519Signature2020",
        "verificationMethod": {
          "id": "https://example.com/person2#main-key",
        },
        "jws": "signature",
      },
    };
    const ctx = new InboxContextImpl(
      null,
      activity,
      "https://example.com/activity",
      "https://www.w3.org/ns/activitystreams#Create",
      {
        data: undefined,
        federation,
        url: new URL("https://example.com/"),
        documentLoader: documentLoader,
        contextLoader: documentLoader,
      },
    );
    await assertRejects(() =>
      ctx.forwardActivity(
        [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
        {
          id: new URL("https://example.com/recipient"),
          inboxId: new URL("https://example.com/inbox"),
        },
        { skipIfUnsigned: true },
      )
    );
    assertEquals(verified, []);
  });

  await t.step("records inbox forwarding span name", async () => {
    const [tracerProvider, exporter] = createTestTracerProvider();
    const federationWithTracing = new FederationImpl<void>({
      kv,
      contextLoaderFactory: () => mockDocumentLoader,
      tracerProvider,
    });
    const activity = await signJsonLd(
      {
        "@context": "https://www.w3.org/ns/activitystreams",
        "type": "Create",
        "id": "https://example.com/activity",
        "actor": "https://example.com/person2",
      },
      rsaPrivateKey3,
      rsaPublicKey3.id!,
      { contextLoader: mockDocumentLoader },
    );
    const ctx = new InboxContextImpl(
      null,
      activity,
      "https://example.com/activity",
      "https://www.w3.org/ns/activitystreams#Create",
      {
        data: undefined,
        federation: federationWithTracing,
        url: new URL("https://example.com/"),
        documentLoader: documentLoader,
        contextLoader: documentLoader,
      },
    );

    await ctx.forwardActivity(
      [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      { skipIfUnsigned: true },
    );

    assertEquals(exporter.getSpans("activitypub.inbox").length, 1);
    assertEquals(exporter.getSpans("activitypub.outbox").length, 0);
  });

  fetchMock.hardReset();
});

test("KvSpecDeterminer", async (t) => {
  await t.step("should use default spec when not found in KV", async () => {
    const kv = new MemoryKvStore();
    const prefix = ["test", "spec"] as const;

    // Test with default rfc9421
    const determiner = new KvSpecDeterminer(kv, prefix);
    const spec = await determiner.determineSpec("example.com");
    assertEquals(spec, "rfc9421");
  });

  await t.step("should use custom default spec", async () => {
    const kv = new MemoryKvStore();
    const prefix = ["test", "spec"] as const;

    // Test with custom default spec
    const determiner = new KvSpecDeterminer(
      kv,
      prefix,
      "draft-cavage-http-signatures-12",
    );
    const spec = await determiner.determineSpec("example.com");
    assertEquals(spec, "draft-cavage-http-signatures-12");
  });

  await t.step("should remember and retrieve spec from KV", async () => {
    const kv = new MemoryKvStore();
    const prefix = ["test", "spec"] as const;
    const determiner = new KvSpecDeterminer(kv, prefix);

    // Remember a spec for a specific origin
    await determiner.rememberSpec(
      "example.com",
      "draft-cavage-http-signatures-12",
    );

    // Should retrieve the remembered spec
    const spec = await determiner.determineSpec("example.com");
    assertEquals(spec, "draft-cavage-http-signatures-12");

    // Different origin should still use default
    const defaultSpec = await determiner.determineSpec("other.com");
    assertEquals(defaultSpec, "rfc9421");
  });

  await t.step("should override remembered spec", async () => {
    const kv = new MemoryKvStore();
    const prefix = ["test", "spec"] as const;
    const determiner = new KvSpecDeterminer(kv, prefix);

    // Remember initial spec
    await determiner.rememberSpec(
      "example.com",
      "draft-cavage-http-signatures-12",
    );
    let spec = await determiner.determineSpec("example.com");
    assertEquals(spec, "draft-cavage-http-signatures-12");

    // Override with new spec
    await determiner.rememberSpec("example.com", "rfc9421");
    spec = await determiner.determineSpec("example.com");
    assertEquals(spec, "rfc9421");
  });
});

test("createFederation() instruments documentLoader with activitypub.document.fetch", async () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  const kv = new MemoryKvStore();
  const federation = createFederation<void>({
    kv,
    meterProvider,
    documentLoaderFactory: () => mockDocumentLoader,
    contextLoaderFactory: () => mockDocumentLoader,
  });
  const ctx = federation.createContext(
    new URL("https://example.com/"),
    undefined,
  );
  await ctx.documentLoader("https://example.com/object");

  const counters = recorder.getMeasurements("activitypub.document.fetch");
  assertEquals(counters.length, 1);
  assertEquals(counters[0].attributes["activitypub.lookup.kind"], "object");
  assertEquals(counters[0].attributes["activitypub.lookup.result"], "fetched");
  assertEquals(
    counters[0].attributes["activitypub.remote.host"],
    "example.com",
  );
  // User-supplied factory: cacheEnabled is unknown, attribute is omitted.
  assertFalse("activitypub.cache.enabled" in counters[0].attributes);
});

test("createFederation() records kind=context on contextLoader fetches", async () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  const kv = new MemoryKvStore();
  const federation = createFederation<void>({
    kv,
    meterProvider,
    documentLoaderFactory: () => mockDocumentLoader,
    contextLoaderFactory: () => mockDocumentLoader,
  });
  const ctx = federation.createContext(
    new URL("https://example.com/"),
    undefined,
  );
  await ctx.contextLoader("https://example.com/object");

  const counters = recorder.getMeasurements("activitypub.document.fetch");
  assertEquals(counters.length, 1);
  assertEquals(counters[0].attributes["activitypub.lookup.kind"], "context");
});

test("createFederation() forwards DocumentLoaderFactoryOptions to a user-supplied authenticatedDocumentLoaderFactory", () => {
  const kv = new MemoryKvStore();
  const seen: Array<unknown> = [];
  const federation = createFederation<void>({
    kv,
    authenticatedDocumentLoaderFactory: (_identity, opts) => {
      seen.push(opts);
      return mockDocumentLoader;
    },
  });
  // FederationImpl exposes the factory directly on the instance.
  const impl = federation as unknown as {
    authenticatedDocumentLoaderFactory: (
      identity: { keyId: URL; privateKey: CryptoKey },
      opts?: { allowPrivateAddress?: boolean; userAgent?: string },
    ) => unknown;
  };
  impl.authenticatedDocumentLoaderFactory(
    {
      keyId: new URL("https://example.com/users/alice#main-key"),
      // deno-lint-ignore no-explicit-any
      privateKey: {} as any,
    },
    { allowPrivateAddress: true, userAgent: "test-ua" },
  );
  assertEquals(seen.length, 1);
  assertEquals(seen[0], { allowPrivateAddress: true, userAgent: "test-ua" });
});

test("createFederation() omits instrumentation when no meterProvider is set", () => {
  // Sanity: without a meterProvider, ctx.documentLoader must be the same
  // function reference as the user-supplied loader, so the wrapper is a
  // true no-op for non-OTel users.
  const kv = new MemoryKvStore();
  const federation = createFederation<void>({
    kv,
    documentLoaderFactory: () => mockDocumentLoader,
    contextLoaderFactory: () => mockDocumentLoader,
  });
  const ctx = federation.createContext(
    new URL("https://example.com/"),
    undefined,
  );
  assertStrictEquals(ctx.documentLoader, mockDocumentLoader);
  assertStrictEquals(ctx.contextLoader, mockDocumentLoader);
});

const taskCodec = new TaskCodec({ contextLoader: mockDocumentLoader });
const decodeEnvelope = async (message: TaskMessage): Promise<Envelope> => {
  const decoded = await taskCodec.decode(envelopeSchema, message.data);
  if (!decoded.ok) throw decoded.error;
  return decoded.value;
};
const envelope = (title: string): Envelope => ({
  note: new Note({ content: title }),
  title,
});

class RendezvousQueue implements MessageQueue {
  readonly enqueued: {
    message: TaskMessage;
    options?: MessageQueueEnqueueOptions;
  }[] = [];
  #count = 0;
  #markDispatched!: () => void;
  #openGate!: () => void;
  readonly dispatched: Promise<void>;
  readonly #gate: Promise<void>;

  constructor(readonly expected: number) {
    this.dispatched = new Promise<void>((resolve) => {
      this.#markDispatched = resolve;
    });
    this.#gate = new Promise<void>((resolve) => {
      this.#openGate = resolve;
    });
  }

  release(): void {
    this.#openGate();
  }

  // deno-lint-ignore no-explicit-any
  enqueue(message: any, options?: MessageQueueEnqueueOptions): Promise<void> {
    this.enqueued.push({ message, options });
    if (++this.#count >= this.expected) this.#markDispatched();
    return this.#gate;
  }

  listen(
    // deno-lint-ignore no-explicit-any
    _handler: (message: any) => Promise<void> | void,
    _options?: MessageQueueListenOptions,
  ): Promise<void> {
    return new Promise<never>(() => {});
  }
}

const withTimeout = <T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

// A factory, not a shared constant: each task test gets its own
// MemoryKvStore so deduplication markers never leak across tests and the
// suite stays order-independent as more cases are added.
const mockOptions = () => ({
  kv: new MemoryKvStore(),
  documentLoaderFactory: () => mockDocumentLoader,
  contextLoaderFactory: () => mockDocumentLoader,
  manuallyStartQueue: true,
});

test("ContextImpl.enqueueTask()", async (t) => {
  await t.step(
    "builds the task message envelope and round-trips a vocab payload",
    async () => {
      const queue = new MockQueue({ supportsEnqueueMany: true });
      const federation = createFederation<void>({
        ...mockOptions(),
        queue: { task: queue },
      });
      const task = federation.defineTask("greet", {
        schema: envelopeSchema,
        handler: () => {},
      });
      const ctx = federation.createContext(
        new URL("https://example.com/"),
        undefined,
      );
      ok(ctx instanceof ContextImpl);
      await ctx.enqueueTask(task, envelope("greeting"));
      strictEqual(queue.enqueuedMany.length, 0);
      strictEqual(queue.enqueued.length, 1);
      const { message } = queue.enqueued[0];
      strictEqual(message.type, "task");
      strictEqual(message.taskName, "greet");
      strictEqual(message.baseUrl, "https://example.com");
      strictEqual(message.attempt, 0);
      ok(/^[0-9a-f-]{36}$/i.test(message.id));
      // `started` must be a parseable instant; Temporal.Instant.from throws
      // otherwise.
      ok(Temporal.Instant.from(message.started) instanceof Temporal.Instant);
      strictEqual(typeof message.traceContext, "object");
      ok(message.traceContext != null);
      // A vocab object must survive the producer-side encode as JSON-LD.
      const decoded = await decodeEnvelope(message);
      ok(decoded.note instanceof Note);
      strictEqual(decoded.note.content?.toString(), "greeting");
      strictEqual(decoded.title, "greeting");
    },
  );
});

test("ContextImpl.enqueueTaskMany()", async (t) => {
  await t.step(
    "round-trips every payload through enqueueMany in order, forwarding options",
    async () => {
      const queue = new MockQueue({ supportsEnqueueMany: true });
      const federation = createFederation<void>({
        ...mockOptions(),
        queue: { task: queue },
      });
      const task = federation.defineTask("bulk", {
        schema: envelopeSchema,
        handler: () => {},
      });
      const ctx = federation.createContext(
        new URL("https://example.com/"),
        undefined,
      );
      const payloads = [envelope("a"), envelope("b"), envelope("c")];
      await ctx.enqueueTaskMany(task, payloads, {
        delay: { seconds: 30 },
        orderingKey: "batch",
      });
      strictEqual(queue.enqueued.length, 0);
      strictEqual(queue.enqueuedMany.length, 1);
      const { messages, options } = queue.enqueuedMany[0];
      ok(options?.delay instanceof Temporal.Duration);
      strictEqual(options.delay.total("second"), 30);
      strictEqual(options.orderingKey, "batch");
      const decoded = await Promise.all(messages.map(decodeEnvelope));
      deepStrictEqual(decoded.map((d) => d.title), ["a", "b", "c"]);
      for (const message of messages) strictEqual(message.orderingKey, "batch");
    },
  );

  await t.step(
    "with a single payload uses enqueue() instead of enqueueMany",
    async () => {
      const queue = new MockQueue({ supportsEnqueueMany: true });
      const federation = createFederation<void>({
        ...mockOptions(),
        queue: { task: queue },
      });
      const task = federation.defineTask("bulk-single", {
        schema: envelopeSchema,
        handler: () => {},
      });
      const ctx = federation.createContext(
        new URL("https://example.com/"),
        undefined,
      );
      await ctx.enqueueTaskMany(task, [envelope("solo")]);
      strictEqual(queue.enqueuedMany.length, 0);
      strictEqual(queue.enqueued.length, 1);
    },
  );

  await t.step(
    "falls back to concurrent single enqueues, preserving order and options",
    async () => {
      const queue = new RendezvousQueue(2);
      const federation = createFederation<void>({
        ...mockOptions(),
        queue: { task: queue },
      });
      const task = federation.defineTask("bulk-fallback", {
        schema: envelopeSchema,
        handler: () => {},
      });
      const ctx = federation.createContext(
        new URL("https://example.com/"),
        undefined,
      );
      const payloads = [envelope("x"), envelope("y")];
      const pending = ctx.enqueueTaskMany(task, payloads, {
        orderingKey: "batch",
      });
      try {
        await withTimeout(
          queue.dispatched,
          2000,
          "fallback did not dispatch enqueues concurrently",
        );
        strictEqual(queue.enqueued.length, 2);
      } finally {
        queue.release();
        await pending;
      }
      const decoded = await Promise.all(
        queue.enqueued.map(({ message }) => decodeEnvelope(message)),
      );
      deepStrictEqual(decoded.map((d) => d.title), ["x", "y"]);
      for (const { message, options } of queue.enqueued) {
        strictEqual(message.orderingKey, "batch");
        strictEqual(options?.orderingKey, "batch");
      }
    },
  );

  await t.step(
    "fallback path aborts the whole batch when one payload is invalid",
    async () => {
      const queue = new MockQueue();
      const federation = createFederation<void>({
        ...mockOptions(),
        queue: { task: queue },
      });
      const task = federation.defineTask("bulk-typed", {
        schema: numberSchema,
        handler: () => {},
      });
      const ctx = federation.createContext(
        new URL("https://example.com/"),
        undefined,
      );
      await rejects(
        // deno-lint-ignore no-explicit-any
        () => ctx.enqueueTaskMany(task, [1, "two", 3] as any),
        { name: "TypeError", message: /Task data failed schema validation/ },
      );
      strictEqual(queue.enqueued.length, 0);
    },
  );
});
