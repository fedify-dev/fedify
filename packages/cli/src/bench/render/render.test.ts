import { type Schema, Validator } from "@cfworker/json-schema";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { BenchReport } from "../result/model.ts";
import { reportSchemaV2 } from "../result/schema.ts";
import { renderReport } from "./index.ts";

// `import.meta.dirname` needs Node >= 20.11; derive it from the URL instead.
const here = dirname(fileURLToPath(import.meta.url));
const report = JSON.parse(
  readFileSync(
    join(here, "..", "__fixtures__", "reports", "inbox-report.json"),
    "utf-8",
  ),
) as BenchReport;

test("renderReport json - valid JSON that validates against the schema", () => {
  const json = renderReport(report, "json");
  const parsed = JSON.parse(json);
  const validator = new Validator(
    reportSchemaV2 as unknown as Schema,
    "2020-12",
  );
  assert.ok(validator.validate(parsed).valid);
});

test("renderReport text - includes the key facts and gate", () => {
  const text = renderReport(report, "text");
  assert.match(text, /Fedify benchmark report/);
  assert.match(text, /inbox-shared \(inbox\)/);
  assert.match(text, /Client latency \(ms\): p50 24/);
  assert.match(text, /\[PASS\] latency\.p95 < 100ms/);
  assert.match(text, /Overall: PASS/);
});

test("renderReport - shows actuals in the metric's natural unit", () => {
  // A unitless assertion still renders successRate as a percentage.
  const r: BenchReport = {
    ...report,
    scenarios: [{
      ...report.scenarios[0],
      expectations: [{
        metric: "successRate",
        op: "gte",
        threshold: 0.99,
        unit: null,
        actual: 0.994,
        severity: "fail",
        pass: true,
      }],
    }],
  };
  const text = renderReport(r, "text");
  assert.match(text, /successRate >= 99%\s+\(actual 99\.4%\)/);
});

test("renderReport - shows queue depth even without drain latency", () => {
  // The stats reader supplies queue depth but no drain-latency histogram; both
  // the text and Markdown forms must still surface the depth.
  const base = report.scenarios[0];
  const r: BenchReport = {
    ...report,
    scenarios: [{
      ...base,
      server: { ...(base.server ?? {}), queue: { depthMax: 42 } },
    }],
  };
  const text = renderReport(r, "text");
  assert.match(text, /Server queue depth max: 42/);
  const md = renderReport(r, "markdown");
  assert.match(md, /Queue depth max \(server\) \| 42/);
});

test("renderReport - shows delivery throughput when present", () => {
  const base = report.scenarios[0];
  const r: BenchReport = {
    ...report,
    scenarios: [{
      ...base,
      deliveryThroughputPerSec: 123,
    }],
  };
  const json = JSON.parse(renderReport(r, "json"));
  assert.strictEqual(json.scenarios[0].deliveryThroughputPerSec, 123);
  const text = renderReport(r, "text");
  assert.match(text, /Delivery throughput: 123 deliveries\/s/);
  const md = renderReport(r, "markdown");
  assert.match(md, /Delivery throughput \| 123\/s/);
});

test("renderReport - empty drain latency falls back to the depth line", () => {
  // An empty drainMs object carries no percentile, so neither form should print
  // a meaningless drain line; both still surface the depth (here zero).
  const base = report.scenarios[0];
  const r: BenchReport = {
    ...report,
    scenarios: [{
      ...base,
      server: { ...(base.server ?? {}), queue: { drainMs: {}, depthMax: 0 } },
    }],
  };
  const text = renderReport(r, "text");
  assert.doesNotMatch(text, /Server queue drain/);
  assert.match(text, /Server queue depth max: 0/);
  const md = renderReport(r, "markdown");
  assert.doesNotMatch(md, /Queue drain/);
  assert.match(md, /Queue depth max \(server\) \| 0/);
});

test("renderReport markdown - includes tables and the gate result", () => {
  const md = renderReport(report, "markdown");
  assert.match(md, /# Fedify benchmark report/);
  assert.match(md, /✅ PASS/);
  assert.match(md, /\| Latency p95 \| 91ms \|/);
  assert.match(md, /signature_failed/);
});
