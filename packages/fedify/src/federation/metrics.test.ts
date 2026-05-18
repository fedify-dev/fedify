import { createTestMeterProvider, test } from "@fedify/fixture";
import { assertEquals } from "@std/assert";
import type { MessageQueue } from "./mq.ts";
import {
  recordFanoutRecipients,
  recordInboxActivity,
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
