import { test } from "@fedify/fixture";
import type { HrTime, SpanContext, SpanStatus } from "@opentelemetry/api";
import { SpanKind, SpanStatusCode, TraceFlags } from "@opentelemetry/api";
import type { ReadableSpan, TimedEvent } from "@opentelemetry/sdk-trace-base";
import { assert, assertEquals } from "@std/assert";
import {
  type KvKey,
  type KvStore,
  type KvStoreListEntry,
  MemoryKvStore,
} from "../federation/kv.ts";
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

  const parentSpanContext: SpanContext | undefined = options.parentSpanId
    ? {
      traceId,
      spanId: options.parentSpanId,
      traceFlags: TraceFlags.SAMPLED,
    }
    : undefined;

  return {
    name: options.name ?? "test-span",
    kind: SpanKind.INTERNAL,
    spanContext: () => spanContext,
    parentSpanContext,
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
      getRawAttributes: () => [],
      merge: () => ({
        attributes: {},
        getRawAttributes: () => [],
        merge: () => null as unknown as ReturnType<typeof Object.assign>,
      }),
    },
    instrumentationScope: { name: "test" },
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
  await t.step("constructor accepts KvStore with list()", () => {
    const kv = new MemoryKvStore();
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

  function createOutboundSpan(traceId: string, spanId: string): ReadableSpan {
    return createMockSpan({
      traceId,
      spanId,
      name: "activitypub.send_activity",
      events: [
        createActivitySentEvent({
          activityJson: JSON.stringify({
            "@context": "https://www.w3.org/ns/activitystreams",
            type: "Create",
            id: `https://local.example/activities/${spanId}`,
          }),
          inboxUrl: "https://follower.example/inbox",
        }),
      ],
    });
  }

  async function exportSpans(
    exporter: FedifySpanExporter,
    spans: ReadableSpan[],
  ): Promise<void> {
    const result = await new Promise<{ code: number }>((resolve) => {
      exporter.export(spans, resolve);
    });
    assertEquals(result.code, 0);
  }

  for (const withCas of [true, false]) {
    const createStore = (): KvStore => {
      const memory = new MemoryKvStore();
      return withCas ? memory : {
        get: memory.get.bind(memory),
        set: memory.set.bind(memory),
        delete: memory.delete.bind(memory),
        list: memory.list.bind(memory),
      };
    };

    await t.step(
      `re-export counts each retained span once (CAS=${withCas})`,
      async () => {
        const kv = createStore();
        const exporters = [
          new FedifySpanExporter(kv),
          new FedifySpanExporter(kv),
        ];
        const span = createOutboundSpan("reexport-trace", "span-a");
        await exportSpans(exporters[0], [span]);
        await exportSpans(exporters[0], [span]);
        assertEquals(
          (await exporters[1].getRecentTraces())[0].activityCount,
          1,
        );

        await Promise.all(
          exporters.map((exporter) => exportSpans(exporter, [span])),
        );
        assertEquals(
          (await exporters[0].getActivitiesByTraceId("reexport-trace")).length,
          1,
        );
        assertEquals(
          (await exporters[1].getRecentTraces())[0].activityCount,
          1,
        );
      },
    );

    await t.step(
      `concurrent distinct spans are all counted (CAS=${withCas})`,
      async () => {
        const kv = createStore();
        const exporters = [
          new FedifySpanExporter(kv),
          new FedifySpanExporter(kv),
        ];
        await Promise.all(exporters.map((exporter, i) =>
          exportSpans(exporter, [
            createOutboundSpan("concurrent-count-trace", `span-${i}`),
          ])
        ));
        const reader = new FedifySpanExporter(kv);
        assertEquals(
          (await reader.getActivitiesByTraceId("concurrent-count-trace"))
            .length,
          2,
        );
        assertEquals((await reader.getRecentTraces())[0].activityCount, 2);
      },
    );

    await t.step(
      `legacy summaries cannot hide or inflate retained records (CAS=${withCas})`,
      async () => {
        const kv = createStore();
        const exporter = new FedifySpanExporter(kv);
        await exportSpans(exporter, [
          createOutboundSpan("legacy-trace", "span-a"),
        ]);
        // Model an old writer whose record write succeeded but summary write failed.
        await kv.delete(["fedify", "traces", "_summaries", "legacy-trace"]);
        const originalSet = kv.set.bind(kv);
        let writes = 0;
        kv.set = (...args) => {
          writes++;
          return originalSet(...args);
        };
        assertEquals((await exporter.getRecentTraces())[0].activityCount, 1);
        assertEquals(writes, 0);

        const stale = {
          traceId: "legacy-trace",
          timestamp: "2000-01-01T00:00:00.000Z",
          activityCount: 99,
          activityTypes: ["Bogus"],
        };
        await kv.set(["fedify", "traces", "_summaries", "legacy-trace"], stale);
        await kv.set(["fedify", "traces", "_summaries", "ghost-trace"], {
          ...stale,
          traceId: "ghost-trace",
        });
        const records = await exporter.getActivitiesByTraceId("legacy-trace");
        assertEquals(await exporter.getRecentTraces(), [{
          traceId: "legacy-trace",
          timestamp: records[0].timestamp,
          activityCount: 1,
          activityTypes: ["Create"],
        }]);
        await kv.delete(["fedify", "traces", "legacy-trace", "span-a"]);
        assertEquals(await exporter.getRecentTraces(), []);
      },
    );

    await t.step(
      `summary metadata follows retained records (CAS=${withCas})`,
      async () => {
        const kv = createStore();
        const exporter = new FedifySpanExporter(kv, { keyPrefix: ["custom"] });
        function span(
          traceId: string,
          spanId: string,
          type: string,
          seconds: number,
        ) {
          const event = createActivitySentEvent({
            activityJson: JSON.stringify({ type }),
            inboxUrl: "https://example.com/inbox",
          });
          return createMockSpan({
            traceId,
            spanId,
            events: [{ ...event, time: [seconds, 0] }],
          });
        }
        // Write later events first so aggregation must lower the timestamp.
        await exportSpans(exporter, [
          span("older-trace", "late", "Like", 1700000002),
          span("older-trace", "early", "Create", 1700000000),
          span("older-trace", "duplicate-type", "Like", 1700000003),
          span("newer-trace", "only", "Follow", 1700000001),
        ]);
        const recent = await exporter.getRecentTraces();
        assertEquals(recent.map((summary) => summary.traceId), [
          "newer-trace",
          "older-trace",
        ]);
        assertEquals(recent[1], {
          traceId: "older-trace",
          timestamp: new Date(1700000000000).toISOString(),
          activityCount: 3,
          activityTypes: ["Like", "Create"],
        });
        assertEquals(await exporter.getRecentTraces({ limit: 1 }), [recent[0]]);
        await kv.delete(["custom", "older-trace", "early"]);
        const retained = await exporter.getRecentTraces();
        assertEquals(retained[0], {
          traceId: "older-trace",
          timestamp: new Date(1700000002000).toISOString(),
          activityCount: 2,
          activityTypes: ["Like"],
        });
      },
    );
  }

  await t.step(
    "a trace with only one record is discoverable via " +
      "getRecentTraces(), with no further write",
    async () => {
      const kv = new MemoryKvStore();
      const exporter = new FedifySpanExporter(kv);
      const traceId = "first-write-discoverable-trace";

      await new Promise<void>((resolve) => {
        exporter.export(
          [createOutboundSpan(traceId, "span-a")],
          () => resolve(),
        );
      });

      const recent = await exporter.getRecentTraces();
      const summary = recent.find((s) => s.traceId === traceId);
      assertEquals(summary?.activityCount, 1);
    },
  );

  await t.step(
    "getRecentTraces() needs no additional writes to discover a trace " +
      "or correct its activityCount",
    async () => {
      const kv = new MemoryKvStore();
      const exporter = new FedifySpanExporter(kv);
      const traceId = "query-time-correction-trace";

      await new Promise<void>((resolve) => {
        exporter.export(
          [createOutboundSpan(traceId, "span-a")],
          () => resolve(),
        );
      });
      await new Promise<void>((resolve) => {
        exporter.export(
          [createOutboundSpan(traceId, "span-b")],
          () => resolve(),
        );
      });

      const originalSet = kv.set.bind(kv);
      let writeCalls = 0;
      kv.set = (key, value, options) => {
        writeCalls++;
        return originalSet(key, value, options);
      };

      const recent = await exporter.getRecentTraces();
      const summary = recent.find((s) => s.traceId === traceId);
      assertEquals(summary?.activityCount, 2);
      assertEquals(writeCalls, 0);
    },
  );

  await t.step(
    "getRecentTraces() reflects only currently-retained records, " +
      "e.g., after some have expired",
    async () => {
      const kv = new MemoryKvStore();
      const exporter = new FedifySpanExporter(kv);
      const traceId = "expiry-reflects-retained-trace";

      await new Promise<void>((resolve) => {
        exporter.export(
          [
            createOutboundSpan(traceId, "span-a"),
            createOutboundSpan(traceId, "span-b"),
          ],
          () => resolve(),
        );
      });

      let recent = await exporter.getRecentTraces();
      assertEquals(
        recent.find((s) => s.traceId === traceId)?.activityCount,
        2,
      );

      // Stand in for span-a's record having expired (or otherwise been
      // removed) since it was written: it is no longer returned by
      // list(), so it must no longer be counted either.
      await kv.delete(["fedify", "traces", traceId, "span-a"]);

      recent = await exporter.getRecentTraces();
      assertEquals(
        recent.find((s) => s.traceId === traceId)?.activityCount,
        1,
      );
    },
  );

  await t.step(
    "getRecentTraces() polling cost scales with every retained record, " +
      "not just records changed since the last poll, and limit does " +
      "not reduce it",
    async () => {
      const kv = new MemoryKvStore();
      const exporter = new FedifySpanExporter(kv);
      const traceCount = 20;
      const recordsPerTrace = 5;

      for (let i = 0; i < traceCount; i++) {
        const traceId = `poll-cost-trace-${i}`;
        const spans = Array.from(
          { length: recordsPerTrace },
          (_, j) => createOutboundSpan(traceId, `span-${j}`),
        );
        await new Promise<void>((resolve) => {
          exporter.export(spans, () => resolve());
        });
      }

      const originalList = kv.list.bind(kv);
      let entriesRead = 0;
      let bytesRead = 0;
      kv.list = async function* (prefix) {
        for await (const entry of originalList(prefix)) {
          entriesRead++;
          bytesRead +=
            new TextEncoder().encode(JSON.stringify(entry.value)).byteLength;
          yield entry;
        }
      };

      const recent = await exporter.getRecentTraces();
      assertEquals(recent.length, traceCount);
      assertEquals(entriesRead, traceCount * recordsPerTrace);
      assert(bytesRead > 0);
      const entriesReadForFullScan = entriesRead;
      const bytesReadForFullScan = bytesRead;

      entriesRead = 0;
      bytesRead = 0;
      const limited = await exporter.getRecentTraces({ limit: 3 });
      assertEquals(limited.length, 3);
      // limit only truncates the array returned after the full scan; it
      // does not reduce how much is scanned or read.
      assertEquals(entriesRead, entriesReadForFullScan);
      assertEquals(bytesRead, bytesReadForFullScan);
    },
  );

  await t.step(
    "recent-list scans include full inbound payloads even with limit",
    async () => {
      const kv = new MemoryKvStore();
      const exporter = new FedifySpanExporter(kv);
      const activityJson = JSON.stringify({
        type: "Create",
        object: { type: "Note", content: "한".repeat(64 * 1024) },
      });
      await exportSpans(
        exporter,
        Array.from({ length: 10 }, (_, i) =>
          createMockSpan({
            traceId: `large-inbound-${i}`,
            spanId: "inbound",
            events: [createActivityReceivedEvent({ activityJson })],
          })),
      );
      const originalList = kv.list.bind(kv);
      let entriesRead = 0;
      let bytesRead = 0;
      kv.list = async function* (prefix) {
        for await (const entry of originalList(prefix)) {
          entriesRead++;
          bytesRead +=
            new TextEncoder().encode(JSON.stringify(entry.value)).byteLength;
          yield entry;
        }
      };
      assertEquals((await exporter.getRecentTraces({ limit: 1 })).length, 1);
      assertEquals(entriesRead, 10);
      assert(
        bytesRead >= new TextEncoder().encode(activityJson).byteLength * 10,
      );
      // Serialized UTF-8 value bytes only; excludes keys and backend protocol overhead.
      assert(bytesRead > 1.8 * 1024 * 1024);
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

  await t.step("works with custom KvStore implementation", async () => {
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
      async *list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
        for (const [encodedKey, value] of Object.entries(storedData)) {
          const key = JSON.parse(encodedKey) as KvKey;
          if (prefix != null) {
            if (key.length < prefix.length) continue;
            if (!prefix.every((p, i) => key[i] === p)) continue;
          }
          yield { key, value };
        }
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
