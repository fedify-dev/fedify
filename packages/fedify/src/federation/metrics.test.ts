import { createTestMeterProvider, test } from "@fedify/fixture";
import { assertEquals } from "@std/assert";
import { FetchError } from "@fedify/vocab-runtime";
import type { MessageQueue } from "./mq.ts";
import {
  classifyFetchError,
  recordDocumentCache,
  recordDocumentFetch,
  recordFanoutRecipients,
  recordInboxActivity,
  recordKeyLookup,
  recordOutboxActivity,
  recordOutboxEnqueue,
} from "./metrics.ts";

const noopQueue: MessageQueue = {
  enqueue() {
    return Promise.resolve();
  },
  listen() {
    return Promise.resolve();
  },
};

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
