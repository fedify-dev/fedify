import assert from "node:assert/strict";
import test from "node:test";
import type { BenchCompareCommand } from "./command.ts";
import {
  buildCompareReport,
  parseRegressionTolerance,
  runBenchCompare,
} from "./compare.ts";
import type { BenchReport, ScenarioResult } from "./result/model.ts";

function scenario(
  overrides: Partial<ScenarioResult> & { name?: string } = {},
): ScenarioResult {
  const base: ScenarioResult = {
    name: "inbox-shared",
    type: "inbox",
    load: {
      model: "closed",
      concurrency: 1,
      durationMs: 100,
      warmupMs: 0,
    },
    requests: { total: 10, ok: 10, failed: 0, successRate: 1 },
    throughputPerSec: 100,
    client: {
      latencyMs: { p50: 50, p95: 100, p99: 110, mean: 60, max: 120 },
    },
    server: null,
    errors: [],
    expectations: [{
      metric: "latency.p95",
      op: "lt",
      threshold: 250,
      unit: "ms",
      actual: 100,
      severity: "fail",
      pass: true,
    }],
    passed: true,
    runCount: 3,
    runs: [
      runResult(90, 100),
      runResult(100, 100),
      runResult(110, 100),
    ],
  };
  return { ...base, ...overrides, name: overrides.name ?? base.name };
}

function runResult(latencyP95: number, throughput: number) {
  return {
    run: 1,
    requests: { total: 10, ok: 10, failed: 0, successRate: 1 },
    throughputPerSec: throughput,
    client: {
      latencyMs: {
        p50: latencyP95 / 2,
        p95: latencyP95,
        p99: latencyP95,
        mean: latencyP95 / 2,
        max: latencyP95,
      },
    },
    server: null,
    errors: [],
  };
}

function report(scenarios: ScenarioResult[]): BenchReport {
  return {
    $schema: "https://json-schema.fedify.dev/bench/report-v3.json",
    schemaVersion: 3,
    tool: { name: "@fedify/cli", version: "2.3.0" },
    environment: {
      runtime: "node",
      runtimeVersion: "22.0.0",
      os: "linux",
      cpuCount: 8,
    },
    target: { url: "http://127.0.0.1:3000", statsAvailable: true },
    startedAt: "2026-06-13T00:00:00.000Z",
    finishedAt: "2026-06-13T00:00:01.000Z",
    suite: { configHash: "sha256:x" },
    passed: scenarios.every((s) => s.passed),
    scenarios,
  };
}

function command(overrides: Partial<BenchCompareCommand>): BenchCompareCommand {
  return {
    command: "bench",
    mode: "compare",
    base: "origin/main",
    head: "HEAD",
    file: "scenario.yaml",
    startCommand: "pnpm dev",
    readyUrl: "http://127.0.0.1:3000/health",
    readyTimeout: "30s",
    maxRegression: "15%",
    target: undefined,
    format: "json",
    output: undefined,
    dryRun: false,
    advertiseHost: undefined,
    allowUnsafeTarget: false,
    userAgent: "Fedify-bench-test/1.0",
    ...overrides,
  };
}

test("parseRegressionTolerance - parses percentages", () => {
  assert.strictEqual(parseRegressionTolerance("15%"), 0.15);
  assert.strictEqual(parseRegressionTolerance("0.2"), 0.2);
});

test("parseRegressionTolerance - rejects malformed values", () => {
  assert.throws(() => parseRegressionTolerance("15ms"), RangeError);
  assert.throws(() => parseRegressionTolerance("-1%"), RangeError);
  assert.throws(() => parseRegressionTolerance(""), RangeError);
});

test("buildCompareReport - applies the measured noise band", () => {
  const base = report([scenario()]);
  const head = report([
    scenario({
      client: {
        latencyMs: { p50: 50, p95: 114, p99: 120, mean: 60, max: 130 },
      },
      runs: [runResult(113, 100), runResult(114, 100), runResult(115, 100)],
    }),
  ]);
  const compare = buildCompareReport({
    baseRef: "origin/main",
    headRef: "HEAD",
    baseReport: base,
    headReport: head,
    maxRegression: 0.05,
    startedAt: "2026-06-13T00:00:00.000Z",
    finishedAt: "2026-06-13T00:00:01.000Z",
  });
  assert.strictEqual(compare.comparisons.length, 1);
  assert.strictEqual(compare.comparisons[0].metric, "latency.p95");
  assert.ok(compare.comparisons[0].pass);
  assert.strictEqual(compare.passed, true);
});

test("buildCompareReport - fails regressions outside tolerance and noise", () => {
  const base = report([
    scenario({
      expectations: [],
      runs: [runResult(100, 100), runResult(100, 100), runResult(100, 100)],
    }),
  ]);
  const head = report([
    scenario({
      expectations: [],
      throughputPerSec: 80,
      runs: [runResult(100, 80), runResult(100, 80), runResult(100, 80)],
    }),
  ]);
  const compare = buildCompareReport({
    baseRef: "origin/main",
    headRef: "HEAD",
    baseReport: base,
    headReport: head,
    maxRegression: 0.1,
    startedAt: "2026-06-13T00:00:00.000Z",
    finishedAt: "2026-06-13T00:00:01.000Z",
  });
  const throughput = compare.comparisons.find((c) =>
    c.metric === "throughputPerSec"
  );
  assert.ok(throughput);
  assert.strictEqual(throughput.pass, false);
  assert.strictEqual(compare.passed, false);
});

test("runBenchCompare - orchestrates worktrees and cleans up", async () => {
  const events: string[] = [];
  let code = -1;
  let output = "";
  await runBenchCompare(command({ maxRegression: "10%" }), {
    exit: (c) => {
      code = c;
    },
    writeOutput: (content) => {
      output = content;
      return Promise.resolve();
    },
    log: (message) => events.push(`log:${message}`),
    createWorktree: (ref, label) => {
      events.push(`worktree:${label}:${ref}`);
      return Promise.resolve(`/tmp/${label}`);
    },
    removeWorktree: (path) => {
      events.push(`remove:${path}`);
      return Promise.resolve();
    },
    startTarget: (cwd, startCommand) => {
      events.push(`start:${cwd}:${startCommand}`);
      return Promise.resolve({
        stop: () => {
          events.push(`stop:${cwd}`);
          return Promise.resolve();
        },
      });
    },
    waitReady: (url, timeoutMs) => {
      events.push(`ready:${url.href}:${timeoutMs}`);
      return Promise.resolve();
    },
    runBenchInWorktree: ({ cwd, target }) => {
      events.push(`bench:${cwd}:${target}`);
      return Promise.resolve(report([scenario()]));
    },
  });
  assert.strictEqual(code, 0);
  assert.strictEqual(JSON.parse(output).passed, true);
  assert.deepEqual(events, [
    "log:Checking out base benchmark ref origin/main…",
    "worktree:base:origin/main",
    "start:/tmp/base:pnpm dev",
    "ready:http://127.0.0.1:3000/health:30000",
    "bench:/tmp/base:http://127.0.0.1:3000",
    "stop:/tmp/base",
    "log:Checking out head benchmark ref HEAD…",
    "worktree:head:HEAD",
    "start:/tmp/head:pnpm dev",
    "ready:http://127.0.0.1:3000/health:30000",
    "bench:/tmp/head:http://127.0.0.1:3000",
    "stop:/tmp/head",
    "remove:/tmp/head",
    "remove:/tmp/base",
  ]);
});
