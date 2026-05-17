import { createTestMeterProvider, test } from "@fedify/fixture";
import { assertEquals } from "@std/assert";
import {
  recordFanoutRecipients,
  recordInboxActivity,
  recordOutboxActivity,
} from "./metrics.ts";

test("recordFanoutRecipients() records the recipient count with activity type", () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  recordFanoutRecipients(
    meterProvider,
    "https://www.w3.org/ns/activitystreams#Create",
    7,
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
  recordFanoutRecipients(meterProvider, undefined, 0);
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
