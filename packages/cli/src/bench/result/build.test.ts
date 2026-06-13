import { type Schema, Validator } from "@cfworker/json-schema";
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSuite } from "../scenario/normalize.ts";
import {
  buildReport,
  buildScenarioResult,
  configHash,
  detectEnvironment,
  type ScenarioMeasurement,
} from "./build.ts";
import { reportSchemaV3 } from "./schema.ts";

function resolvedInbox() {
  return normalizeSuite({
    version: 1,
    target: "http://localhost:3000",
    defaults: { load: { concurrency: 50 }, duration: "60s", warmup: "10s" },
    scenarios: [{
      name: "inbox-shared",
      type: "inbox",
      recipient: "acct:a@x",
      expect: { successRate: ">= 99%", "latency.p95": "< 100ms" },
    }],
  }).scenarios[0];
}

function measurement(): ScenarioMeasurement {
  return {
    requests: { total: 1000, ok: 994, failed: 6, successRate: 0.994 },
    throughputPerSec: 304,
    client: {
      latencyMs: { p50: 24, p95: 91, p99: 184, mean: 31.2, max: 412 },
    },
    server: {
      signatureVerificationMs: { overall: { p50: 6, p95: 12, p99: 28 } },
    },
    errors: [{ kind: "http", status: 500, reason: "handler_error", count: 1 }],
  };
}

test("buildScenarioResult - summarizes load and evaluates expect", () => {
  const result = buildScenarioResult(resolvedInbox(), measurement());
  assert.deepEqual(result.load, {
    model: "closed",
    concurrency: 50,
    durationMs: 60_000,
    warmupMs: 10_000,
  });
  assert.strictEqual(result.expectations.length, 2);
  assert.ok(result.expectations.every((e) => e.pass));
  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.runCount, 1);
});

test("buildScenarioResult - a run that measured nothing never passes", () => {
  // No requests means every `expect` assertion is vacuously satisfied, but the
  // scenario must still fail rather than report a green gate.
  const result = buildScenarioResult(resolvedInbox(), {
    ...measurement(),
    requests: { total: 0, ok: 0, failed: 0, successRate: 1 },
  });
  assert.strictEqual(result.passed, false);
});

test("buildScenarioResult - preserves delivery throughput", () => {
  const result = buildScenarioResult(resolvedInbox(), {
    ...measurement(),
    deliveryThroughputPerSec: 42,
  });
  assert.strictEqual(result.deliveryThroughputPerSec, 42);
});

test("buildScenarioResult - aggregates repeated runs for CI gates", () => {
  const scenario = normalizeSuite({
    version: 1,
    target: "http://localhost:3000",
    defaults: {
      load: { concurrency: 50 },
      duration: "60s",
      warmup: "10s",
      runs: 3,
    },
    scenarios: [{
      name: "inbox-shared",
      type: "inbox",
      recipient: "acct:a@x",
      expect: {
        successRate: ">= 95%",
        "latency.p95": "< 250ms",
        throughputPerSec: ">= 100/s",
      },
    }],
  }).scenarios[0];
  const result = buildScenarioResult(scenario, [
    {
      ...measurement(),
      requests: { total: 10, ok: 10, failed: 0, successRate: 1 },
      throughputPerSec: 90,
      client: {
        latencyMs: { p50: 10, p95: 100, p99: 110, mean: 20, max: 120 },
      },
    },
    {
      ...measurement(),
      requests: { total: 10, ok: 9, failed: 1, successRate: 0.9 },
      throughputPerSec: 100,
      client: {
        latencyMs: { p50: 20, p95: 200, p99: 210, mean: 30, max: 220 },
      },
    },
    {
      ...measurement(),
      requests: { total: 10, ok: 10, failed: 0, successRate: 1 },
      throughputPerSec: 200,
      client: {
        latencyMs: { p50: 30, p95: 300, p99: 310, mean: 40, max: 320 },
      },
    },
  ]);
  assert.strictEqual(result.runCount, 3);
  assert.strictEqual(result.runs?.length, 3);
  assert.strictEqual(result.client.latencyMs.p95, 200);
  assert.strictEqual(result.throughputPerSec, 100);
  assert.strictEqual(result.requests.successRate, 0.9);
  assert.strictEqual(result.expectations[0].actual, 0.9);
  assert.strictEqual(result.expectations[1].actual, 200);
  assert.strictEqual(result.expectations[2].actual, 100);
  assert.strictEqual(result.passed, false);
});

test("buildReport - gate passes only when all scenarios pass", () => {
  const ok = buildScenarioResult(resolvedInbox(), measurement());
  const bad = buildScenarioResult(resolvedInbox(), {
    ...measurement(),
    requests: { total: 1000, ok: 900, failed: 100, successRate: 0.9 },
  });
  const report = buildReport({
    scenarios: [ok, bad],
    environment: detectEnvironment(),
    target: { url: "http://localhost:3000", statsAvailable: true },
    startedAt: "2026-06-04T12:00:00.000Z",
    finishedAt: "2026-06-04T12:01:00.000Z",
    suite: { configHash: configHash({ a: 1 }) },
  });
  assert.strictEqual(report.passed, false);
});

test("buildReport - output validates against the report schema", () => {
  const report = buildReport({
    scenarios: [buildScenarioResult(resolvedInbox(), measurement())],
    environment: detectEnvironment(),
    target: {
      url: "http://localhost:3000",
      fedifyVersion: "2.3.0",
      statsAvailable: true,
    },
    startedAt: "2026-06-04T12:00:00.000Z",
    finishedAt: "2026-06-04T12:01:00.000Z",
    suite: { name: "suite", configHash: configHash({ a: 1 }) },
  });
  const validator = new Validator(
    reportSchemaV3 as unknown as Schema,
    "2020-12",
  );
  const result = validator.validate(JSON.parse(JSON.stringify(report)));
  assert.ok(result.valid, JSON.stringify(result.errors));
});

test("configHash - stable across key order, sensitive to values", () => {
  assert.strictEqual(configHash({ a: 1, b: 2 }), configHash({ b: 2, a: 1 }));
  assert.notStrictEqual(configHash({ a: 1 }), configHash({ a: 2 }));
  assert.match(configHash({ a: 1 }), /^sha256:[0-9a-f]{64}$/);
});

test("configHash - distinguishes arrays with undefined holes", () => {
  // [undefined] must not collapse to [].
  assert.notStrictEqual(configHash([undefined]), configHash([]));
  assert.notStrictEqual(configHash([1, undefined, 2]), configHash([1, 2]));
});

test("configHash - hashes URL/Date by serialized form (toJSON)", () => {
  // A config carrying a URL target must not collapse to {} (same hash).
  assert.notStrictEqual(
    configHash({ target: new URL("http://a.example/") }),
    configHash({ target: new URL("http://b.example/") }),
  );
  assert.strictEqual(
    configHash({ target: new URL("http://a.example/") }),
    configHash({ target: "http://a.example/" }),
  );
});

test("detectEnvironment - reports runtime, os, and cpu count", () => {
  const env = detectEnvironment();
  assert.ok(["node", "deno", "bun"].includes(env.runtime));
  assert.ok(env.os.length > 0);
  assert.ok(env.cpuCount >= 0);
});

test("configHash - rejects pathologically deep config", () => {
  let deep: unknown = 1;
  for (let i = 0; i < 200; i++) deep = { n: deep };
  assert.throws(() => configHash(deep), RangeError);
});
