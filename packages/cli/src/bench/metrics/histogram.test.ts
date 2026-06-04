import assert from "node:assert/strict";
import test from "node:test";
import { LogLinearHistogram } from "./histogram.ts";

test("LogLinearHistogram - empty histogram", () => {
  const h = new LogLinearHistogram();
  assert.strictEqual(h.count, 0);
  assert.strictEqual(h.min, 0);
  assert.strictEqual(h.max, 0);
  assert.strictEqual(h.mean, 0);
  assert.strictEqual(h.percentile(50), 0);
  assert.strictEqual(h.percentile(99), 0);
});

test("LogLinearHistogram - single value", () => {
  const h = new LogLinearHistogram();
  h.record(42);
  assert.strictEqual(h.count, 1);
  assert.strictEqual(h.min, 42);
  assert.strictEqual(h.max, 42);
  assert.strictEqual(h.mean, 42);
  // p50 and p99 of a single sample are that sample (within bucket error,
  // clamped to [min, max] which are exact here).
  assert.strictEqual(h.percentile(50), 42);
  assert.strictEqual(h.percentile(99), 42);
});

test("LogLinearHistogram - percentiles are monotonic and accurate", () => {
  const h = new LogLinearHistogram();
  for (let v = 1; v <= 1000; v++) h.record(v);
  const p50 = h.percentile(50);
  const p90 = h.percentile(90);
  const p99 = h.percentile(99);
  assert.ok(p50 <= p90, `p50 (${p50}) <= p90 (${p90})`);
  assert.ok(p90 <= p99, `p90 (${p90}) <= p99 (${p99})`);
  // Within 1% relative error of the true percentiles (500/900/990).
  assert.ok(Math.abs(p50 - 500) / 500 < 0.01, `p50 ≈ 500, got ${p50}`);
  assert.ok(Math.abs(p90 - 900) / 900 < 0.01, `p90 ≈ 900, got ${p90}`);
  assert.ok(Math.abs(p99 - 990) / 990 < 0.01, `p99 ≈ 990, got ${p99}`);
});

test("LogLinearHistogram - handles sub-millisecond and large values", () => {
  const h = new LogLinearHistogram();
  for (const v of [0.25, 0.5, 0.75, 1.5, 3, 7.5, 1500, 30000]) h.record(v);
  assert.strictEqual(h.count, 8);
  assert.strictEqual(h.min, 0.25);
  assert.strictEqual(h.max, 30000);
  const p50 = h.percentile(50);
  assert.ok(p50 >= 0.25 && p50 <= 30000);
});

test("LogLinearHistogram - records zero and clamps negatives to zero", () => {
  const h = new LogLinearHistogram();
  h.record(0);
  h.record(-5); // clamped to 0
  h.record(10);
  assert.strictEqual(h.count, 3);
  assert.strictEqual(h.min, 0);
  assert.strictEqual(h.percentile(1), 0);
  assert.strictEqual(h.percentile(50), 0);
  assert.ok(h.percentile(99) >= 9 && h.percentile(99) <= 11);
});

test("LogLinearHistogram - tiny denormal value yields a finite percentile", () => {
  const h = new LogLinearHistogram();
  h.record(Number.MIN_VALUE);
  assert.strictEqual(h.count, 1);
  assert.ok(Number.isFinite(h.percentile(50)));
  assert.ok(Number.isFinite(h.percentile(99)));
});

test("LogLinearHistogram - normalizes -0 to +0", () => {
  const h = new LogLinearHistogram();
  h.record(-0);
  assert.ok(Object.is(h.min, 0));
  assert.ok(Object.is(h.max, 0));
  assert.ok(Object.is(h.toJSON().min, 0));
});

test("LogLinearHistogram - ignores non-finite values", () => {
  const h = new LogLinearHistogram();
  h.record(Number.NaN);
  h.record(Number.POSITIVE_INFINITY);
  h.record(5);
  assert.strictEqual(h.count, 1);
  assert.strictEqual(h.max, 5);
});

test("LogLinearHistogram - merge combines counts and bounds", () => {
  const a = new LogLinearHistogram();
  const b = new LogLinearHistogram();
  for (let v = 1; v <= 500; v++) a.record(v);
  for (let v = 501; v <= 1000; v++) b.record(v);
  a.merge(b);
  assert.strictEqual(a.count, 1000);
  assert.strictEqual(a.min, 1);
  assert.strictEqual(a.max, 1000);
  const p50 = a.percentile(50);
  assert.ok(Math.abs(p50 - 500) / 500 < 0.01, `merged p50 ≈ 500, got ${p50}`);
});

test("LogLinearHistogram - merge rejects mismatched subBucketCount", () => {
  const a = new LogLinearHistogram({ subBucketCount: 64 });
  const b = new LogLinearHistogram({ subBucketCount: 128 });
  assert.throws(() => a.merge(b), TypeError);
});

test("LogLinearHistogram - toJSON/fromJSON round-trip", () => {
  const h = new LogLinearHistogram();
  for (let v = 1; v <= 1000; v++) h.record(v * 0.5);
  const json = JSON.parse(JSON.stringify(h.toJSON()));
  const restored = LogLinearHistogram.fromJSON(json);
  assert.strictEqual(restored.count, h.count);
  assert.strictEqual(restored.min, h.min);
  assert.strictEqual(restored.max, h.max);
  assert.strictEqual(restored.sum, h.sum);
  assert.strictEqual(restored.percentile(50), h.percentile(50));
  assert.strictEqual(restored.percentile(95), h.percentile(95));
});

test("LogLinearHistogram - rejects invalid subBucketCount", () => {
  assert.throws(
    () => new LogLinearHistogram({ subBucketCount: 0 }),
    RangeError,
  );
  assert.throws(
    () => new LogLinearHistogram({ subBucketCount: 1.5 }),
    RangeError,
  );
});
