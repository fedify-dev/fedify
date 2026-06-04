import { type Schema, Validator } from "@cfworker/json-schema";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { BenchReport } from "../result/model.ts";
import { reportSchemaV1 } from "../result/schema.ts";
import { renderReport } from "./index.ts";

const report = JSON.parse(
  readFileSync(
    join(
      import.meta.dirname!,
      "..",
      "__fixtures__",
      "reports",
      "inbox-report.json",
    ),
    "utf-8",
  ),
) as BenchReport;

test("renderReport json - valid JSON that validates against the schema", () => {
  const json = renderReport(report, "json");
  const parsed = JSON.parse(json);
  const validator = new Validator(
    reportSchemaV1 as unknown as Schema,
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

test("renderReport markdown - includes tables and the gate result", () => {
  const md = renderReport(report, "markdown");
  assert.match(md, /# Fedify benchmark report/);
  assert.match(md, /✅ PASS/);
  assert.match(md, /\| Latency p95 \| 91ms \|/);
  assert.match(md, /signature_failed/);
});
