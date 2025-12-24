import { assertEquals, assertThrows } from "@std/assert";
import type { HrTime, SpanContext, SpanStatus } from "@opentelemetry/api";
import { SpanKind, SpanStatusCode, TraceFlags } from "@opentelemetry/api";
import type { ReadableSpan, TimedEvent } from "@opentelemetry/sdk-trace-base";
import { type KvKey, type KvStore, MemoryKvStore } from "../federation/kv.ts";
import { test } from "../testing/mod.ts";
import { FedifySpanExporter } from "./exporter.ts";

function createMockSpan(options: {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  events?: TimedEvent[];
}): ReadableSpan {
  const traceId = options.traceId ?? "0123456789abcdef0123456789abcdef";
  const spanId = options.spanId ?? "0123456789abcdef";

  const spanContext: SpanContext = {
    traceId,
    spanId,
    traceFlags: TraceFlags.SAMPLED,
  };

  return {
    name: options.name ?? "test-span",
    kind: SpanKind.INTERNAL,
    spanContext: () => spanContext,
    parentSpanId: options.parentSpanId,
    startTime: [1700000000, 0] as HrTime,
    endTime: [1700000001, 0] as HrTime,
    status: { code: SpanStatusCode.OK } as SpanStatus,
    attributes: {},
    links: [],
    events: options.events ?? [],
    duration: [1, 0] as HrTime,
    ended: true,
    resource: {
      attributes: {},
      merge: () => ({
        attributes: {},
        merge: () => null as unknown as ReturnType<typeof Object.assign>,
      }),
    },
    instrumentationLibrary: { name: "test" },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

function createActivityReceivedEvent(options: {
  activityJson: string;
  verified?: boolean;
  ldSigVerified?: boolean;
  httpSigVerified?: boolean;
  httpSigKeyId?: string;
}): TimedEvent {
  return {
    name: "activitypub.activity.received",
    time: [1700000000, 500000000] as HrTime,
    attributes: {
      "activitypub.activity.json": options.activityJson,
      "activitypub.activity.verified": options.verified ?? true,
      "ld_signatures.verified": options.ldSigVerified ?? false,
      "http_signatures.verified": options.httpSigVerified ?? true,
      "http_signatures.key_id": options.httpSigKeyId ?? "",
    },
  };
}

function createActivitySentEvent(options: {
  activityJson: string;
  inboxUrl: string;
  activityId?: string;
}): TimedEvent {
  return {
    name: "activitypub.activity.sent",
    time: [1700000000, 500000000] as HrTime,
    attributes: {
      "activitypub.activity.json": options.activityJson,
      "activitypub.inbox.url": options.inboxUrl,
      "activitypub.activity.id": options.activityId ?? "",
    },
  };
}

test("FedifySpanExporter", async (t) => {
  await t.step(
    "constructor throws if KvStore has neither list() nor cas()",
    () => {
      const kv: KvStore = {
        get: () => Promise.resolve(undefined),
        set: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      };

      assertThrows(
        () => new FedifySpanExporter(kv),
        Error,
        "KvStore must support either list() or cas()",
      );
    },
  );

  await t.step("constructor accepts KvStore with list()", () => {
    const kv = new MemoryKvStore();
    const exporter = new FedifySpanExporter(kv);
    assertEquals(exporter instanceof FedifySpanExporter, true);
  });

  await t.step("constructor accepts KvStore with cas() only", () => {
    const kv: KvStore = {
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      cas: () => Promise.resolve(true),
    };
    const exporter = new FedifySpanExporter(kv);
    assertEquals(exporter instanceof FedifySpanExporter, true);
  });

  await t.step("export() stores inbound activity from span event", async () => {
    const kv = new MemoryKvStore();
    const exporter = new FedifySpanExporter(kv);

    const traceId = "trace123";
    const spanId = "span456";
    const activity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Create",
      id: "https://example.com/activities/123",
      actor: "https://example.com/users/alice",
      object: {
        type: "Note",
        content: "Hello!",
      },
    };
    const activityJson = JSON.stringify(activity);

    const span = createMockSpan({
      traceId,
      spanId,
      name: "activitypub.inbox",
      events: [
        createActivityReceivedEvent({
          activityJson,
          verified: true,
          httpSigVerified: true,
        }),
      ],
    });

    await new Promise<void>((resolve) => {
      exporter.export([span], (result) => {
        assertEquals(result.code, 0); // SUCCESS
        resolve();
      });
    });

    const activities = await exporter.getActivitiesByTraceId(traceId);
    assertEquals(activities.length, 1);
    assertEquals(activities[0].traceId, traceId);
    assertEquals(activities[0].spanId, spanId);
    assertEquals(activities[0].direction, "inbound");
    assertEquals(activities[0].activityType, activity.type);
    assertEquals(activities[0].activityId, activity.id);
    assertEquals(activities[0].activityJson, activityJson);
    assertEquals(activities[0].verified, true);
  });

  await t.step(
    "export() stores outbound activity from span event",
    async () => {
      const kv = new MemoryKvStore();
      const exporter = new FedifySpanExporter(kv);

      const traceId = "trace789";
      const spanId = "span012";
      const inboxUrl = "https://example.com/users/alice/inbox";
      const activity = {
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Follow",
        id: "https://myserver.com/activities/789",
        actor: "https://myserver.com/users/bob",
        object: "https://example.com/users/alice",
      };
      const activityJson = JSON.stringify(activity);

      const span = createMockSpan({
        traceId,
        spanId,
        name: "activitypub.send_activity",
        events: [
          createActivitySentEvent({
            activityJson,
            inboxUrl,
            activityId: activity.id,
          }),
        ],
      });

      await new Promise<void>((resolve) => {
        exporter.export([span], (result) => {
          assertEquals(result.code, 0);
          resolve();
        });
      });

      const activities = await exporter.getActivitiesByTraceId(traceId);
      assertEquals(activities.length, 1);
      assertEquals(activities[0].traceId, traceId);
      assertEquals(activities[0].spanId, spanId);
      assertEquals(activities[0].direction, "outbound");
      assertEquals(activities[0].activityType, activity.type);
      assertEquals(activities[0].activityId, activity.id);
      assertEquals(activities[0].inboxUrl, inboxUrl);
    },
  );

  await t.step("export() ignores spans without activity events", async () => {
    const kv = new MemoryKvStore();
    const exporter = new FedifySpanExporter(kv);

    const span = createMockSpan({
      traceId: "trace999",
      spanId: "span999",
      name: "some-other-span",
      events: [],
    });

    await new Promise<void>((resolve) => {
      exporter.export([span], (result) => {
        assertEquals(result.code, 0);
        resolve();
      });
    });

    const activities = await exporter.getActivitiesByTraceId("trace999");
    assertEquals(activities.length, 0);
  });

  await t.step(
    "export() stores multiple activities from same trace",
    async () => {
      const kv = new MemoryKvStore();
      const exporter = new FedifySpanExporter(kv);

      const inboundActivity = JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Create",
        id: "https://example.com/activities/1",
      });

      const outboundActivity = JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Accept",
        id: "https://myserver.com/activities/2",
      });

      const span1 = createMockSpan({
        traceId: "multitrace",
        spanId: "span1",
        name: "activitypub.inbox",
        events: [
          createActivityReceivedEvent({ activityJson: inboundActivity }),
        ],
      });

      const span2 = createMockSpan({
        traceId: "multitrace",
        spanId: "span2",
        parentSpanId: "span1",
        name: "activitypub.send_activity",
        events: [
          createActivitySentEvent({
            activityJson: outboundActivity,
            inboxUrl: "https://example.com/inbox",
          }),
        ],
      });

      await new Promise<void>((resolve) => {
        exporter.export([span1, span2], (result) => {
          assertEquals(result.code, 0);
          resolve();
        });
      });

      const activities = await exporter.getActivitiesByTraceId("multitrace");
      assertEquals(activities.length, 2);

      const inbound = activities.find((a) => a.direction === "inbound");
      const outbound = activities.find((a) => a.direction === "outbound");

      assertEquals(inbound?.activityType, "Create");
      assertEquals(outbound?.activityType, "Accept");
      assertEquals(outbound?.parentSpanId, "span1");
    },
  );

  await t.step("getRecentTraces() returns recent traces", async () => {
    const kv = new MemoryKvStore();
    const exporter = new FedifySpanExporter(kv);

    // Create activities in different traces
    for (let i = 0; i < 5; i++) {
      const activityJson = JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Create",
        id: `https://example.com/activities/${i}`,
      });

      const span = createMockSpan({
        traceId: `trace-${i}`,
        spanId: `span-${i}`,
        name: "activitypub.inbox",
        events: [createActivityReceivedEvent({ activityJson })],
      });

      await new Promise<void>((resolve) => {
        exporter.export([span], () => resolve());
      });
    }

    const traces = await exporter.getRecentTraces({ limit: 3 });
    assertEquals(traces.length, 3);
  });

  await t.step(
    "getRecentTraces() returns all traces when limit not specified",
    async () => {
      const kv = new MemoryKvStore();
      const exporter = new FedifySpanExporter(kv);

      for (let i = 0; i < 3; i++) {
        const activityJson = JSON.stringify({
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "Create",
          id: `https://example.com/activities/${i}`,
        });

        const span = createMockSpan({
          traceId: `all-trace-${i}`,
          spanId: `span-${i}`,
          name: "activitypub.inbox",
          events: [createActivityReceivedEvent({ activityJson })],
        });

        await new Promise<void>((resolve) => {
          exporter.export([span], () => resolve());
        });
      }

      const traces = await exporter.getRecentTraces();
      assertEquals(traces.length >= 3, true);
    },
  );

  await t.step("forceFlush() returns resolved promise", async () => {
    const kv = new MemoryKvStore();
    const exporter = new FedifySpanExporter(kv);
    await exporter.forceFlush();
  });

  await t.step("shutdown() completes successfully", async () => {
    const kv = new MemoryKvStore();
    const exporter = new FedifySpanExporter(kv);
    await exporter.shutdown();
  });

  await t.step("works with cas()-only KvStore", async () => {
    const storedData: Record<string, unknown> = {};

    const kv: KvStore = {
      get: <T>(key: KvKey) => {
        const k = JSON.stringify(key);
        return Promise.resolve(storedData[k] as T | undefined);
      },
      set: (key: KvKey, value: unknown) => {
        const k = JSON.stringify(key);
        storedData[k] = value;
        return Promise.resolve();
      },
      delete: (key: KvKey) => {
        const k = JSON.stringify(key);
        delete storedData[k];
        return Promise.resolve();
      },
      cas: (key: KvKey, expected: unknown, newValue: unknown) => {
        const k = JSON.stringify(key);
        const current = storedData[k];
        if (JSON.stringify(current) === JSON.stringify(expected)) {
          storedData[k] = newValue;
          return Promise.resolve(true);
        }
        return Promise.resolve(false);
      },
    };

    const exporter = new FedifySpanExporter(kv);

    const activityJson = JSON.stringify({
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Like",
      id: "https://example.com/activities/like",
    });

    const span = createMockSpan({
      traceId: "cas-trace",
      spanId: "cas-span",
      name: "activitypub.inbox",
      events: [createActivityReceivedEvent({ activityJson })],
    });

    await new Promise<void>((resolve) => {
      exporter.export([span], (result) => {
        assertEquals(result.code, 0);
        resolve();
      });
    });

    const activities = await exporter.getActivitiesByTraceId("cas-trace");
    assertEquals(activities.length, 1);
    assertEquals(activities[0].activityType, "Like");
  });

  await t.step("TTL option is respected", async () => {
    const kv = new MemoryKvStore();
    const exporter = new FedifySpanExporter(kv, {
      ttl: Temporal.Duration.from({ hours: 1 }),
    });

    const activityJson = JSON.stringify({
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Create",
    });

    const span = createMockSpan({
      traceId: "ttl-trace",
      spanId: "ttl-span",
      name: "activitypub.inbox",
      events: [createActivityReceivedEvent({ activityJson })],
    });

    await new Promise<void>((resolve) => {
      exporter.export([span], () => resolve());
    });

    // Data should exist immediately after export
    const activities = await exporter.getActivitiesByTraceId("ttl-trace");
    assertEquals(activities.length, 1);
  });

  await t.step("keyPrefix option customizes storage keys", async () => {
    const kv = new MemoryKvStore();
    const exporter = new FedifySpanExporter(kv, {
      keyPrefix: ["custom", "prefix"],
    });

    const activityJson = JSON.stringify({
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Announce",
    });

    const span = createMockSpan({
      traceId: "prefix-trace",
      spanId: "prefix-span",
      name: "activitypub.inbox",
      events: [createActivityReceivedEvent({ activityJson })],
    });

    await new Promise<void>((resolve) => {
      exporter.export([span], () => resolve());
    });

    // Verify data is stored with custom prefix
    const activities = await exporter.getActivitiesByTraceId("prefix-trace");
    assertEquals(activities.length, 1);
    assertEquals(activities[0].activityType, "Announce");
  });

  await t.step(
    "separate exporter instances share state via same KvStore (distributed simulation)",
    async () => {
      // This test simulates a distributed environment where multiple
      // processes/workers share the same KvStore
      const sharedKv = new MemoryKvStore();

      // Exporter 1: simulates web server receiving an activity
      const webServerExporter = new FedifySpanExporter(sharedKv);

      // Exporter 2: simulates background worker processing the activity
      const workerExporter = new FedifySpanExporter(sharedKv);

      // Exporter 3: simulates debug dashboard querying traces
      const dashboardExporter = new FedifySpanExporter(sharedKv);

      // Web server receives an inbound activity
      const inboundActivity = JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Follow",
        id: "https://remote.example/activities/follow-1",
        actor: "https://remote.example/users/alice",
        object: "https://local.example/users/bob",
      });

      const inboxSpan = createMockSpan({
        traceId: "distributed-trace-001",
        spanId: "inbox-span",
        name: "activitypub.inbox",
        events: [
          createActivityReceivedEvent({
            activityJson: inboundActivity,
            verified: true,
          }),
        ],
      });

      await new Promise<void>((resolve) => {
        webServerExporter.export([inboxSpan], () => resolve());
      });

      // Worker sends an Accept activity in response
      const outboundActivity = JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Accept",
        id: "https://local.example/activities/accept-1",
        actor: "https://local.example/users/bob",
        object: "https://remote.example/activities/follow-1",
      });

      const sendSpan = createMockSpan({
        traceId: "distributed-trace-001", // Same trace ID
        spanId: "send-span",
        parentSpanId: "inbox-span",
        name: "activitypub.send_activity",
        events: [
          createActivitySentEvent({
            activityJson: outboundActivity,
            inboxUrl: "https://remote.example/users/alice/inbox",
            activityId: "https://local.example/activities/accept-1",
          }),
        ],
      });

      await new Promise<void>((resolve) => {
        workerExporter.export([sendSpan], () => resolve());
      });

      // Dashboard queries the trace - should see both activities
      // even though they were stored by different exporter instances
      const activities = await dashboardExporter.getActivitiesByTraceId(
        "distributed-trace-001",
      );

      assertEquals(activities.length, 2);

      // Verify both activities are present
      const follow = activities.find((a) => a.activityType === "Follow");
      const accept = activities.find((a) => a.activityType === "Accept");

      assertEquals(follow != null, true);
      assertEquals(follow?.direction, "inbound");
      assertEquals(follow?.verified, true);

      assertEquals(accept != null, true);
      assertEquals(accept?.direction, "outbound");
      assertEquals(
        accept?.inboxUrl,
        "https://remote.example/users/alice/inbox",
      );
      assertEquals(accept?.parentSpanId, "inbox-span");

      // Dashboard can also list recent traces
      const recentTraces = await dashboardExporter.getRecentTraces();
      const ourTrace = recentTraces.find(
        (t) => t.traceId === "distributed-trace-001",
      );

      assertEquals(ourTrace != null, true);
      assertEquals(ourTrace?.activityCount, 2);
      assertEquals(ourTrace?.activityTypes.includes("Follow"), true);
      assertEquals(ourTrace?.activityTypes.includes("Accept"), true);
    },
  );

  await t.step(
    "multiple workers writing to same trace concurrently",
    async () => {
      const sharedKv = new MemoryKvStore();

      // Simulate 3 workers processing the same fanout operation
      const workers = [
        new FedifySpanExporter(sharedKv),
        new FedifySpanExporter(sharedKv),
        new FedifySpanExporter(sharedKv),
      ];

      const traceId = "concurrent-fanout-trace";

      // Each worker sends to a different inbox
      const exportPromises = workers.map((worker, i) => {
        const activityJson = JSON.stringify({
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "Create",
          id: "https://local.example/activities/post-1",
        });

        const span = createMockSpan({
          traceId,
          spanId: `worker-${i}-span`,
          name: "activitypub.send_activity",
          events: [
            createActivitySentEvent({
              activityJson,
              inboxUrl: `https://follower-${i}.example/inbox`,
            }),
          ],
        });

        return new Promise<void>((resolve) => {
          worker.export([span], () => resolve());
        });
      });

      // All workers export concurrently
      await Promise.all(exportPromises);

      // Query from a fresh exporter instance (simulating dashboard)
      const dashboard = new FedifySpanExporter(sharedKv);
      const activities = await dashboard.getActivitiesByTraceId(traceId);

      // Should see all 3 activities from different workers
      assertEquals(activities.length, 3);

      const inboxUrls = activities.map((a) => a.inboxUrl).sort();
      assertEquals(inboxUrls, [
        "https://follower-0.example/inbox",
        "https://follower-1.example/inbox",
        "https://follower-2.example/inbox",
      ]);
    },
  );

  await t.step(
    "extracts actorId from activity with string actor",
    async () => {
      const kv = new MemoryKvStore();
      const exporter = new FedifySpanExporter(kv);

      const activityJson = JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Create",
        id: "https://example.com/activities/123",
        actor: "https://example.com/users/alice",
        object: { type: "Note", content: "Hello!" },
      });

      const span = createMockSpan({
        traceId: "actor-string-trace",
        spanId: "span1",
        name: "activitypub.inbox",
        events: [createActivityReceivedEvent({ activityJson })],
      });

      await new Promise<void>((resolve) => {
        exporter.export([span], () => resolve());
      });

      const activities = await exporter.getActivitiesByTraceId(
        "actor-string-trace",
      );
      assertEquals(activities.length, 1);
      assertEquals(activities[0].actorId, "https://example.com/users/alice");
    },
  );

  await t.step(
    "extracts actorId from activity with object actor",
    async () => {
      const kv = new MemoryKvStore();
      const exporter = new FedifySpanExporter(kv);

      const activityJson = JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Create",
        id: "https://example.com/activities/456",
        actor: {
          type: "Person",
          id: "https://example.com/users/bob",
          name: "Bob",
        },
        object: { type: "Note", content: "Hello!" },
      });

      const span = createMockSpan({
        traceId: "actor-object-trace",
        spanId: "span1",
        name: "activitypub.inbox",
        events: [createActivityReceivedEvent({ activityJson })],
      });

      await new Promise<void>((resolve) => {
        exporter.export([span], () => resolve());
      });

      const activities = await exporter.getActivitiesByTraceId(
        "actor-object-trace",
      );
      assertEquals(activities.length, 1);
      assertEquals(activities[0].actorId, "https://example.com/users/bob");
    },
  );

  await t.step(
    "extracts actorId from outbound activity",
    async () => {
      const kv = new MemoryKvStore();
      const exporter = new FedifySpanExporter(kv);

      const activityJson = JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Follow",
        id: "https://myserver.com/activities/789",
        actor: "https://myserver.com/users/charlie",
        object: "https://example.com/users/alice",
      });

      const span = createMockSpan({
        traceId: "outbound-actor-trace",
        spanId: "span1",
        name: "activitypub.send_activity",
        events: [
          createActivitySentEvent({
            activityJson,
            inboxUrl: "https://example.com/users/alice/inbox",
          }),
        ],
      });

      await new Promise<void>((resolve) => {
        exporter.export([span], () => resolve());
      });

      const activities = await exporter.getActivitiesByTraceId(
        "outbound-actor-trace",
      );
      assertEquals(activities.length, 1);
      assertEquals(activities[0].actorId, "https://myserver.com/users/charlie");
    },
  );

  await t.step(
    "extracts signature verification details for inbound activity",
    async () => {
      const kv = new MemoryKvStore();
      const exporter = new FedifySpanExporter(kv);

      const activityJson = JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Create",
        id: "https://example.com/activities/sig-test",
        actor: "https://example.com/users/alice",
      });

      const span = createMockSpan({
        traceId: "sig-details-trace",
        spanId: "span1",
        name: "activitypub.inbox",
        events: [
          createActivityReceivedEvent({
            activityJson,
            verified: true,
            httpSigVerified: true,
            httpSigKeyId: "https://example.com/users/alice#main-key",
            ldSigVerified: false,
          }),
        ],
      });

      await new Promise<void>((resolve) => {
        exporter.export([span], () => resolve());
      });

      const activities = await exporter.getActivitiesByTraceId(
        "sig-details-trace",
      );
      assertEquals(activities.length, 1);
      assertEquals(activities[0].verified, true);
      assertEquals(activities[0].signatureDetails != null, true);
      assertEquals(
        activities[0].signatureDetails?.httpSignaturesVerified,
        true,
      );
      assertEquals(
        activities[0].signatureDetails?.httpSignaturesKeyId,
        "https://example.com/users/alice#main-key",
      );
      assertEquals(
        activities[0].signatureDetails?.ldSignaturesVerified,
        false,
      );
    },
  );

  await t.step(
    "signature details with LD signatures verified",
    async () => {
      const kv = new MemoryKvStore();
      const exporter = new FedifySpanExporter(kv);

      const activityJson = JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Delete",
        id: "https://example.com/activities/ld-sig-test",
        actor: "https://example.com/users/alice",
      });

      const span = createMockSpan({
        traceId: "ld-sig-trace",
        spanId: "span1",
        name: "activitypub.inbox",
        events: [
          createActivityReceivedEvent({
            activityJson,
            verified: true,
            httpSigVerified: false,
            ldSigVerified: true,
          }),
        ],
      });

      await new Promise<void>((resolve) => {
        exporter.export([span], () => resolve());
      });

      const activities = await exporter.getActivitiesByTraceId("ld-sig-trace");
      assertEquals(activities.length, 1);
      assertEquals(
        activities[0].signatureDetails?.httpSignaturesVerified,
        false,
      );
      assertEquals(activities[0].signatureDetails?.ldSignaturesVerified, true);
    },
  );

  await t.step(
    "handles activity without actor field",
    async () => {
      const kv = new MemoryKvStore();
      const exporter = new FedifySpanExporter(kv);

      const activityJson = JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Delete",
        id: "https://example.com/activities/no-actor",
        object: "https://example.com/posts/123",
      });

      const span = createMockSpan({
        traceId: "no-actor-trace",
        spanId: "span1",
        name: "activitypub.inbox",
        events: [createActivityReceivedEvent({ activityJson })],
      });

      await new Promise<void>((resolve) => {
        exporter.export([span], () => resolve());
      });

      const activities = await exporter.getActivitiesByTraceId(
        "no-actor-trace",
      );
      assertEquals(activities.length, 1);
      assertEquals(activities[0].actorId, undefined);
    },
  );
});
