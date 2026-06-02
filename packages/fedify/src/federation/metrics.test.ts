import { createTestMeterProvider, test } from "@fedify/fixture";
import { assertEquals, assertRejects } from "@std/assert";
import {
  DataPointType,
  type HistogramMetricData,
  MeterProvider,
  MetricReader,
} from "@opentelemetry/sdk-metrics";
import type { DocumentLoader, RemoteDocument } from "@fedify/vocab-runtime";
import { FetchError } from "@fedify/vocab-runtime";
import type { MessageQueue, MessageQueueDepth } from "./mq.ts";
import {
  classifyFetchError,
  getFederationMetrics,
  getRemoteHost,
  instrumentDocumentLoader,
  recordCircuitBreakerStateChange,
  recordCollectionDispatchDuration,
  recordCollectionPageItems,
  recordCollectionRequest,
  recordCollectionTotalItems,
  recordDocumentCache,
  recordDocumentFetch,
  recordFanoutRecipients,
  recordInboxActivity,
  recordKeyLookup,
  recordOutboxActivity,
  recordOutboxEnqueue,
  recordWebFingerHandle,
  registerQueueDepthGauge,
} from "./metrics.ts";

class TestMetricReader extends MetricReader {
  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }

  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

const noopQueue: MessageQueue = {
  enqueue() {
    return Promise.resolve();
  },
  listen() {
    return Promise.resolve();
  },
};

test("getRemoteHost() includes non-default ports", () => {
  assertEquals(
    getRemoteHost(new URL("https://example.com/inbox")),
    "example.com",
  );
  assertEquals(
    getRemoteHost(new URL("https://example.com:8443/inbox")),
    "example.com:8443",
  );
  assertEquals(
    getRemoteHost(new URL("https://example.com:443/inbox")),
    "example.com",
  );
});

test("recordFanoutRecipients() records the recipient count with activity type", () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  recordFanoutRecipients(
    meterProvider,
    7,
    "https://www.w3.org/ns/activitystreams#Create",
  );
  const measurements = recorder.getMeasurements(
    "activitypub.fanout.recipients",
  );
  assertEquals(measurements.length, 1);
  assertEquals(measurements[0].type, "histogram");
  assertEquals(measurements[0].value, 7);
  assertEquals(
    measurements[0].attributes["activitypub.activity.type"],
    "https://www.w3.org/ns/activitystreams#Create",
  );
});

test("recordFanoutRecipients() omits activity type when unknown", () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  recordFanoutRecipients(meterProvider, 0);
  const measurements = recorder.getMeasurements(
    "activitypub.fanout.recipients",
  );
  assertEquals(measurements.length, 1);
  assertEquals(measurements[0].value, 0);
  assertEquals(
    "activitypub.activity.type" in measurements[0].attributes,
    false,
  );
});

test("signature verification duration uses explicit low-latency buckets", async () => {
  const reader = new TestMetricReader();
  const meterProvider = new MeterProvider({ readers: [reader] });
  try {
    getFederationMetrics(meterProvider).recordSignatureVerificationDuration(
      7,
      "http",
      "verified",
    );

    const result = await reader.collect();
    const metric = result.resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .find((metric) =>
        metric.descriptor.name ===
          "activitypub.signature.verification.duration"
      );
    assertEquals(metric?.dataPointType, DataPointType.HISTOGRAM);
    const histogram = metric as HistogramMetricData | undefined;
    assertEquals(histogram?.dataPoints[0].value.buckets.boundaries, [
      0.1,
      0.25,
      0.5,
      1,
      2.5,
      5,
      10,
      25,
      50,
      100,
      250,
      500,
      1000,
    ]);
  } finally {
    await meterProvider.shutdown();
  }
});

test("registerQueueDepthGauge() skips unavailable depth snapshots", async () => {
  const reader = new TestMetricReader();
  const meterProvider = new MeterProvider({ readers: [reader] });
  try {
    const throwingQueue: MessageQueue = {
      enqueue() {
        return Promise.resolve();
      },
      listen() {
        return Promise.resolve();
      },
      getDepth() {
        throw new TypeError("backend unavailable");
      },
    };
    const nullDepthQueue: MessageQueue = {
      enqueue() {
        return Promise.resolve();
      },
      listen() {
        return Promise.resolve();
      },
      getDepth() {
        return Promise.resolve(null as unknown as MessageQueueDepth);
      },
    };
    const healthyQueue: MessageQueue = {
      enqueue() {
        return Promise.resolve();
      },
      listen() {
        return Promise.resolve();
      },
      getDepth() {
        return Promise.resolve({ queued: 7 });
      },
    };

    registerQueueDepthGauge(meterProvider, [
      { role: "inbox", queue: throwingQueue },
      { role: "outbox", queue: nullDepthQueue },
      { role: "fanout", queue: healthyQueue },
    ]);

    const result = await reader.collect();
    assertEquals(result.errors, []);
    const queueDepth = result.resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .find((metric) => metric.descriptor.name === "fedify.queue.depth");
    assertEquals(queueDepth?.dataPointType, DataPointType.GAUGE);
    assertEquals(
      queueDepth?.dataPoints.map((point) => ({
        state: point.attributes["fedify.queue.depth.state"],
        role: point.attributes["fedify.queue.role"],
        value: point.value,
      })),
      [
        { state: "queued", role: "fanout", value: 7 },
      ],
    );
  } finally {
    await meterProvider.shutdown();
  }
});

test("recordInboxActivity() records counter with result and activity type", () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  for (
    const result of [
      "queued",
      "processed",
      "retried",
      "rejected",
      "abandoned",
    ] as const
  ) {
    recordInboxActivity(
      meterProvider,
      result,
      "https://www.w3.org/ns/activitystreams#Follow",
    );
  }
  const measurements = recorder.getMeasurements("activitypub.inbox.activity");
  assertEquals(measurements.length, 5);
  for (const m of measurements) {
    assertEquals(m.type, "counter");
    assertEquals(m.value, 1);
    assertEquals(
      m.attributes["activitypub.activity.type"],
      "https://www.w3.org/ns/activitystreams#Follow",
    );
  }
  assertEquals(
    measurements.map((m) => m.attributes["activitypub.processing.result"]),
    ["queued", "processed", "retried", "rejected", "abandoned"],
  );
});

test("recordInboxActivity() omits activity type when unknown", () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  recordInboxActivity(meterProvider, "rejected");
  const measurements = recorder.getMeasurements("activitypub.inbox.activity");
  assertEquals(measurements.length, 1);
  assertEquals(
    measurements[0].attributes["activitypub.processing.result"],
    "rejected",
  );
  assertEquals(
    "activitypub.activity.type" in measurements[0].attributes,
    false,
  );
});

test("recordOutboxEnqueue() also records activitypub.outbox.activity{queued} on initial enqueue", () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  recordOutboxEnqueue(meterProvider, noopQueue, {
    activityType: "https://www.w3.org/ns/activitystreams#Create",
    attempt: 0,
  });
  const queued = recorder.getMeasurements("activitypub.outbox.activity");
  assertEquals(queued.length, 1);
  assertEquals(queued[0].type, "counter");
  assertEquals(
    queued[0].attributes["activitypub.processing.result"],
    "queued",
  );
  assertEquals(
    queued[0].attributes["activitypub.activity.type"],
    "https://www.w3.org/ns/activitystreams#Create",
  );
});

test("recordOutboxEnqueue() does not record outbox.activity{queued} on retry enqueues", () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  recordOutboxEnqueue(meterProvider, noopQueue, {
    activityType: "https://www.w3.org/ns/activitystreams#Create",
    attempt: 1,
  });
  assertEquals(
    recorder.getMeasurements("activitypub.outbox.activity").length,
    0,
  );
});

test("recordOutboxActivity() records counter with result and activity type", () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  for (const result of ["queued", "retried", "abandoned"] as const) {
    recordOutboxActivity(
      meterProvider,
      result,
      "https://www.w3.org/ns/activitystreams#Announce",
    );
  }
  const measurements = recorder.getMeasurements("activitypub.outbox.activity");
  assertEquals(measurements.length, 3);
  for (const m of measurements) {
    assertEquals(m.type, "counter");
    assertEquals(m.value, 1);
    assertEquals(
      m.attributes["activitypub.activity.type"],
      "https://www.w3.org/ns/activitystreams#Announce",
    );
  }
  assertEquals(
    measurements.map((m) => m.attributes["activitypub.processing.result"]),
    ["queued", "retried", "abandoned"],
  );
});

test("recordCircuitBreakerStateChange() records counter with bounded attributes", () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  recordCircuitBreakerStateChange(
    meterProvider,
    "remote.example",
    "half_open",
  );
  const measurements = recorder.getMeasurements(
    "activitypub.circuit_breaker.state_change",
  );
  assertEquals(measurements.length, 1);
  assertEquals(measurements[0].type, "counter");
  assertEquals(measurements[0].value, 1);
  assertEquals(
    measurements[0].attributes["activitypub.remote.host"],
    "remote.example",
  );
  assertEquals(
    measurements[0].attributes["activitypub.circuit_breaker.state"],
    "half_open",
  );
});

test("recordKeyLookup() records counter and duration with all attributes", () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  recordKeyLookup(meterProvider, {
    durationMs: 42,
    result: "fetched",
    remoteUrl: new URL("https://example.com/users/alice#main-key"),
    cacheEnabled: true,
    statusCode: 200,
  });

  const counters = recorder.getMeasurements("activitypub.key.lookup");
  assertEquals(counters.length, 1);
  assertEquals(counters[0].type, "counter");
  assertEquals(counters[0].value, 1);
  assertEquals(
    counters[0].attributes["activitypub.lookup.kind"],
    "public_key",
  );
  assertEquals(
    counters[0].attributes["activitypub.lookup.result"],
    "fetched",
  );
  assertEquals(
    counters[0].attributes["activitypub.remote.host"],
    "example.com",
  );
  assertEquals(counters[0].attributes["activitypub.cache.enabled"], true);
  assertEquals(counters[0].attributes["http.response.status_code"], 200);

  const durations = recorder.getMeasurements(
    "activitypub.key.lookup.duration",
  );
  assertEquals(durations.length, 1);
  assertEquals(durations[0].type, "histogram");
  assertEquals(durations[0].value, 42);
  assertEquals(
    durations[0].attributes["activitypub.lookup.kind"],
    "public_key",
  );
  assertEquals(
    durations[0].attributes["activitypub.lookup.result"],
    "fetched",
  );
  assertEquals(
    durations[0].attributes["activitypub.remote.host"],
    "example.com",
  );
  assertEquals(durations[0].attributes["activitypub.cache.enabled"], true);
  assertEquals(durations[0].attributes["http.response.status_code"], 200);
});

test("recordKeyLookup() omits optional attributes when not provided", () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  recordKeyLookup(meterProvider, {
    durationMs: 0,
    result: "error",
    cacheEnabled: false,
  });

  const counter = recorder.getMeasurement("activitypub.key.lookup");
  assertEquals(counter?.attributes["activitypub.lookup.result"], "error");
  assertEquals(counter?.attributes["activitypub.cache.enabled"], false);
  assertEquals("activitypub.remote.host" in counter!.attributes, false);
  assertEquals("http.response.status_code" in counter!.attributes, false);

  const duration = recorder.getMeasurement("activitypub.key.lookup.duration");
  assertEquals("activitypub.remote.host" in duration!.attributes, false);
  assertEquals("http.response.status_code" in duration!.attributes, false);
});

test("recordDocumentFetch() records counter and duration with all attributes", () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  recordDocumentFetch(meterProvider, {
    durationMs: 123,
    kind: "object",
    result: "not_found",
    remoteUrl: new URL("https://remote.test/objects/123"),
    cacheEnabled: true,
    statusCode: 404,
  });

  const counter = recorder.getMeasurement("activitypub.document.fetch");
  assertEquals(counter?.type, "counter");
  assertEquals(counter?.value, 1);
  assertEquals(counter?.attributes["activitypub.lookup.kind"], "object");
  assertEquals(counter?.attributes["activitypub.lookup.result"], "not_found");
  assertEquals(counter?.attributes["activitypub.remote.host"], "remote.test");
  assertEquals(counter?.attributes["activitypub.cache.enabled"], true);
  assertEquals(counter?.attributes["http.response.status_code"], 404);

  const duration = recorder.getMeasurement(
    "activitypub.document.fetch.duration",
  );
  assertEquals(duration?.type, "histogram");
  assertEquals(duration?.value, 123);
  assertEquals(duration?.attributes["activitypub.lookup.kind"], "object");
  assertEquals(duration?.attributes["activitypub.lookup.result"], "not_found");
});

test("recordDocumentFetch() omits optional attributes when not provided", () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  recordDocumentFetch(meterProvider, {
    durationMs: 5,
    kind: "context",
    result: "fetched",
  });

  const counter = recorder.getMeasurement("activitypub.document.fetch");
  assertEquals(counter?.attributes["activitypub.lookup.kind"], "context");
  assertEquals(counter?.attributes["activitypub.lookup.result"], "fetched");
  assertEquals("activitypub.remote.host" in counter!.attributes, false);
  assertEquals("activitypub.cache.enabled" in counter!.attributes, false);
  assertEquals("http.response.status_code" in counter!.attributes, false);

  const duration = recorder.getMeasurement(
    "activitypub.document.fetch.duration",
  );
  assertEquals(duration?.value, 5);
});

test("recordDocumentCache() records hit and miss as a counter", () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  recordDocumentCache(meterProvider, {
    kind: "object",
    result: "hit",
    remoteUrl: new URL("https://remote.test/objects/1"),
  });
  recordDocumentCache(meterProvider, {
    kind: "context",
    result: "miss",
    remoteUrl: new URL("https://w3id.org/security/v1"),
  });

  const measurements = recorder.getMeasurements("activitypub.document.cache");
  assertEquals(measurements.length, 2);
  for (const m of measurements) {
    assertEquals(m.type, "counter");
    assertEquals(m.value, 1);
  }
  assertEquals(measurements[0].attributes["activitypub.lookup.kind"], "object");
  assertEquals(measurements[0].attributes["activitypub.lookup.result"], "hit");
  assertEquals(
    measurements[0].attributes["activitypub.remote.host"],
    "remote.test",
  );
  assertEquals(
    measurements[1].attributes["activitypub.lookup.kind"],
    "context",
  );
  assertEquals(measurements[1].attributes["activitypub.lookup.result"], "miss");
  assertEquals(
    measurements[1].attributes["activitypub.remote.host"],
    "w3id.org",
  );
});

test("recordWebFingerHandle() records counter and duration with all attributes", () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  recordWebFingerHandle(meterProvider, {
    durationMs: 17,
    result: "resolved",
    scheme: "acct",
    statusCode: 200,
  });

  const counters = recorder.getMeasurements("webfinger.handle");
  assertEquals(counters.length, 1);
  assertEquals(counters[0].type, "counter");
  assertEquals(counters[0].value, 1);
  assertEquals(counters[0].attributes["webfinger.handle.result"], "resolved");
  assertEquals(counters[0].attributes["webfinger.resource.scheme"], "acct");
  assertEquals(counters[0].attributes["http.response.status_code"], 200);

  const durations = recorder.getMeasurements("webfinger.handle.duration");
  assertEquals(durations.length, 1);
  assertEquals(durations[0].type, "histogram");
  assertEquals(durations[0].value, 17);
  assertEquals(durations[0].attributes["webfinger.handle.result"], "resolved");
  assertEquals(durations[0].attributes["webfinger.resource.scheme"], "acct");
  assertEquals(durations[0].attributes["http.response.status_code"], 200);
});

test("recordWebFingerHandle() records each non-resolved result with the matching status code", () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  for (
    const [result, statusCode] of [
      ["invalid", 400],
      ["not_found", 404],
      ["tombstoned", 410],
    ] as const
  ) {
    recordWebFingerHandle(meterProvider, {
      durationMs: 1,
      result,
      scheme: "acct",
      statusCode,
    });
  }
  const counters = recorder.getMeasurements("webfinger.handle");
  assertEquals(counters.length, 3);
  assertEquals(
    counters.map((m) => m.attributes["webfinger.handle.result"]),
    ["invalid", "not_found", "tombstoned"],
  );
  assertEquals(
    counters.map((m) => m.attributes["http.response.status_code"]),
    [400, 404, 410],
  );
});

test("recordWebFingerHandle() omits optional attributes when not provided", () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  recordWebFingerHandle(meterProvider, {
    durationMs: 0,
    result: "error",
  });
  const counter = recorder.getMeasurement("webfinger.handle");
  assertEquals(counter?.attributes["webfinger.handle.result"], "error");
  assertEquals(
    "webfinger.resource.scheme" in (counter?.attributes ?? {}),
    false,
  );
  assertEquals(
    "http.response.status_code" in (counter?.attributes ?? {}),
    false,
  );
});

test("recordCollectionRequest() records counter with bounded attributes", () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  recordCollectionRequest(meterProvider, {
    kind: "followers",
    page: true,
    dispatcher: "built_in",
    result: "served",
    statusCode: 200,
  });

  const counter = recorder.getMeasurement("activitypub.collection.request");
  assertEquals(counter?.type, "counter");
  assertEquals(counter?.value, 1);
  assertEquals(counter?.attributes["activitypub.collection.kind"], "followers");
  assertEquals(counter?.attributes["activitypub.collection.page"], true);
  assertEquals(counter?.attributes["fedify.collection.dispatcher"], "built_in");
  assertEquals(counter?.attributes["activitypub.collection.result"], "served");
  assertEquals(counter?.attributes["http.response.status_code"], 200);
});

test("recordCollectionRequest() omits status code when unavailable", () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  recordCollectionRequest(meterProvider, {
    kind: "custom",
    page: false,
    dispatcher: "custom",
    result: "error",
  });

  const counter = recorder.getMeasurement("activitypub.collection.request");
  assertEquals(counter?.attributes["activitypub.collection.kind"], "custom");
  assertEquals(counter?.attributes["activitypub.collection.page"], false);
  assertEquals(counter?.attributes["fedify.collection.dispatcher"], "custom");
  assertEquals(counter?.attributes["activitypub.collection.result"], "error");
  assertEquals(
    "http.response.status_code" in (counter?.attributes ?? {}),
    false,
  );
});

test("recordCollectionDispatchDuration() records histogram", () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  recordCollectionDispatchDuration(meterProvider, 12, {
    kind: "outbox",
    page: false,
    dispatcher: "built_in",
    result: "served",
  });

  const duration = recorder.getMeasurement(
    "activitypub.collection.dispatch.duration",
  );
  assertEquals(duration?.type, "histogram");
  assertEquals(duration?.value, 12);
  assertEquals(duration?.attributes["activitypub.collection.kind"], "outbox");
  assertEquals(duration?.attributes["activitypub.collection.page"], false);
  assertEquals(
    duration?.attributes["fedify.collection.dispatcher"],
    "built_in",
  );
  assertEquals(duration?.attributes["activitypub.collection.result"], "served");
});

test("recordCollectionPageItems() records item count histogram", () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  recordCollectionPageItems(meterProvider, 3, {
    kind: "featured_tags",
    page: true,
    dispatcher: "built_in",
    result: "served",
    statusCode: 200,
  });

  const items = recorder.getMeasurement("activitypub.collection.page.items");
  assertEquals(items?.type, "histogram");
  assertEquals(items?.value, 3);
  assertEquals(
    items?.attributes["activitypub.collection.kind"],
    "featured_tags",
  );
  assertEquals(items?.attributes["activitypub.collection.page"], true);
  assertEquals(items?.attributes["http.response.status_code"], 200);
});

test("recordCollectionTotalItems() records total item histogram", () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  recordCollectionTotalItems(meterProvider, 42, {
    kind: "liked",
    page: false,
    dispatcher: "built_in",
    result: "served",
  });

  const total = recorder.getMeasurement("activitypub.collection.total_items");
  assertEquals(total?.type, "histogram");
  assertEquals(total?.value, 42);
  assertEquals(total?.attributes["activitypub.collection.kind"], "liked");
  assertEquals(total?.attributes["activitypub.collection.page"], false);
});

test("classifyFetchError() classifies FetchError with 404 as not_found", () => {
  const response = new Response("", { status: 404 });
  const error = new FetchError(
    "https://example.com/k",
    "not found",
    response,
  );
  assertEquals(classifyFetchError(error), {
    result: "not_found",
    statusCode: 404,
  });
});

test("classifyFetchError() classifies FetchError with 410 as not_found", () => {
  const response = new Response("", { status: 410 });
  const error = new FetchError(
    "https://example.com/k",
    "gone",
    response,
  );
  assertEquals(classifyFetchError(error), {
    result: "not_found",
    statusCode: 410,
  });
});

test("classifyFetchError() classifies FetchError with 500 as error", () => {
  const response = new Response("", { status: 500 });
  const error = new FetchError(
    "https://example.com/k",
    "server error",
    response,
  );
  assertEquals(classifyFetchError(error), {
    result: "error",
    statusCode: 500,
  });
});

test("classifyFetchError() classifies FetchError without response as network_error", () => {
  const error = new FetchError("https://example.com/k", "boom");
  assertEquals(classifyFetchError(error), { result: "network_error" });
});

test("classifyFetchError() classifies a bare TypeError as network_error", () => {
  assertEquals(classifyFetchError(new TypeError("connect failed")), {
    result: "network_error",
  });
});

test("classifyFetchError() classifies an AbortError as network_error", () => {
  const abort = new Error("aborted");
  abort.name = "AbortError";
  assertEquals(classifyFetchError(abort), { result: "network_error" });
});

test("classifyFetchError() classifies any other thrown value as error", () => {
  assertEquals(classifyFetchError(new Error("nope")), { result: "error" });
  assertEquals(classifyFetchError("string error"), { result: "error" });
  assertEquals(classifyFetchError(undefined), { result: "error" });
});

test("instrumentDocumentLoader() records fetched on success", async () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  const inner: DocumentLoader = (url) =>
    Promise.resolve(
      {
        contextUrl: null,
        documentUrl: url,
        document: { ok: true },
      } satisfies RemoteDocument,
    );
  const wrapped = instrumentDocumentLoader(inner, {
    meterProvider,
    kind: "object",
    cacheEnabled: true,
  });

  const result = await wrapped("https://example.com/o");
  assertEquals(result.document, { ok: true });

  const counter = recorder.getMeasurement("activitypub.document.fetch");
  assertEquals(counter?.attributes["activitypub.lookup.kind"], "object");
  assertEquals(counter?.attributes["activitypub.lookup.result"], "fetched");
  assertEquals(counter?.attributes["activitypub.remote.host"], "example.com");
  assertEquals(counter?.attributes["activitypub.cache.enabled"], true);
  assertEquals("http.response.status_code" in counter!.attributes, false);

  const duration = recorder.getMeasurement(
    "activitypub.document.fetch.duration",
  );
  assertEquals(duration?.type, "histogram");
  assertEquals(duration?.attributes["activitypub.lookup.result"], "fetched");
});

test("instrumentDocumentLoader() records not_found on FetchError 404", async () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  const inner: DocumentLoader = (url) =>
    Promise.reject(
      new FetchError(
        url,
        "HTTP 404",
        new Response("", { status: 404 }),
      ),
    );
  const wrapped = instrumentDocumentLoader(inner, {
    meterProvider,
    kind: "context",
    cacheEnabled: false,
  });

  await assertRejects(
    () => wrapped("https://example.com/missing"),
    FetchError,
  );

  const counter = recorder.getMeasurement("activitypub.document.fetch");
  assertEquals(counter?.attributes["activitypub.lookup.kind"], "context");
  assertEquals(counter?.attributes["activitypub.lookup.result"], "not_found");
  assertEquals(counter?.attributes["activitypub.remote.host"], "example.com");
  assertEquals(counter?.attributes["activitypub.cache.enabled"], false);
  assertEquals(counter?.attributes["http.response.status_code"], 404);
});

test("instrumentDocumentLoader() records network_error on TypeError", async () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  const inner: DocumentLoader = () =>
    Promise.reject(new TypeError("fetch failed"));
  const wrapped = instrumentDocumentLoader(inner, {
    meterProvider,
    kind: "object",
  });

  await assertRejects(
    () => wrapped("https://example.com/o"),
    TypeError,
  );

  const counter = recorder.getMeasurement("activitypub.document.fetch");
  assertEquals(
    counter?.attributes["activitypub.lookup.result"],
    "network_error",
  );
  assertEquals("activitypub.cache.enabled" in counter!.attributes, false);
});

test("instrumentDocumentLoader() returns inner loader unchanged when meterProvider is omitted", async () => {
  const [, recorder] = createTestMeterProvider();
  let callCount = 0;
  const inner: DocumentLoader = (url) => {
    callCount++;
    return Promise.resolve(
      {
        contextUrl: null,
        documentUrl: url,
        document: { ok: true },
      } satisfies RemoteDocument,
    );
  };
  const wrapped = instrumentDocumentLoader(inner, { kind: "object" });

  // No-instrumentation short-circuit returns the original function reference.
  assertEquals(wrapped, inner);

  await wrapped("https://example.com/o");
  assertEquals(callCount, 1);
  assertEquals(
    recorder.getMeasurements("activitypub.document.fetch").length,
    0,
  );
  assertEquals(
    recorder.getMeasurements("activitypub.document.fetch.duration").length,
    0,
  );
});

test("instrumentDocumentLoader() omits remote.host when URL is unparseable", async () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  const inner: DocumentLoader = (url) =>
    Promise.resolve(
      {
        contextUrl: null,
        documentUrl: url,
        document: {},
      } satisfies RemoteDocument,
    );
  const wrapped = instrumentDocumentLoader(inner, {
    meterProvider,
    kind: "other",
  });

  await wrapped("not a url");

  const counter = recorder.getMeasurement("activitypub.document.fetch");
  assertEquals(counter?.attributes["activitypub.lookup.kind"], "other");
  assertEquals(counter?.attributes["activitypub.lookup.result"], "fetched");
  assertEquals("activitypub.remote.host" in counter!.attributes, false);
});
