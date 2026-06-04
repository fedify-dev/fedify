import assert from "node:assert/strict";
import test from "node:test";
import { evaluateExpect, type MetricView } from "./evaluate.ts";

function metrics(overrides: Partial<MetricView> = {}): MetricView {
  return {
    requests: { total: 1000, ok: 994, failed: 6, successRate: 0.994 },
    throughputPerSec: 304,
    client: {
      latencyMs: { p50: 24, p95: 91, p99: 184, mean: 31.2, max: 412 },
    },
    server: {
      signatureVerificationMs: { overall: { p50: 6, p95: 12, p99: 28 } },
    },
    errors: [
      { kind: "http", status: 401, reason: "signature_failed", count: 5 },
      { kind: "http", status: 500, reason: "handler_error", count: 1 },
    ],
    ...overrides,
  };
}

test("evaluateExpect - passes when all fail-severity assertions hold", () => {
  const { results, passed } = evaluateExpect(
    { successRate: ">= 99%", "latency.p95": "< 100ms" },
    metrics(),
  );
  assert.strictEqual(passed, true);
  assert.strictEqual(results.length, 2);
  assert.ok(results.every((r) => r.pass));
});

test("evaluateExpect - fails when a fail-severity assertion is violated", () => {
  const { results, passed } = evaluateExpect(
    { "errors.5xx": "== 0" },
    metrics(),
  );
  assert.strictEqual(passed, false);
  assert.strictEqual(results[0].actual, 1);
  assert.strictEqual(results[0].pass, false);
});

test("evaluateExpect - warn severity does not fail the gate", () => {
  const { passed, results } = evaluateExpect(
    { "latency.p95": { assert: "< 50ms", severity: "warn" } },
    metrics(),
  );
  assert.strictEqual(results[0].pass, false);
  assert.strictEqual(results[0].severity, "warn");
  assert.strictEqual(passed, true);
});

test("evaluateExpect - buckets 4xx and 5xx errors", () => {
  const { results } = evaluateExpect(
    { "errors.4xx": "<= 10", "errors.5xx": "== 0", "errors.total": ">= 0" },
    metrics(),
  );
  assert.strictEqual(results[0].actual, 5); // 4xx
  assert.strictEqual(results[1].actual, 1); // 5xx
  assert.strictEqual(results[2].actual, 6); // total
});

test("evaluateExpect - reads server signature-verification metrics", () => {
  const { results, passed } = evaluateExpect(
    { "signatureVerification.p95": "< 20ms" },
    metrics(),
  );
  assert.strictEqual(results[0].actual, 12);
  assert.strictEqual(passed, true);
});

test("evaluateExpect - missing server metric fails (actual null)", () => {
  const { results, passed } = evaluateExpect(
    { "signatureVerification.p95": "< 20ms" },
    metrics({ server: null }),
  );
  assert.strictEqual(results[0].actual, null);
  assert.strictEqual(results[0].pass, false);
  assert.strictEqual(passed, false);
});

test("evaluateExpect - unmeasured metric yields null actual and fails", () => {
  const { results } = evaluateExpect(
    { deliveryThroughput: ">= 1/s" },
    metrics(),
  );
  assert.strictEqual(results[0].actual, null);
  assert.strictEqual(results[0].pass, false);
});

test("evaluateExpect - tolerant equality matches float-normalized ratios", () => {
  const { passed } = evaluateExpect(
    { successRate: "== 99.4%" },
    metrics(),
  );
  assert.strictEqual(passed, true);
});

test("evaluateExpect - count equality is exact (no tolerance)", () => {
  const errors = [{
    kind: "http",
    status: 500,
    reason: "x",
    count: 1_000_000_001,
  }];
  const exact = evaluateExpect(
    { "errors.5xx": "== 1000000000" },
    metrics({ errors }),
  );
  assert.strictEqual(exact.results[0].pass, false);
});

test("evaluateExpect - incompatible assertion unit fails", () => {
  // A percentage threshold against a millisecond metric is nonsense; even
  // though 91 > 0.01 would hold numerically, the unit mismatch fails it.
  const { results } = evaluateExpect(
    { "latency.p95": "> 1%" },
    metrics(),
  );
  assert.strictEqual(results[0].pass, false);
});
