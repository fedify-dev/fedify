import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { BenchCompareCommand } from "./command.ts";
import {
  buildCompareReport,
  parseRegressionTolerance,
  runBenchCompare,
  startBenchmarkTarget,
  stopTargetProcess,
  waitReadyUrl,
} from "./compare.ts";
import type { BenchReport, ScenarioResult } from "./result/model.ts";

type FakeChildProcess = ChildProcess & {
  readonly stdout: EventEmitter;
  readonly stderr: EventEmitter;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  kill(signal?: NodeJS.Signals | number): boolean;
};

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

function fakeChildProcess(pid = 1234): FakeChildProcess {
  const child = new EventEmitter() as FakeChildProcess;
  Object.defineProperties(child, {
    pid: { value: pid, configurable: true },
    stdout: { value: new EventEmitter(), configurable: true },
    stderr: { value: new EventEmitter(), configurable: true },
    exitCode: { value: null, configurable: true },
    signalCode: { value: null, configurable: true },
  });
  child.kill = (signal?: NodeJS.Signals | number) => {
    child.emit("exit", null, signal);
    return true;
  };
  return child;
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

test("buildCompareReport - matches duplicate scenario names by position", () => {
  const base = report([
    scenario({
      name: "duplicate",
      client: {
        latencyMs: { p50: 100, p95: 200, p99: 210, mean: 120, max: 220 },
      },
      runs: [
        runResult(200, 100),
        runResult(200, 100),
        runResult(200, 100),
      ],
    }),
    scenario({
      name: "duplicate",
      client: {
        latencyMs: { p50: 50, p95: 100, p99: 110, mean: 60, max: 120 },
      },
      runs: [
        runResult(100, 100),
        runResult(100, 100),
        runResult(100, 100),
      ],
    }),
  ]);
  const head = report([
    scenario({
      name: "duplicate",
      client: {
        latencyMs: { p50: 115, p95: 230, p99: 240, mean: 130, max: 250 },
      },
      runs: [
        runResult(230, 100),
        runResult(230, 100),
        runResult(230, 100),
      ],
    }),
    scenario({
      name: "duplicate",
      client: {
        latencyMs: { p50: 55, p95: 110, p99: 120, mean: 70, max: 130 },
      },
      runs: [
        runResult(110, 100),
        runResult(110, 100),
        runResult(110, 100),
      ],
    }),
  ]);
  const compare = buildCompareReport({
    baseRef: "origin/main",
    headRef: "HEAD",
    baseReport: base,
    headReport: head,
    maxRegression: 0.2,
    startedAt: "2026-06-13T00:00:00.000Z",
    finishedAt: "2026-06-13T00:00:01.000Z",
  });
  assert.deepEqual(compare.comparisons.map((c) => c.base), [200, 100]);
  assert.deepEqual(compare.comparisons.map((c) => c.head), [230, 110]);
  assert.ok(compare.comparisons.every((c) => c.pass));
  assert.strictEqual(compare.passed, true);
});

test("buildCompareReport - keeps zero-median noise finite", () => {
  const base = report([
    scenario({
      client: {
        latencyMs: { p50: 0, p95: 100, p99: 100, mean: 50, max: 100 },
      },
      runs: [
        runResult(0, 100),
        runResult(0, 100),
        runResult(100, 100),
      ],
    }),
  ]);
  const head = report([
    scenario({
      client: {
        latencyMs: { p50: 0, p95: 120, p99: 120, mean: 60, max: 120 },
      },
      runs: [
        runResult(0, 100),
        runResult(0, 100),
        runResult(120, 100),
      ],
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
  const latency = compare.comparisons.find((c) => c.metric === "latency.p95");
  assert.ok(latency);
  assert.strictEqual(latency.noiseBand, 0);
  assert.strictEqual(latency.allowedRegression, 0.1);
  assert.strictEqual(latency.pass, false);
  assert.strictEqual(
    JSON.parse(JSON.stringify(compare)).comparisons[0].noiseBand,
    0,
  );
});

test("startBenchmarkTarget - keeps target stdout off stdout", async () => {
  let options: SpawnOptions | undefined;
  const child = fakeChildProcess();
  let stderr = "";
  const target = startBenchmarkTarget("/tmp/base", "pnpm dev", {
    platform: "linux",
    stderr: {
      write: (chunk) => {
        stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : chunk;
        return true;
      },
    },
    spawn: (command, spawnOptions) => {
      assert.strictEqual(command, "pnpm dev");
      options = spawnOptions;
      return child;
    },
  });
  assert.deepEqual(options?.stdio, ["ignore", "pipe", "pipe"]);
  child.stdout.emit("data", Buffer.from("stdout log\n"));
  child.stderr.emit("data", "stderr log\n");
  assert.strictEqual(stderr, "stdout log\nstderr log\n");
  await target.stop();
});

test("stopTargetProcess - kills the Windows process tree", async () => {
  const child = fakeChildProcess(4321);
  const kills: Array<[number, NodeJS.Signals]> = [];
  await stopTargetProcess(child, {
    platform: "win32",
    killWindowsProcessTree: (pid, signal) => {
      kills.push([pid, signal]);
      child.emit("exit", null, signal);
    },
  });
  assert.deepEqual(kills, [[4321, "SIGTERM"]]);
});

test("waitReadyUrl - does not wait for streaming response bodies", async () => {
  let calls = 0;
  await waitReadyUrl(new URL("http://ready.test/health"), 100, {
    fetch: () => {
      calls++;
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1]));
            },
          }),
          { status: 200 },
        ),
      );
    },
  });
  assert.strictEqual(calls, 1);
});

test("waitReadyUrl - aborts a hanging fetch at the timeout", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    waitReadyUrl(new URL("http://ready.test/health"), 20, {
      fetch: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
      sleep: () => Promise.resolve(),
    }),
    /Timed out waiting/,
  );
  assert.ok(Date.now() - startedAt < 1000);
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
