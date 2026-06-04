import assert from "node:assert/strict";
import test from "node:test";
import type { Sample } from "../load/generator.ts";
import { aggregateSamples } from "./aggregate.ts";

function sample(overrides: Partial<Sample>): Sample {
  return {
    scheduledAtMs: 0,
    latencyMs: 10,
    warmup: false,
    outcome: { ok: true, status: 202 },
    ...overrides,
  };
}

test("aggregateSamples - excludes warm-up samples from every figure", () => {
  const samples = [
    sample({ warmup: true, latencyMs: 1000 }),
    sample({ latencyMs: 20 }),
    sample({ latencyMs: 30 }),
  ];
  const m = aggregateSamples(samples, { measuredWindowMs: 1000 });
  assert.strictEqual(m.requests.total, 2);
  assert.ok(m.client.latencyMs.max < 1000);
});

test("aggregateSamples - counts requests and success rate", () => {
  const samples = [
    sample({}),
    sample({}),
    sample({ outcome: { ok: false, status: 500, reason: "handler_error" } }),
  ];
  const m = aggregateSamples(samples, { measuredWindowMs: 1000 });
  assert.deepEqual(m.requests, {
    total: 3,
    ok: 2,
    failed: 1,
    successRate: 2 / 3,
  });
});

test("aggregateSamples - throughput is total over the measured window", () => {
  const samples = Array.from({ length: 50 }, () => sample({}));
  const m = aggregateSamples(samples, { measuredWindowMs: 2000 });
  assert.strictEqual(m.throughputPerSec, 25);
});

test("aggregateSamples - groups errors by kind, status, and reason", () => {
  const samples = [
    sample({ outcome: { ok: false, status: 500, reason: "handler_error" } }),
    sample({ outcome: { ok: false, status: 500, reason: "handler_error" } }),
    sample({ outcome: { ok: false, status: 401, reason: "signature_failed" } }),
    sample({ outcome: { ok: false, errorKind: "exception", reason: "boom" } }),
  ];
  const m = aggregateSamples(samples, { measuredWindowMs: 1000 });
  // Sorted by descending count: the 500 bucket (2) first.
  assert.strictEqual(m.errors[0].count, 2);
  assert.strictEqual(m.errors[0].status, 500);
  assert.strictEqual(m.errors.length, 3);
  const exception = m.errors.find((e) => e.kind === "exception");
  assert.ok(exception != null && exception.status === undefined);
});

test("aggregateSamples - latency percentiles come from the samples", () => {
  const samples = Array.from(
    { length: 100 },
    (_, i) => sample({ latencyMs: i + 1 }),
  );
  const m = aggregateSamples(samples, { measuredWindowMs: 1000 });
  assert.ok(m.client.latencyMs.p50 >= 45 && m.client.latencyMs.p50 <= 55);
  assert.strictEqual(m.client.latencyMs.max, 100);
});

test("aggregateSamples - optionally includes a serialized histogram", () => {
  const m = aggregateSamples([sample({})], {
    measuredWindowMs: 1000,
    includeHistogram: true,
  });
  assert.ok(m.histogram != null);
  assert.strictEqual(m.histogram?.count, 1);

  const without = aggregateSamples([sample({})], { measuredWindowMs: 1000 });
  assert.strictEqual(without.histogram, undefined);
});

test("aggregateSamples - empty input yields a 100% success rate", () => {
  const m = aggregateSamples([], { measuredWindowMs: 1000 });
  assert.strictEqual(m.requests.total, 0);
  assert.strictEqual(m.requests.successRate, 1);
  assert.strictEqual(m.server, null);
});
