import {
  createTestMeterProvider,
  createTestTracerProvider,
  mockDocumentLoader,
  test,
} from "@fedify/fixture";
import { FetchError, UrlError } from "@fedify/vocab-runtime";
import {
  openDirectFetch,
  openPublicFetch,
  type PublicFetchSession,
} from "@fedify/vocab-runtime/internal";
import type { Actor } from "@fedify/vocab";
import {
  Activity,
  Application,
  Endpoints,
  Group,
  Person,
  Service,
} from "@fedify/vocab";
import {
  assert,
  assertEquals,
  assertFalse,
  assertGreaterOrEqual,
  assertInstanceOf,
  assertNotEquals,
  assertRejects,
} from "@std/assert";
import {
  configure,
  getLogger,
  type LogRecord,
  reset,
  withContext,
} from "@logtape/logtape";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import fetchMock from "fetch-mock";
import { AsyncLocalStorage } from "node:async_hooks";
import { FedifySpanExporter } from "../otel/exporter.ts";
import { verifyRequest } from "../sig/http.ts";
import { doesActorOwnKey } from "../sig/owner.ts";
import {
  ed25519Multikey,
  ed25519PrivateKey,
  rsaPrivateKey2,
  rsaPublicKey2,
} from "../testing/keys.ts";
import { MemoryKvStore } from "./kv.ts";

import {
  extractInboxes,
  fetchWithValidatedRedirects,
  sendActivity,
  SendActivityError,
  type SendActivityParameters,
} from "./send.ts";

// Sends without address validation, so that requests reach fetch-mock with
// their hostnames on every runtime (Bun pins validated hostnames to IPs):
function sendDirect(options: SendActivityParameters): Promise<void> {
  return sendActivity(options, { openHop: openDirectFetch });
}

test("extractInboxes()", () => {
  const recipients: Actor[] = [
    new Person({
      id: new URL("https://example.com/alice"),
      inbox: new URL("https://example.com/alice/inbox"),
      endpoints: new Endpoints({
        sharedInbox: new URL("https://example.com/inbox"),
      }),
    }),
    new Application({
      id: new URL("https://example.com/app"),
      inbox: new URL("https://example.com/app/inbox"),
      endpoints: new Endpoints({
        sharedInbox: new URL("https://example.com/inbox"),
      }),
    }),
    new Group({
      id: new URL("https://example.org/group"),
      inbox: new URL("https://example.org/group/inbox"),
    }),
    new Service({
      id: new URL("https://example.net/service"),
      inbox: new URL("https://example.net/service/inbox"),
      endpoints: new Endpoints({
        sharedInbox: new URL("https://example.net/inbox"),
      }),
    }),
  ];
  let inboxes = extractInboxes({ recipients });
  assertEquals(
    inboxes,
    {
      "https://example.com/alice/inbox": {
        actorIds: new Set(["https://example.com/alice"]),
        sharedInbox: false,
      },
      "https://example.com/app/inbox": {
        actorIds: new Set(["https://example.com/app"]),
        sharedInbox: false,
      },
      "https://example.org/group/inbox": {
        actorIds: new Set(["https://example.org/group"]),
        sharedInbox: false,
      },
      "https://example.net/service/inbox": {
        actorIds: new Set(["https://example.net/service"]),
        sharedInbox: false,
      },
    },
  );
  inboxes = extractInboxes({ recipients, preferSharedInbox: true });
  assertEquals(
    inboxes,
    {
      "https://example.com/inbox": {
        actorIds: new Set([
          "https://example.com/alice",
          "https://example.com/app",
        ]),
        sharedInbox: true,
      },
      "https://example.org/group/inbox": {
        actorIds: new Set(["https://example.org/group"]),
        sharedInbox: false,
      },
      "https://example.net/inbox": {
        actorIds: new Set(["https://example.net/service"]),
        sharedInbox: true,
      },
    },
  );
  inboxes = extractInboxes({
    recipients,
    excludeBaseUris: [new URL("https://foo.bar/")],
  });
  assertEquals(
    inboxes,
    {
      "https://example.com/alice/inbox": {
        actorIds: new Set(["https://example.com/alice"]),
        sharedInbox: false,
      },
      "https://example.com/app/inbox": {
        actorIds: new Set(["https://example.com/app"]),
        sharedInbox: false,
      },
      "https://example.org/group/inbox": {
        actorIds: new Set(["https://example.org/group"]),
        sharedInbox: false,
      },
      "https://example.net/service/inbox": {
        actorIds: new Set(["https://example.net/service"]),
        sharedInbox: false,
      },
    },
  );
  inboxes = extractInboxes({
    recipients,
    excludeBaseUris: [new URL("https://example.com/")],
  });
  assertEquals(
    inboxes,
    {
      "https://example.org/group/inbox": {
        actorIds: new Set(["https://example.org/group"]),
        sharedInbox: false,
      },
      "https://example.net/service/inbox": {
        actorIds: new Set(["https://example.net/service"]),
        sharedInbox: false,
      },
    },
  );
  inboxes = extractInboxes({
    recipients,
    preferSharedInbox: true,
    excludeBaseUris: [new URL("https://example.com/")],
  });
  assertEquals(
    inboxes,
    {
      "https://example.org/group/inbox": {
        actorIds: new Set(["https://example.org/group"]),
        sharedInbox: false,
      },
      "https://example.net/inbox": {
        actorIds: new Set(["https://example.net/service"]),
        sharedInbox: true,
      },
    },
  );
});

test("sendActivity()", async (t) => {
  fetchMock.spyGlobal();

  let httpSigVerified: boolean | null = null;
  let request: Request | null = null;
  fetchMock.post(
    "https://example.com/inbox",
    async (cl) => {
      httpSigVerified = false;
      request = cl.request!.clone() as Request;
      const options = {
        documentLoader: mockDocumentLoader,
        contextLoader: mockDocumentLoader,
      };
      const key = await verifyRequest(request, options);
      const activity = await Activity.fromJsonLd(await request.json(), options);
      if (key != null && await doesActorOwnKey(activity, key, options)) {
        httpSigVerified = true;
      }
      if (httpSigVerified) return new Response("", { status: 202 });
      return new Response("", { status: 401 });
    },
  );

  await t.step("success", async () => {
    const activity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Create",
      "id": "https://example.com/activity",
      "actor": "https://example.com/person",
    };

    await sendDirect({
      activity,
      keys: [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
      inbox: new URL("https://example.com/inbox"),
      headers: new Headers({
        "X-Test": "test",
      }),
    });
    assert(httpSigVerified);
    assertNotEquals(request, null);
    assertEquals(request?.method, "POST");
    assertEquals(request?.url, "https://example.com/inbox");
    assertEquals(
      request?.headers.get("Content-Type"),
      "application/activity+json",
    );
    assertEquals(request?.headers.get("X-Test"), "test");

    httpSigVerified = null;
    await assertRejects(() =>
      sendDirect({
        activity: { ...activity, actor: "https://example.com/person2" },
        keys: [{ privateKey: ed25519PrivateKey, keyId: ed25519Multikey.id! }],
        inbox: new URL("https://example.com/inbox"),
      })
    );
    assertFalse(httpSigVerified);
    assertNotEquals(request, null);
    assertEquals(request?.method, "POST");
    assertEquals(request?.url, "https://example.com/inbox");
    assertEquals(
      request?.headers.get("Content-Type"),
      "application/activity+json",
    );
  });

  fetchMock.post("https://example.com/inbox2", {
    status: 500,
    headers: { "Retry-After": "120" },
    body: "something went wrong",
  });

  await t.step("failure", async () => {
    const activity: unknown = {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Create",
      "id": "https://example.com/activity",
      "actor": "https://example.com/person",
    };
    await assertRejects(
      () =>
        sendDirect({
          activity,
          activityId: "https://example.com/activity",
          keys: [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
          inbox: new URL("https://example.com/inbox2"),
        }),
      Error,
      "Failed to send activity https://example.com/activity to " +
        "https://example.com/inbox2 (500 Internal Server Error):\n" +
        "something went wrong",
    );
  });

  await t.step("failure throws SendActivityError", async () => {
    const activity: unknown = {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Create",
      "id": "https://example.com/activity",
      "actor": "https://example.com/person",
    };
    try {
      await sendDirect({
        activity,
        activityId: "https://example.com/activity",
        keys: [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
        inbox: new URL("https://example.com/inbox2"),
      });
      assert(false, "Should have thrown");
    } catch (e) {
      assertInstanceOf(e, SendActivityError);
      assertEquals(e.statusCode, 500);
      assertEquals(e.inbox, new URL("https://example.com/inbox2"));
      assertEquals(e.responseBody, "something went wrong");
      assertEquals(e.responseHeaders.get("Retry-After"), "120");
    }
  });

  await t.step(
    "signed challenge retry transport errors throw FetchError",
    async () => {
      const activity: unknown = {
        "@context": "https://www.w3.org/ns/activitystreams",
        "type": "Create",
        "id": "https://example.com/activity",
        "actor": "https://example.com/person",
      };
      const failure = new TypeError("challenge retry connection reset");
      let requestCount = 0;
      fetchMock.post("https://example.com/inbox-challenge-reset", () => {
        requestCount++;
        if (requestCount === 1) {
          return new Response("Unauthorized", {
            status: 401,
            headers: {
              "Accept-Signature":
                'sig1=("@method" "@target-uri" "@authority" ' +
                '"content-digest");created;nonce="retry-nonce"',
            },
          });
        }
        throw failure;
      });

      const error = await assertRejects(
        () =>
          sendDirect({
            activity,
            activityId: "https://example.com/activity",
            keys: [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
            inbox: new URL("https://example.com/inbox-challenge-reset"),
          }),
        FetchError,
        "challenge retry connection reset",
      );

      assertEquals(
        error.url.href,
        "https://example.com/inbox-challenge-reset",
      );
      assertEquals(error.cause, failure);
      assertEquals(requestCount, 2);
    },
  );

  fetchMock.post("https://example.com/inbox-gone", {
    status: 410,
    body: "Gone",
  });

  await t.step("410 Gone throws SendActivityError", async () => {
    const activity: unknown = {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Create",
      "id": "https://example.com/activity",
      "actor": "https://example.com/person",
    };
    try {
      await sendDirect({
        activity,
        activityId: "https://example.com/activity",
        keys: [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
        inbox: new URL("https://example.com/inbox-gone"),
      });
      assert(false, "Should have thrown");
    } catch (e) {
      assertInstanceOf(e, SendActivityError);
      assertEquals(e.statusCode, 410);
      assertEquals(e.inbox, new URL("https://example.com/inbox-gone"));
      assertEquals(e.responseBody, "Gone");
    }
  });

  fetchMock.post("https://example.com/inbox-notfound", {
    status: 404,
    body: "Not Found",
  });

  await t.step("404 Not Found throws SendActivityError", async () => {
    const activity: unknown = {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Create",
      "id": "https://example.com/activity",
      "actor": "https://example.com/person",
    };
    try {
      await sendDirect({
        activity,
        activityId: "https://example.com/activity",
        keys: [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
        inbox: new URL("https://example.com/inbox-notfound"),
      });
      assert(false, "Should have thrown");
    } catch (e) {
      assertInstanceOf(e, SendActivityError);
      assertEquals(e.statusCode, 404);
      assertEquals(e.inbox, new URL("https://example.com/inbox-notfound"));
      assertEquals(e.responseBody, "Not Found");
    }
  });

  // Test for issue #569: response body truncation to prevent memory pressure
  const longErrorBody = "x".repeat(1500); // 1500 bytes, exceeds 1024 limit
  fetchMock.post("https://example.com/inbox-long-error", {
    status: 500,
    body: longErrorBody,
  });

  await t.step("long error response body is truncated", async () => {
    const activity: unknown = {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Create",
      "id": "https://example.com/activity",
      "actor": "https://example.com/person",
    };
    try {
      await sendDirect({
        activity,
        activityId: "https://example.com/activity",
        keys: [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
        inbox: new URL("https://example.com/inbox-long-error"),
      });
      assert(false, "Should have thrown");
    } catch (e) {
      assertInstanceOf(e, SendActivityError);
      assertEquals(e.statusCode, 500);
      assertEquals(e.inbox, new URL("https://example.com/inbox-long-error"));
      // Response body should be truncated to 1024 chars + truncation suffix
      const expectedTruncated = "x".repeat(1024) + "… (truncated)";
      assertEquals(e.responseBody, expectedTruncated);
      assertEquals(e.message.includes("… (truncated)"), true);
    }
  });

  // Test that short error responses are not truncated
  await t.step("short error response body is not truncated", async () => {
    const activity: unknown = {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Create",
      "id": "https://example.com/activity",
      "actor": "https://example.com/person",
    };
    try {
      await sendDirect({
        activity,
        activityId: "https://example.com/activity",
        keys: [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
        inbox: new URL("https://example.com/inbox2"), // Uses "something went wrong"
      });
      assert(false, "Should have thrown");
    } catch (e) {
      assertInstanceOf(e, SendActivityError);
      assertEquals(e.responseBody, "something went wrong");
      assertEquals(e.message.includes("… (truncated)"), false);
    }
  });

  // Test edge case: exactly 1024 bytes
  const exactLimitBody = "y".repeat(1024);
  fetchMock.post("https://example.com/inbox-exact-limit", {
    status: 500,
    body: exactLimitBody,
  });

  await t.step(
    "error response body exactly at limit is not truncated",
    async () => {
      const activity: unknown = {
        "@context": "https://www.w3.org/ns/activitystreams",
        "type": "Create",
        "id": "https://example.com/activity",
        "actor": "https://example.com/person",
      };
      try {
        await sendDirect({
          activity,
          activityId: "https://example.com/activity",
          keys: [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
          inbox: new URL("https://example.com/inbox-exact-limit"),
        });
        assert(false, "Should have thrown");
      } catch (e) {
        assertInstanceOf(e, SendActivityError);
        assertEquals(e.responseBody, exactLimitBody);
        assertEquals(e.message.includes("… (truncated)"), false);
      }
    },
  );

  fetchMock.hardReset();
});

test("sendActivity() records OpenTelemetry span events", async (t) => {
  const [tracerProvider, exporter] = createTestTracerProvider();
  fetchMock.spyGlobal();

  await t.step("successful send", async () => {
    fetchMock.get("https://example.com/", { status: 404 });
    fetchMock.post("https://example.com/inbox", { status: 202 });

    const activity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Create",
      id: "https://example.com/activity",
      actor: "https://example.com/person",
    };

    await sendDirect({
      activity,
      activityId: "https://example.com/activity",
      activityType: "https://www.w3.org/ns/activitystreams#Create",
      keys: [{
        keyId: new URL("https://example.com/person#key"),
        privateKey: rsaPrivateKey2,
      }],
      inbox: new URL("https://example.com/inbox"),
      tracerProvider,
    });

    // Check that the span was recorded
    const spans = exporter.getSpans("activitypub.send_activity");
    assertEquals(spans.length, 1);
    const span = spans[0];

    // Check span attributes
    assertEquals(
      span.attributes["activitypub.activity.id"],
      "https://example.com/activity",
    );
    assertEquals(
      span.attributes["activitypub.activity.type"],
      "https://www.w3.org/ns/activitystreams#Create",
    );

    // Check that the activity.sent event was recorded
    const events = exporter.getEvents(
      "activitypub.send_activity",
      "activitypub.activity.sent",
    );
    assertEquals(events.length, 1);
    const event = events[0];

    // Verify event attributes
    assert(event.attributes != null);
    assertEquals(
      event.attributes["activitypub.inbox.url"],
      "https://example.com/inbox",
    );
    assertEquals(
      event.attributes["activitypub.activity.id"],
      "https://example.com/activity",
    );
    assertEquals(
      event.attributes["activitypub.activity.type"],
      "https://www.w3.org/ns/activitystreams#Create",
    );
    assertEquals(
      event.attributes["activitypub.actor.id"],
      "https://example.com/person",
    );
    assertEquals(event.attributes["activitypub.activity.json"], undefined);

    exporter.clear();
    fetchMock.hardReset();
  });
});

function createActivity(id: string) {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Create",
    id,
    actor: "https://example.com/person",
  };
}

function deliveryParams(
  activityId: string,
  inbox: string,
  tracerProvider: ReturnType<typeof createTestTracerProvider>[0],
) {
  return {
    activity: createActivity(activityId),
    activityId,
    activityType: "https://www.w3.org/ns/activitystreams#Create",
    keys: [{
      keyId: new URL("https://example.com/person#key"),
      privateKey: rsaPrivateKey2,
    }],
    inbox: new URL(inbox),
    tracerProvider,
  };
}

test("sendActivity() aligns the LogTape context with its own span", async (t) => {
  const [tracerProvider, exporter] = createTestTracerProvider();
  fetchMock.spyGlobal();

  const records: LogRecord[] = [];
  await reset();
  try {
    await configure({
      sinks: { buffer: (record: LogRecord) => records.push(record) },
      filters: {},
      loggers: [
        { category: [], sinks: ["buffer"], lowestLevel: "debug" },
        { category: ["logtape", "meta"], sinks: [] },
      ],
      contextLocalStorage: new AsyncLocalStorage(),
    });

    const outerContext = {
      requestId: "outer-request",
      traceId: "outer0000000000000000000000sentinel",
      spanId: "outer00000sentinel",
    };

    await t.step(
      "a warning logged during a successful send matches the resulting " +
        "TraceActivityRecord",
      async () => {
        try {
          fetchMock.post("https://example.com/inbox-warn", { status: 202 });

          await withContext({ requestId: "outer-request-warn" }, async () => {
            await sendDirect({
              ...deliveryParams(
                "https://example.com/activity/warn",
                "https://example.com/inbox-warn",
                tracerProvider,
              ),
              keys: [{
                keyId: ed25519Multikey.id!,
                privateKey: ed25519PrivateKey,
              }],
            });
          });

          const span = exporter.getSpan("activitypub.send_activity");
          assert(span != null);
          const { traceId, spanId } = span.spanContext();

          const kv = new MemoryKvStore();
          const fedifyExporter = new FedifySpanExporter(kv);
          await new Promise<void>((resolve) => {
            fedifyExporter.export([span], () => resolve());
          });
          const [record] = await fedifyExporter.getActivitiesByTraceId(
            traceId,
          );
          assert(record != null);
          assertEquals(record.direction, "outbound");
          assertEquals(record.spanId, spanId);

          const warnLog = records.find((r) =>
            String(r.rawMessage).startsWith("No supported key found to sign")
          );
          assert(warnLog != null);
          assertEquals(warnLog.properties.spanId, record.spanId);
          assertEquals(warnLog.properties.traceId, record.traceId);
          assertEquals(warnLog.properties.requestId, "outer-request-warn");
        } finally {
          exporter.clear();
          records.length = 0;
          fetchMock.hardReset();
          fetchMock.spyGlobal();
        }
      },
    );

    await t.step(
      "a failed delivery's error log matches its own span, and the outer " +
        "context is restored once the rejection propagates",
      async () => {
        try {
          fetchMock.post("https://example.com/inbox-failing", {
            status: 500,
            body: "Internal Server Error",
          });

          await withContext(outerContext, async () => {
            await assertRejects(
              () =>
                sendDirect(
                  deliveryParams(
                    "https://example.com/activity/failing",
                    "https://example.com/inbox-failing",
                    tracerProvider,
                  ),
                ),
              SendActivityError,
            );
            getLogger(["fedify", "federation", "send.test"]).info(
              "after failure",
            );
          });

          const span = exporter.getSpan("activitypub.send_activity");
          assert(span != null);
          const { traceId, spanId } = span.spanContext();

          const kv = new MemoryKvStore();
          const fedifyExporter = new FedifySpanExporter(kv);
          await new Promise<void>((resolve) => {
            fedifyExporter.export([span], () => resolve());
          });
          assertEquals(
            await fedifyExporter.getActivitiesByTraceId(traceId),
            [],
          );

          const failureLog = records.find((r) =>
            String(r.rawMessage).startsWith(
              "Failed to send activity {activityId} to {inbox} ({status}",
            )
          );
          assert(failureLog != null);
          assertEquals(failureLog.properties.spanId, spanId);
          assertEquals(failureLog.properties.traceId, traceId);
          assertEquals(
            failureLog.properties.requestId,
            outerContext.requestId,
          );

          const afterLog = records.find((r) =>
            r.rawMessage === "after failure"
          );
          assert(afterLog != null);
          assertEquals(afterLog.properties.requestId, outerContext.requestId);
          assertEquals(afterLog.properties.traceId, outerContext.traceId);
          assertEquals(afterLog.properties.spanId, outerContext.spanId);
        } finally {
          exporter.clear();
          records.length = 0;
          fetchMock.hardReset();
          fetchMock.spyGlobal();
        }
      },
    );

    await t.step(
      "outer context is restored after a successful send",
      async () => {
        try {
          fetchMock.post("https://example.com/inbox-ok", { status: 202 });

          await withContext(outerContext, async () => {
            await sendDirect(
              deliveryParams(
                "https://example.com/activity/ok",
                "https://example.com/inbox-ok",
                tracerProvider,
              ),
            );
            getLogger(["fedify", "federation", "send.test"]).info(
              "after success",
            );
          });

          const span = exporter.getSpan("activitypub.send_activity");
          assert(span != null);
          const { spanId } = span.spanContext();

          const afterLog = records.find((r) =>
            r.rawMessage === "after success"
          );
          assert(afterLog != null);
          assertNotEquals(afterLog.properties.spanId, spanId);
          assertEquals(afterLog.properties.requestId, outerContext.requestId);
          assertEquals(afterLog.properties.traceId, outerContext.traceId);
          assertEquals(afterLog.properties.spanId, outerContext.spanId);
        } finally {
          exporter.clear();
          records.length = 0;
          fetchMock.hardReset();
          fetchMock.spyGlobal();
        }
      },
    );

    await t.step(
      "concurrent deliveries do not leak context into each other",
      async () => {
        try {
          let arrived = 0;
          let release: () => void = () => {};
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          const handler = () => async () => {
            arrived++;
            if (arrived >= 2) release();
            await gate;
            return { status: 500, body: "Internal Server Error" };
          };
          fetchMock.post("https://example.com/inbox-concurrent-a", handler());
          fetchMock.post("https://example.com/inbox-concurrent-b", handler());

          const [resultA, resultB] = await Promise.allSettled([
            sendDirect(
              deliveryParams(
                "https://example.com/activity/a",
                "https://example.com/inbox-concurrent-a",
                tracerProvider,
              ),
            ).finally(release),
            sendDirect(
              deliveryParams(
                "https://example.com/activity/b",
                "https://example.com/inbox-concurrent-b",
                tracerProvider,
              ),
            ).finally(release),
          ]);
          assertEquals(resultA.status, "rejected");
          assertEquals(resultB.status, "rejected");

          const spans = exporter.getSpans("activitypub.send_activity");
          assertEquals(spans.length, 2);
          const spanA = spans.find((s) =>
            s.attributes["activitypub.activity.id"] ===
              "https://example.com/activity/a"
          );
          const spanB = spans.find((s) =>
            s.attributes["activitypub.activity.id"] ===
              "https://example.com/activity/b"
          );
          assert(spanA != null && spanB != null);
          assertNotEquals(
            spanA.spanContext().spanId,
            spanB.spanContext().spanId,
          );

          const logA = records.find((r) =>
            r.properties.activityId === "https://example.com/activity/a" &&
            String(r.rawMessage).startsWith("Failed to send activity")
          );
          const logB = records.find((r) =>
            r.properties.activityId === "https://example.com/activity/b" &&
            String(r.rawMessage).startsWith("Failed to send activity")
          );
          assert(logA != null && logB != null);
          assertEquals(logA.properties.spanId, spanA.spanContext().spanId);
          assertEquals(logB.properties.spanId, spanB.spanContext().spanId);
          assertEquals(
            logA.properties.traceId,
            spanA.spanContext().traceId,
          );
          assertEquals(
            logB.properties.traceId,
            spanB.spanContext().traceId,
          );
          assertNotEquals(logA.properties.spanId, logB.properties.spanId);
        } finally {
          exporter.clear();
          records.length = 0;
          fetchMock.hardReset();
        }
      },
    );
  } finally {
    await reset();
    fetchMock.hardReset();
  }
});

test("sendActivity() validates the initial policy before serializing", async () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  let serialized = false;
  await assertRejects(
    () =>
      sendActivity({
        activity: {
          toJSON() {
            serialized = true;
            throw new Error("must not serialize");
          },
        },
        keys: [],
        inbox: new URL("http://127.0.0.1/inbox"),
        meterProvider,
      }),
    UrlError,
  );
  assertFalse(serialized);
  assertEquals(recorder.getMeasurements("activitypub.delivery.sent"), []);
});

test("sendActivity() closes the initial session when serialization fails", async () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  const url = "https://example.com/lifecycle/serialization-failure";
  const hops = recordHops(() => ({ status: 202, body: "Accepted" }));
  const failure = new Error("serialization failed");
  const error = await assertRejects(
    () =>
      sendActivity({
        activity: {
          toJSON() {
            throw failure;
          },
        },
        keys: [],
        inbox: new URL(url),
        meterProvider,
      }, { openHop: hops.openHop }),
    Error,
    "serialization failed",
  );
  assertEquals(error, failure);
  assertEquals(hops.events, [`open ${url}`, `close ${url}`]);
  assertEquals(recorder.getMeasurements("activitypub.delivery.sent"), []);
  hops.assertInvariants();
});

test("sendActivity() records OpenTelemetry delivery metrics", async (t) => {
  const [meterProvider, recorder] = createTestMeterProvider();
  fetchMock.spyGlobal();

  await t.step("successful send", async () => {
    fetchMock.post("https://metrics.example:8443/inbox/path?x=1", {
      status: 202,
    });

    const activity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Create",
      id: "https://example.com/activity",
      actor: "https://example.com/person",
    };

    await sendActivity({
      activity,
      activityId: "https://example.com/activity",
      activityType: "https://www.w3.org/ns/activitystreams#Create",
      keys: [],
      // This test delivers to a mocked, unresolvable .example inbox.
      allowPrivateAddress: true,
      inbox: new URL("https://metrics.example:8443/inbox/path?x=1"),
      meterProvider,
    });

    const sent = recorder.getMeasurements("activitypub.delivery.sent");
    assertEquals(sent.length, 1);
    assertEquals(sent[0].type, "counter");
    assertEquals(sent[0].value, 1);
    assertEquals(
      sent[0].attributes["activitypub.remote.host"],
      "metrics.example:8443",
    );
    assertEquals(
      sent[0].attributes["activitypub.activity.type"],
      "https://www.w3.org/ns/activitystreams#Create",
    );
    assertEquals(sent[0].attributes["activitypub.delivery.success"], true);

    const durations = recorder.getMeasurements(
      "activitypub.delivery.duration",
    );
    assertEquals(durations.length, 1);
    assertEquals(durations[0].type, "histogram");
    assertGreaterOrEqual(durations[0].value, 0);
    assertEquals(
      durations[0].attributes["activitypub.remote.host"],
      "metrics.example:8443",
    );
    assertEquals(
      durations[0].attributes["activitypub.activity.type"],
      "https://www.w3.org/ns/activitystreams#Create",
    );
    assertEquals(
      durations[0].attributes["activitypub.delivery.success"],
      true,
    );

    recorder.clear();
    fetchMock.hardReset();
  });

  await t.step("failed HTTP response", async () => {
    fetchMock.spyGlobal();
    fetchMock.post("https://metrics.example/inbox", {
      status: 500,
      body: "failed",
    });

    const activity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Follow",
      id: "https://example.com/follow",
      actor: "https://example.com/person",
    };

    await assertRejects(
      () =>
        sendActivity({
          activity,
          activityId: "https://example.com/follow",
          activityType: "https://www.w3.org/ns/activitystreams#Follow",
          keys: [],
          // This test delivers to a mocked, unresolvable .example inbox.
          allowPrivateAddress: true,
          inbox: new URL("https://metrics.example/inbox"),
          meterProvider,
        }),
      SendActivityError,
    );

    const sent = recorder.getMeasurements("activitypub.delivery.sent");
    assertEquals(sent.length, 1);
    assertEquals(sent[0].attributes["activitypub.delivery.success"], false);
    assertEquals(
      sent[0].attributes["activitypub.activity.type"],
      "https://www.w3.org/ns/activitystreams#Follow",
    );
    assertEquals(
      sent[0].attributes["activitypub.remote.host"],
      "metrics.example",
    );

    const durations = recorder.getMeasurements(
      "activitypub.delivery.duration",
    );
    assertEquals(durations.length, 1);
    assertGreaterOrEqual(durations[0].value, 0);
    assertEquals(
      durations[0].attributes["activitypub.remote.host"],
      "metrics.example",
    );
    assertEquals(
      durations[0].attributes["activitypub.activity.type"],
      "https://www.w3.org/ns/activitystreams#Follow",
    );
    assertEquals(
      durations[0].attributes["activitypub.delivery.success"],
      false,
    );

    recorder.clear();
    fetchMock.hardReset();
  });
});

test("sendActivity() exports delivery metrics through OpenTelemetry SDK", async () => {
  const exporter = new InMemoryMetricExporter(
    AggregationTemporality.CUMULATIVE,
  );
  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 60_000,
  });
  const meterProvider = new MeterProvider({ readers: [reader] });
  fetchMock.spyGlobal();
  fetchMock.post("https://sdk-metrics.example/inbox", { status: 202 });

  try {
    await sendActivity({
      activity: {
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Create",
        id: "https://example.com/activity",
        actor: "https://example.com/person",
      },
      activityId: "https://example.com/activity",
      activityType: "https://www.w3.org/ns/activitystreams#Create",
      keys: [],
      // This test delivers to a mocked, unresolvable .example inbox.
      allowPrivateAddress: true,
      inbox: new URL("https://sdk-metrics.example/inbox"),
      meterProvider,
    });

    await meterProvider.forceFlush();
    const exportedMetrics = exporter.getMetrics()
      .flatMap((resourceMetrics) => resourceMetrics.scopeMetrics)
      .flatMap((scopeMetrics) => scopeMetrics.metrics);
    const sent = exportedMetrics.find((metric) =>
      metric.descriptor.name === "activitypub.delivery.sent"
    );
    assert(sent != null);
    assertEquals(sent.dataPoints.length, 1);
    assertEquals(
      sent.dataPoints[0].attributes["activitypub.remote.host"],
      "sdk-metrics.example",
    );
  } finally {
    try {
      await meterProvider.shutdown();
    } finally {
      fetchMock.hardReset();
    }
  }
});

for (const signed of [false, true]) {
  const keys = [{
    privateKey: signed ? rsaPrivateKey2 : ed25519PrivateKey,
    keyId: signed ? rsaPublicKey2.id! : ed25519Multikey.id!,
  }];
  test(`sendActivity() validates destinations (signed: ${signed})`, async (t) => {
    const activity = { type: "Create", id: "https://example.com/activity" };
    const publicInbox = "https://8.8.8.8/inbox";
    const privateInbox = "http://127.0.0.1/inbox";
    for (
      const target of [privateInbox, "http://169.254.169.254/", "http://[::1]/"]
    ) {
      await t.step(`rejects ${target} before fetching`, async () => {
        fetchMock.mockGlobal().catch(202);
        try {
          await assertRejects(
            () => sendActivity({ activity, keys, inbox: new URL(target) }),
            UrlError,
          );
          assertEquals(fetchMock.callHistory.calls().length, 0);
        } finally {
          fetchMock.hardReset();
        }
      });
    }
    for (const status of [301, 302, 303, 307, 308]) {
      for (const allowPrivateAddress of [false, true]) {
        await t.step(
          `${status} private redirect, opt-in: ${allowPrivateAddress}`,
          async () => {
            fetchMock.mockGlobal();
            fetchMock.route(publicInbox, {
              status,
              headers: { Location: privateInbox },
            });
            fetchMock.route(privateInbox, 202);
            try {
              const send = () =>
                sendActivity({
                  activity,
                  keys,
                  inbox: new URL(publicInbox),
                  allowPrivateAddress,
                });
              if (allowPrivateAddress) {
                await send();
                const calls = fetchMock.callHistory.calls(privateInbox);
                assertEquals(calls.length, 1);
                const request = calls[0].request!;
                const preservesBody = signed || status === 307 ||
                  status === 308;
                assertEquals(request.method, preservesBody ? "POST" : "GET");
                assertEquals(
                  await request.clone().text(),
                  preservesBody ? JSON.stringify(activity) : "",
                );
              } else {
                await assertRejects(send, UrlError);
                assertEquals(
                  fetchMock.callHistory.calls(privateInbox).length,
                  0,
                );
              }
            } finally {
              fetchMock.hardReset();
            }
          },
        );
      }
    }
    await t.step(
      "rejects a private destination after a public redirect",
      async () => {
        fetchMock.mockGlobal()
          .route(publicInbox, { status: 307, headers: { Location: "/next" } })
          .route("https://8.8.8.8/next", {
            status: 308,
            headers: { Location: privateInbox },
          })
          .route(privateInbox, 202);
        try {
          await assertRejects(
            () => sendActivity({ activity, keys, inbox: new URL(publicInbox) }),
            UrlError,
          );
          assertEquals(fetchMock.callHistory.calls(privateInbox).length, 0);
        } finally {
          fetchMock.hardReset();
        }
      },
    );
    await t.step("limits redirect loops", async () => {
      fetchMock.mockGlobal().route(publicInbox, {
        status: 307,
        headers: { Location: publicInbox },
      });
      try {
        await assertRejects(
          () => sendActivity({ activity, keys, inbox: new URL(publicInbox) }),
        );
        assert(fetchMock.callHistory.calls().length <= 21);
      } finally {
        fetchMock.hardReset();
      }
    });
    await t.step("allows a direct private inbox with opt-in", async () => {
      fetchMock.mockGlobal().route(privateInbox, 202);
      try {
        await sendActivity({
          activity,
          keys,
          inbox: new URL(privateInbox),
          allowPrivateAddress: true,
        });
        assertEquals(fetchMock.callHistory.calls(privateInbox).length, 1);
      } finally {
        fetchMock.hardReset();
      }
    });
    await t.step(
      "allows relative public redirects",
      async () => {
        fetchMock.mockGlobal()
          .route(publicInbox, { status: 307, headers: { Location: "/next" } })
          .route("https://8.8.8.8/next", 202);
        try {
          await sendActivity({ activity, keys, inbox: new URL(publicInbox) });
          assertEquals(
            fetchMock.callHistory.calls("https://8.8.8.8/next").length,
            1,
          );
        } finally {
          fetchMock.hardReset();
        }
      },
    );
  });
}

for (const signed of [false, true]) {
  test(`sendActivity() classifies DNS failures (signed: ${signed})`, async (t) => {
    const activity = { type: "Create", id: "https://example.com/activity" };
    const destination = "https://delivery.invalid/inbox";
    const publicInbox = "https://8.8.8.8/inbox";
    const keys = signed
      ? [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }]
      : [];
    for (const result of ["throws", "empty", "cname", "private"] as const) {
      for (const redirected of [false, true]) {
        await t.step(`${result}, redirected: ${redirected}`, async () => {
          const [meterProvider, recorder] = createTestMeterProvider();
          const resolverError = new Error("Resolver unavailable");
          const lookups: string[] = [];
          const lookup = (hostname: string) => {
            lookups.push(hostname);
            assertEquals(hostname, "delivery.invalid");
            if (result === "throws") return Promise.reject(resolverError);
            return Promise.resolve(
              result === "empty" ? [] : [{
                address: result === "private" ? "127.0.0.1" : "alias.invalid.",
                family: 4,
              }],
            );
          };
          try {
            fetchMock.mockGlobal().catch(202);
            if (redirected) {
              fetchMock.route(publicInbox, {
                status: 307,
                headers: { Location: destination },
              });
            }
            const send = () =>
              sendActivity({
                activity,
                activityType: "https://www.w3.org/ns/activitystreams#Create",
                meterProvider,
                keys,
                inbox: new URL(redirected ? publicInbox : destination),
              }, { openHop: (url) => openPublicFetch(url, { lookup }) });
            if (result === "private") {
              const error = await assertRejects(send, UrlError);
              assertEquals(error.reason, "disallowed");
            } else {
              const error = await assertRejects(send, FetchError);
              assertEquals(error.url.href, destination);
              assertInstanceOf(error.cause, UrlError);
              assertEquals(error.cause.reason, "dns");
              assertEquals(
                error.cause.cause,
                result === "throws" ? resolverError : undefined,
              );
            }
            // Initial policy rejections remain outside delivery accounting;
            // redirect policy rejections retain their existing failed metric.
            const expectedCount = result === "private" && !redirected ? 0 : 1;
            const sent = recorder.getMeasurements(
              "activitypub.delivery.sent",
            );
            const durations = recorder.getMeasurements(
              "activitypub.delivery.duration",
            );
            assertEquals(sent.length, expectedCount);
            assertEquals(durations.length, expectedCount);
            if (expectedCount === 1) {
              assertEquals(sent[0].value, 1);
              assertEquals(sent[0].attributes, {
                "activitypub.remote.host": redirected
                  ? "8.8.8.8"
                  : "delivery.invalid",
                "activitypub.activity.type":
                  "https://www.w3.org/ns/activitystreams#Create",
                "activitypub.delivery.success": false,
              });
              assertEquals(durations[0].attributes, sent[0].attributes);
              assertGreaterOrEqual(durations[0].value, 0);
            }
            assertEquals(lookups, ["delivery.invalid"]);
            assertEquals(fetchMock.callHistory.calls(destination).length, 0);
            assertEquals(
              fetchMock.callHistory.calls().length,
              redirected ? 1 : 0,
            );
          } finally {
            fetchMock.hardReset();
          }
        });
      }
    }
  });
}

const lifecycleActivity = {
  "@context": "https://www.w3.org/ns/activitystreams",
  type: "Create",
  id: "https://example.com/activity",
  actor: "https://example.com/person",
};

const signedKeys = [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }];
const unsignedKeys = [{
  privateKey: ed25519PrivateKey,
  keyId: ed25519Multikey.id!,
}];

test("sendActivity() cancels a successful response body", async (t) => {
  for (const signed of [true, false]) {
    await t.step(`signed: ${signed}`, async () => {
      const inbox = "https://example.com/lifecycle/inbox";
      const hops = recordHops(() => ({ status: 202, body: "Accepted" }));
      await sendActivity({
        activity: lifecycleActivity,
        keys: signed ? signedKeys : unsignedKeys,
        inbox: new URL(inbox),
      }, { openHop: hops.openHop });
      assertEquals(hops.events, [
        `open ${inbox}`,
        `fetch #1 ${inbox}`,
        "cancel #1",
        `close ${inbox}`,
      ]);
      hops.assertInvariants();
    });
  }
});

test("sendActivity() reads at most 1 KiB of an error response body", async (t) => {
  for (const signed of [true, false]) {
    await t.step(`signed: ${signed}`, async () => {
      const inbox = "https://example.com/lifecycle/error";
      const hops = recordHops(() => ({
        status: 500,
        body: "x".repeat(4096),
      }));
      const error = await assertRejects(
        () =>
          sendActivity({
            activity: lifecycleActivity,
            activityId: lifecycleActivity.id,
            keys: signed ? signedKeys : unsignedKeys,
            inbox: new URL(inbox),
          }, { openHop: hops.openHop }),
        SendActivityError,
      );
      assertEquals(error.responseBody, "x".repeat(1024) + "… (truncated)");
      assert(error.message.includes("… (truncated)"));
      assertEquals(hops.events, [
        `open ${inbox}`,
        `fetch #1 ${inbox}`,
        "cancel #1",
        // The signed request is retried with the other spec on the same hop:
        ...(signed ? [`fetch #2 ${inbox}`, "cancel #2"] : []),
        `close ${inbox}`,
      ]);
      hops.assertInvariants();
    });
  }
});

test("sendActivity() closes each redirect hop before opening the next", async (t) => {
  for (const [signed, status] of [[true, 307], [false, 308]] as const) {
    await t.step(`signed: ${signed}, ${status}`, async () => {
      const inbox = "https://example.com/lifecycle/redirect";
      const next = "https://example.com/lifecycle/redirected";
      const hops = recordHops((request) =>
        request.url === inbox
          ? { status, headers: { Location: next }, body: "Moved" }
          : { status: 202, body: "Accepted" }
      );
      await sendActivity({
        activity: lifecycleActivity,
        keys: signed ? signedKeys : unsignedKeys,
        inbox: new URL(inbox),
      }, { openHop: hops.openHop });
      assertEquals(hops.events, [
        `open ${inbox}`,
        `fetch #1 ${inbox}`,
        "cancel #1",
        `close ${inbox}`,
        `open ${next}`,
        `fetch #2 ${next}`,
        "cancel #2",
        `close ${next}`,
      ]);
      assertEquals(hops.requests[1].method, "POST");
      assertEquals(
        await hops.requests[1].text(),
        JSON.stringify(lifecycleActivity),
      );
      hops.assertInvariants();
    });
  }
});

// Captures the debug logs of fedify while running the given function:
async function captureLogs(fn: () => Promise<void>): Promise<LogRecord[]> {
  const records: LogRecord[] = [];
  await configure({
    sinks: { buffer: (record) => records.push(record) },
    loggers: [
      { category: "fedify", sinks: ["buffer"], lowestLevel: "debug" },
      { category: ["logtape", "meta"], sinks: [] },
    ],
    reset: true,
  });
  try {
    await fn();
    // Let the rejected cancellations be logged:
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    await reset();
  }
  return records;
}

// Gets the URLs of the logged failures to cancel response bodies:
function getCancelFailureUrls(records: readonly LogRecord[]): unknown[] {
  return records
    .filter((r) =>
      r.rawMessage === "Failed to cancel the response body from {url}: {error}"
    )
    .map((r) => r.properties.url);
}

test("fetchWithValidatedRedirects() logs a redirect body failing to cancel and follows the redirect", async (t) => {
  const url = "https://example.com/lifecycle/cancel-failure";
  const next = "https://example.com/lifecycle/cancel-failure-final";
  const respond = (_: Request, index: number) =>
    index === 1
      ? {
        status: 302,
        headers: { Location: next },
        body: "Found",
        failCancel: true,
      }
      : { status: 202, body: "Accepted" };

  await t.step("fetchWithValidatedRedirects()", async () => {
    const hops = recordHops(respond);
    let result: string | undefined;
    const records = await captureLogs(async () => {
      result = await fetchWithValidatedRedirects(
        new Request(url, { method: "POST", body: "activity" }),
        hops.openHop,
        (response) => response.text(),
      );
    });
    assertEquals(result, "Accepted");
    assertEquals(hops.events, [
      `open ${url}`,
      `fetch #1 ${url}`,
      "cancel #1",
      `close ${url}`,
      `open ${next}`,
      `fetch #2 ${next}`,
      "consumed #2",
      `close ${next}`,
    ]);
    assertEquals(getCancelFailureUrls(records), [url]);
    hops.assertInvariants();
  });

  for (const signed of [true, false]) {
    await t.step(`signed sendActivity(): ${signed}`, async () => {
      const hops = recordHops(respond);
      const records = await captureLogs(() =>
        sendActivity({
          activity: lifecycleActivity,
          keys: signed ? signedKeys : unsignedKeys,
          inbox: new URL(url),
        }, { openHop: hops.openHop })
      );
      assertEquals(hops.events, [
        `open ${url}`,
        `fetch #1 ${url}`,
        "cancel #1",
        `close ${url}`,
        `open ${next}`,
        `fetch #2 ${next}`,
        "cancel #2",
        `close ${next}`,
      ]);
      assertEquals(getCancelFailureUrls(records), [url]);
      hops.assertInvariants();
    });
  }
});

test("fetchWithValidatedRedirects() closes the session when consuming fails", async () => {
  const url = "https://example.com/lifecycle/consume-failure";
  const hops = recordHops(() => ({ status: 200, body: "x".repeat(1024) }));
  await assertRejects(
    () =>
      fetchWithValidatedRedirects(
        new Request(url, { method: "POST", body: "activity" }),
        hops.openHop,
        () => Promise.reject(new Error("consume failed")),
      ),
    Error,
    "consume failed",
  );
  assertEquals(hops.events, [
    `open ${url}`,
    `fetch #1 ${url}`,
    "cancel #1 by close",
    `close ${url}`,
  ]);
  hops.assertInvariants();
});

test("sendActivity() logs a successful response body failing to cancel", async (t) => {
  for (const signed of [true, false]) {
    await t.step(`signed: ${signed}`, async () => {
      const inbox = "https://example.com/lifecycle/cancel-failure-inbox";
      const hops = recordHops(() => ({
        status: 202,
        body: "Accepted",
        failCancel: true,
      }));
      const records = await captureLogs(() =>
        sendActivity({
          activity: lifecycleActivity,
          keys: signed ? signedKeys : unsignedKeys,
          inbox: new URL(inbox),
        }, { openHop: hops.openHop })
      );
      assertEquals(hops.events, [
        `open ${inbox}`,
        `fetch #1 ${inbox}`,
        "cancel #1",
        `close ${inbox}`,
      ]);
      assertEquals(getCancelFailureUrls(records), [inbox]);
      hops.assertInvariants();
    });
  }
});

test("sendActivity() is not blocked by a body cancellation that never settles", async (t) => {
  for (const signed of [true, false]) {
    await t.step(`signed: ${signed}`, async () => {
      const inbox = "https://example.com/lifecycle/hanging-cancel";
      const next = "https://example.com/lifecycle/hanging-cancel-final";
      const hops = recordHops((request) =>
        request.url === inbox
          ? {
            status: 302,
            headers: { Location: next },
            body: "Found",
            hangCancel: true,
          }
          : { status: 202, body: "Accepted", hangCancel: true }
      );
      await sendActivity({
        activity: lifecycleActivity,
        keys: signed ? signedKeys : unsignedKeys,
        inbox: new URL(inbox),
      }, { openHop: hops.openHop });
      assertEquals(hops.events, [
        `open ${inbox}`,
        `fetch #1 ${inbox}`,
        "cancel #1",
        `close ${inbox}`,
        `open ${next}`,
        `fetch #2 ${next}`,
        "cancel #2",
        `close ${next}`,
      ]);
      hops.assertInvariants();
    });
  }

  await t.step("truncated error body", async () => {
    const inbox = "https://example.com/lifecycle/hanging-error";
    const hops = recordHops(() => ({
      status: 500,
      body: "x".repeat(4096),
      hangCancel: true,
    }));
    const error = await assertRejects(
      () =>
        sendActivity({
          activity: lifecycleActivity,
          keys: unsignedKeys,
          inbox: new URL(inbox),
        }, { openHop: hops.openHop }),
      SendActivityError,
    );
    assertEquals(error.responseBody, "x".repeat(1024) + "… (truncated)");
    assertEquals(hops.events, [
      `open ${inbox}`,
      `fetch #1 ${inbox}`,
      "cancel #1",
      `close ${inbox}`,
    ]);
    hops.assertInvariants();
  });
});

test("sendActivity() completes with responses cloned by fetch-mock", async (t) => {
  // fetch-mock returns a clone (a tee branch) of a Response instance, whose
  // cancellation never settles on Node.js:
  for (const signed of [true, false]) {
    await t.step(`signed: ${signed}`, async () => {
      fetchMock.spyGlobal();
      try {
        fetchMock.post(
          "https://example.com/tee/inbox",
          () =>
            new Response("Moved", {
              status: 307,
              headers: { Location: "https://example.com/tee/final" },
            }),
        );
        fetchMock.post(
          "https://example.com/tee/final",
          () => new Response("Accepted", { status: 202 }),
        );
        fetchMock.post(
          "https://example.com/tee/error",
          () => new Response("x".repeat(4096), { status: 404 }),
        );
        const keys = signed ? signedKeys : unsignedKeys;
        await sendDirect({
          activity: lifecycleActivity,
          keys,
          inbox: new URL("https://example.com/tee/inbox"),
        });
        assertEquals(
          fetchMock.callHistory.calls("https://example.com/tee/final").length,
          1,
        );
        const error = await assertRejects(
          () =>
            sendDirect({
              activity: lifecycleActivity,
              keys,
              inbox: new URL("https://example.com/tee/error"),
            }),
          SendActivityError,
        );
        assertEquals(error.statusCode, 404);
        assertEquals(error.responseBody, "x".repeat(1024) + "… (truncated)");
      } finally {
        fetchMock.hardReset();
      }
    });
  }
});

interface RecordedResponseInit {
  readonly status?: number;
  readonly headers?: HeadersInit;
  readonly body?: string;
  readonly chunkSize?: number;
  readonly failCancel?: boolean;
  readonly hangCancel?: boolean;
}

interface RecordedResponse {
  readonly response: Response;
  readonly settled: () => boolean;
}

// Creates a response whose body records being read to the end
// ("consumed #n") or cancelled ("cancel #n"):
function createRecordedResponse(
  events: string[],
  index: number,
  init: RecordedResponseInit,
  cancelSuffix: () => string = () => "",
): RecordedResponse {
  const bytes = new TextEncoder().encode(init.body ?? "");
  const chunkSize = init.chunkSize ?? 256;
  let offset = 0;
  let settled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        settled = true;
        events.push(`consumed #${index}`);
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
    cancel() {
      settled = true;
      events.push(`cancel #${index}${cancelSuffix()}`);
      if (init.failCancel) throw new Error(`cancel #${index} failed`);
      // Like a branch of a tee whose other branch is never cancelled:
      if (init.hangCancel) return new Promise<void>(() => {});
    },
  }, { highWaterMark: 0 });
  return {
    response: new Response(body, {
      status: init.status ?? 200,
      headers: init.headers,
    }),
    settled: () => settled,
  };
}

interface HopRecorder {
  readonly events: string[];
  readonly requests: Request[];
  openHop(url: string): Promise<PublicFetchSession>;
  assertInvariants(): void;
}

// Records the lifecycle of the hop sessions.  Like the real sessions, close()
// starts cancelling the bodies that are still unsettled without awaiting it,
// but records them as "cancel #n by close" so that tests can tell them apart.
// The cancel callbacks run synchronously inside cancel(), so they are
// recorded before "close":
function recordHops(
  respond: (
    request: Request,
    index: number,
  ) => RecordedResponseInit | Promise<RecordedResponseInit>,
): HopRecorder {
  const events: string[] = [];
  const requests: Request[] = [];
  const unsettledAtClose: number[] = [];
  let opens = 0;
  let closes = 0;
  let fetches = 0;
  return {
    events,
    requests,
    openHop(url: string): Promise<PublicFetchSession> {
      opens++;
      events.push(`open ${url}`);
      const tracked: (RecordedResponse & { index: number })[] = [];
      let closed = false;
      let closing = false;
      return Promise.resolve({
        url: new URL(url),
        async fetch(input, init) {
          if (closed) throw new TypeError("The session is closed.");
          const request = new Request(
            (input instanceof Request ? input.clone() : input) as
              | Request
              | URL
              | string,
            init,
          );
          const index = ++fetches;
          requests.push(request);
          events.push(`fetch #${index} ${request.url}`);
          const recorded = createRecordedResponse(
            events,
            index,
            await respond(request, index),
            () => closing ? " by close" : "",
          );
          tracked.push({ ...recorded, index });
          return recorded.response;
        },
        close() {
          if (closed) return Promise.resolve();
          closed = true;
          closes++;
          closing = true;
          for (const { response, settled, index } of tracked) {
            if (settled()) continue;
            if (response.body?.locked) unsettledAtClose.push(index);
            else response.body?.cancel().catch(() => {});
          }
          events.push(`close ${url}`);
          return Promise.resolve();
        },
      });
    },
    assertInvariants() {
      assertEquals(opens, closes);
      assertEquals(unsettledAtClose, []);
    },
  };
}
