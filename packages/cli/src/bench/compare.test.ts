import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { BenchCompareCommand } from "./command.ts";
import {
  buildCompareReport,
  createBenchmarkWorktree,
  parseRegressionTolerance,
  runBenchCompare,
  startBenchmarkTarget,
  stopTargetProcess,
  waitReadyUrl,
  windowsTaskkillArgs,
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

async function writeSuite(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fedify-bench-compare-"));
  const path = join(dir, "suite.yaml");
  await writeFile(path, content, { encoding: "utf-8" });
  return path;
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
  assert.strictEqual(parseRegressionTolerance("1"), 1);
});

test("parseRegressionTolerance - rejects malformed values", () => {
  assert.throws(() => parseRegressionTolerance("15ms"), RangeError);
  assert.throws(() => parseRegressionTolerance("-1%"), RangeError);
  assert.throws(() => parseRegressionTolerance(""), RangeError);
});

test("parseRegressionTolerance - rejects ambiguous whole-number ratios", () => {
  assert.throws(() => parseRegressionTolerance("15"), RangeError);
  assert.throws(() => parseRegressionTolerance("1.01"), RangeError);
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

test("buildCompareReport - treats positive throughput after zero as passing", () => {
  const throughputExpectation = (actual: number) =>
    ({
      metric: "throughputPerSec",
      op: "gte",
      threshold: 0,
      unit: "/s",
      actual,
      severity: "fail",
      pass: true,
    }) as const;
  const base = report([
    scenario({
      throughputPerSec: 0,
      expectations: [throughputExpectation(0)],
      runs: [runResult(100, 0), runResult(100, 0), runResult(100, 0)],
    }),
  ]);
  const head = report([
    scenario({
      throughputPerSec: 10,
      expectations: [throughputExpectation(10)],
      runs: [runResult(100, 10), runResult(100, 10), runResult(100, 10)],
    }),
  ]);
  const compare = buildCompareReport({
    baseRef: "origin/main",
    headRef: "HEAD",
    baseReport: base,
    headReport: head,
    maxRegression: 0,
    startedAt: "2026-06-13T00:00:00.000Z",
    finishedAt: "2026-06-13T00:00:01.000Z",
  });
  assert.strictEqual(compare.comparisons.length, 1);
  assert.strictEqual(compare.comparisons[0].metric, "throughputPerSec");
  assert.strictEqual(compare.comparisons[0].regression, 0);
  assert.strictEqual(compare.comparisons[0].pass, true);
  assert.strictEqual(compare.passed, true);
});

test("buildCompareReport - tolerates tiny latency after zero baseline", () => {
  const latencyExpectation = (actual: number) =>
    ({
      metric: "latency.p95",
      op: "lt",
      threshold: 10,
      unit: "ms",
      actual,
      severity: "fail",
      pass: true,
    }) as const;
  const base = report([
    scenario({
      client: {
        latencyMs: { p50: 0, p95: 0, p99: 0, mean: 0, max: 0 },
      },
      expectations: [latencyExpectation(0)],
      runs: [runResult(0, 100), runResult(0, 100), runResult(0, 100)],
    }),
  ]);
  const head = report([
    scenario({
      client: {
        latencyMs: { p50: 1, p95: 1, p99: 1, mean: 1, max: 1 },
      },
      expectations: [latencyExpectation(1)],
      runs: [runResult(1, 100), runResult(1, 100), runResult(1, 100)],
    }),
  ]);
  const compare = buildCompareReport({
    baseRef: "origin/main",
    headRef: "HEAD",
    baseReport: base,
    headReport: head,
    maxRegression: 0,
    startedAt: "2026-06-13T00:00:00.000Z",
    finishedAt: "2026-06-13T00:00:01.000Z",
  });
  assert.strictEqual(compare.comparisons.length, 1);
  assert.strictEqual(compare.comparisons[0].metric, "latency.p95");
  assert.strictEqual(compare.comparisons[0].regression, 0);
  assert.strictEqual(compare.comparisons[0].pass, true);
  assert.strictEqual(compare.passed, true);
});

test("buildCompareReport - passes new head scenarios without a baseline", () => {
  const base = report([scenario({ name: "existing" })]);
  const head = report([
    scenario({ name: "existing" }),
    scenario({ name: "new-scenario" }),
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
  const newScenario = compare.comparisons.find((comparison) =>
    comparison.scenario === "new-scenario"
  );
  assert.ok(newScenario);
  assert.strictEqual(newScenario.metric, "scenario");
  assert.strictEqual(newScenario.base, null);
  assert.strictEqual(newScenario.head, null);
  assert.strictEqual(newScenario.pass, true);
  assert.strictEqual(compare.passed, true);
});

test("buildCompareReport - matches duplicate scenario names by occurrence", () => {
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

test("buildCompareReport - matches reordered scenarios by name and type", () => {
  const base = report([
    scenario({
      name: "first",
      client: {
        latencyMs: { p50: 50, p95: 100, p99: 110, mean: 60, max: 120 },
      },
      runs: [
        runResult(100, 100),
        runResult(100, 100),
        runResult(100, 100),
      ],
    }),
    scenario({
      name: "second",
      client: {
        latencyMs: { p50: 100, p95: 200, p99: 210, mean: 120, max: 220 },
      },
      runs: [
        runResult(200, 100),
        runResult(200, 100),
        runResult(200, 100),
      ],
    }),
  ]);
  const head = report([
    scenario({
      name: "second",
      client: {
        latencyMs: { p50: 105, p95: 210, p99: 220, mean: 130, max: 230 },
      },
      runs: [
        runResult(210, 100),
        runResult(210, 100),
        runResult(210, 100),
      ],
    }),
    scenario({
      name: "first",
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
  assert.deepEqual(compare.comparisons.map((c) => c.head), [210, 110]);
  assert.ok(compare.comparisons.every((c) => c.pass));
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

test("buildCompareReport - missing client metrics fail comparisons", () => {
  const malformed = scenario() as unknown as Record<string, unknown>;
  delete malformed.client;
  const compare = buildCompareReport({
    baseRef: "origin/main",
    headRef: "HEAD",
    baseReport: report([scenario()]),
    headReport: report([malformed as unknown as ScenarioResult]),
    maxRegression: 0.1,
    startedAt: "2026-06-13T00:00:00.000Z",
    finishedAt: "2026-06-13T00:00:01.000Z",
  });
  assert.strictEqual(compare.comparisons[0].head, null);
  assert.strictEqual(compare.comparisons[0].pass, false);
  assert.strictEqual(compare.passed, false);
});

test("buildCompareReport - missing baseline metrics pass comparisons", () => {
  const signatureExpectation = (actual: number) =>
    ({
      metric: "signatureVerification.p95",
      op: "lt",
      threshold: 20,
      unit: "ms",
      actual,
      severity: "fail",
      pass: true,
    }) as const;
  const compare = buildCompareReport({
    baseRef: "origin/main",
    headRef: "HEAD",
    baseReport: report([scenario({ server: null })]),
    headReport: report([
      scenario({
        expectations: [signatureExpectation(12)],
        server: {
          signatureVerificationMs: {
            overall: { p50: 6, p95: 12, p99: 28 },
          },
        },
      }),
    ]),
    maxRegression: 0.1,
    startedAt: "2026-06-13T00:00:00.000Z",
    finishedAt: "2026-06-13T00:00:01.000Z",
  });
  assert.strictEqual(compare.comparisons[0].base, null);
  assert.strictEqual(compare.comparisons[0].head, 12);
  assert.strictEqual(compare.comparisons[0].pass, true);
  assert.strictEqual(compare.passed, true);
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

test("windowsTaskkillArgs - only force kills on SIGKILL", () => {
  assert.deepEqual(windowsTaskkillArgs(4321, "SIGTERM"), [
    "/pid",
    "4321",
    "/T",
  ]);
  assert.deepEqual(windowsTaskkillArgs(4321, "SIGKILL"), [
    "/pid",
    "4321",
    "/T",
    "/F",
  ]);
});

test("stopTargetProcess - rejects when forced kill does not exit", async () => {
  const child = fakeChildProcess(4321);
  child.kill = () => true;
  await assert.rejects(
    stopTargetProcess(child, {
      forceTimeoutMs: 1,
      forceKillTimeoutMs: 1,
    }),
    /did not exit/,
  );
});

test("stopTargetProcess - rejects when forced kill throws", async () => {
  const child = fakeChildProcess(4321);
  child.kill = () => true;
  await assert.rejects(
    stopTargetProcess(child, {
      platform: "win32",
      forceTimeoutMs: 1,
      forceKillTimeoutMs: 10,
      killWindowsProcessTree: (_pid, signal) => {
        if (signal === "SIGKILL") {
          throw new Error("forced kill failed");
        }
      },
    }),
    /forced kill failed/,
  );
});

test("stopTargetProcess - resolves immediately without a pid", async () => {
  const child = fakeChildProcess();
  Object.defineProperty(child, "pid", { value: undefined });
  let killed = false;
  child.kill = () => {
    killed = true;
    return true;
  };
  await stopTargetProcess(child, {
    forceTimeoutMs: 1,
    forceKillTimeoutMs: 1,
  });
  assert.strictEqual(killed, false);
});

test("createBenchmarkWorktree - cleans partial registrations", async () => {
  const calls: string[][] = [];
  const removals: string[] = [];
  await assert.rejects(
    createBenchmarkWorktree("missing-ref", "base", {
      createTempDir: () => Promise.resolve("/tmp/fedify-bench-base-test"),
      removePath: (path) => {
        removals.push(path);
        return Promise.resolve();
      },
      runGit: (args) => {
        calls.push([...args]);
        if (args[1] === "add") {
          return Promise.reject(new Error("checkout failed"));
        }
        return Promise.resolve();
      },
    }),
    /checkout failed/,
  );
  assert.deepEqual(calls, [
    [
      "worktree",
      "add",
      "--detach",
      "/tmp/fedify-bench-base-test",
      "missing-ref",
    ],
    ["worktree", "remove", "--force", "/tmp/fedify-bench-base-test"],
  ]);
  assert.deepEqual(removals, ["/tmp/fedify-bench-base-test"]);
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

test("waitReadyUrl - tolerates response bodies without cancel", async () => {
  await waitReadyUrl(new URL("http://ready.test/health"), 100, {
    fetch: () =>
      Promise.resolve({
        status: 200,
        body: {},
      } as Response),
  });
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

test("waitReadyUrl - prefers abort reason over transport errors", async () => {
  await assert.rejects(
    waitReadyUrl(new URL("http://ready.test/health"), 20, {
      fetch: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new TypeError("transport failure")),
            { once: true },
          );
        }),
      sleep: () => Promise.resolve(),
    }),
    /ready URL timed out after 20ms/,
  );
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

test("runBenchCompare - stops target and removes worktree on interrupt", async () => {
  const signals = new EventEmitter();
  const events: string[] = [];
  let code = -1;
  await runBenchCompare(command({}), {
    exit: (c) => {
      code = c;
    },
    writeOutput: () => {
      events.push("write");
      return Promise.resolve();
    },
    log: (message) => events.push(`log:${message}`),
    createWorktree: (_ref, label) => Promise.resolve(`/tmp/${label}`),
    removeWorktree: (path) => {
      events.push(`remove:${path}`);
      return Promise.resolve();
    },
    startTarget: (cwd) => {
      events.push(`start:${cwd}`);
      return Promise.resolve({
        stop: () => {
          events.push(`stop:${cwd}`);
          return Promise.resolve();
        },
      });
    },
    waitReady: (_url, _timeoutMs, signal) => {
      assert.ok(signal);
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          events.push("ready-abort");
          reject(signal.reason);
        }, { once: true });
        queueMicrotask(() => signals.emit("SIGINT", "SIGINT"));
      });
    },
    runBenchInWorktree: () => {
      events.push("bench");
      return Promise.resolve(report([scenario()]));
    },
    signalTarget: signals,
  });
  assert.strictEqual(code, 130);
  assert.deepEqual(events, [
    "log:Checking out base benchmark ref origin/main…",
    "start:/tmp/base",
    "ready-abort",
    "stop:/tmp/base",
    "remove:/tmp/base",
  ]);
  assert.strictEqual(signals.listenerCount("SIGINT"), 0);
  assert.strictEqual(signals.listenerCount("SIGTERM"), 0);
});

test("runBenchCompare - aborts raced benchmark work on interrupt", async () => {
  const signals = new EventEmitter();
  const events: string[] = [];
  let code = -1;
  await runBenchCompare(command({}), {
    exit: (c) => {
      code = c;
    },
    writeOutput: () => {
      events.push("write");
      return Promise.resolve();
    },
    log: (message) => events.push(`log:${message}`),
    createWorktree: (_ref, label) => Promise.resolve(`/tmp/${label}`),
    removeWorktree: (path) => {
      events.push(`remove:${path}`);
      return Promise.resolve();
    },
    startTarget: (cwd) => {
      events.push(`start:${cwd}`);
      return Promise.resolve({
        stop: () => {
          events.push(`stop:${cwd}`);
          return Promise.resolve();
        },
      });
    },
    waitReady: () => {
      events.push("ready");
      return Promise.resolve();
    },
    runBenchInWorktree: ({ signal }) => {
      assert.ok(signal);
      queueMicrotask(() => signals.emit("SIGTERM", "SIGTERM"));
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          events.push("bench-abort");
          reject(signal.reason);
        }, { once: true });
      });
    },
    signalTarget: signals,
  });
  assert.strictEqual(code, 143);
  assert.deepEqual(events, [
    "log:Checking out base benchmark ref origin/main…",
    "start:/tmp/base",
    "ready",
    "bench-abort",
    "stop:/tmp/base",
    "remove:/tmp/base",
  ]);
});

test("runBenchCompare - aborts benchmark work when target exits", async () => {
  const events: string[] = [];
  let rejectExit!: (error: Error) => void;
  let code = -1;
  await runBenchCompare(command({}), {
    exit: (c) => {
      code = c;
    },
    writeOutput: () => {
      events.push("write");
      return Promise.resolve();
    },
    log: (message) => events.push(`log:${message}`),
    createWorktree: (_ref, label) => Promise.resolve(`/tmp/${label}`),
    removeWorktree: (path) => {
      events.push(`remove:${path}`);
      return Promise.resolve();
    },
    startTarget: (cwd) => {
      events.push(`start:${cwd}`);
      return Promise.resolve({
        exited: new Promise<never>((_resolve, reject) => {
          rejectExit = reject;
        }),
        stop: () => {
          events.push(`stop:${cwd}`);
          return Promise.resolve();
        },
      });
    },
    waitReady: () => {
      events.push("ready");
      return Promise.resolve();
    },
    runBenchInWorktree: ({ signal }) => {
      assert.ok(signal);
      queueMicrotask(() => rejectExit(new Error("target exited")));
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          events.push("bench-abort");
          reject(signal.reason);
        }, { once: true });
      });
    },
  });
  assert.strictEqual(code, 2);
  assert.deepEqual(events, [
    "log:Checking out base benchmark ref origin/main…",
    "start:/tmp/base",
    "ready",
    "bench-abort",
    "stop:/tmp/base",
    "log:target exited",
    "remove:/tmp/base",
  ]);
});

test("runBenchCompare - ignores target exit while stopping normally", async () => {
  const events: string[] = [];
  let rejectExit!: (error: Error) => void;
  let code = -1;
  await runBenchCompare(command({}), {
    exit: (c) => {
      code = c;
    },
    writeOutput: () => {
      events.push("write");
      return Promise.resolve();
    },
    log: (message) => events.push(`log:${message}`),
    createWorktree: (_ref, label) => Promise.resolve(`/tmp/${label}`),
    removeWorktree: (path) => {
      events.push(`remove:${path}`);
      return Promise.resolve();
    },
    startTarget: (cwd) => {
      events.push(`start:${cwd}`);
      return Promise.resolve({
        exited: new Promise<never>((_resolve, reject) => {
          rejectExit = reject;
        }),
        stop: () => {
          events.push(`stop:${cwd}`);
          rejectExit(new Error("target stopped"));
          return Promise.resolve();
        },
      });
    },
    waitReady: () => {
      events.push("ready");
      return Promise.resolve();
    },
    runBenchInWorktree: () => {
      events.push("bench");
      return Promise.resolve(report([scenario()]));
    },
  });
  await Promise.resolve();
  assert.strictEqual(code, 0);
  assert.deepEqual(events, [
    "log:Checking out base benchmark ref origin/main…",
    "start:/tmp/base",
    "ready",
    "bench",
    "stop:/tmp/base",
    "log:Checking out head benchmark ref HEAD…",
    "start:/tmp/head",
    "ready",
    "bench",
    "stop:/tmp/head",
    "write",
    "remove:/tmp/head",
    "remove:/tmp/base",
  ]);
});

test("runBenchCompare - fails when target exits before readiness", async () => {
  const events: string[] = [];
  let code = -1;
  await runBenchCompare(command({}), {
    exit: (c) => {
      code = c;
    },
    writeOutput: () => {
      events.push("write");
      return Promise.resolve();
    },
    log: (message) => events.push(`log:${message}`),
    createWorktree: (_ref, label) => Promise.resolve(`/tmp/${label}`),
    removeWorktree: (path) => {
      events.push(`remove:${path}`);
      return Promise.resolve();
    },
    startTarget: (cwd) => {
      events.push(`start:${cwd}`);
      return Promise.resolve({
        exited: Promise.reject(new Error("target exited early")),
        stop: () => {
          events.push(`stop:${cwd}`);
          return Promise.resolve();
        },
      });
    },
    waitReady: () => {
      events.push("ready");
      return Promise.resolve();
    },
    runBenchInWorktree: () => {
      events.push("bench");
      return Promise.resolve(report([scenario()]));
    },
  });
  assert.strictEqual(code, 2);
  assert.match(events.join("\n"), /target exited early/);
  assert.deepEqual(events, [
    "log:Checking out base benchmark ref origin/main…",
    "start:/tmp/base",
    "ready",
    "stop:/tmp/base",
    "log:target exited early",
    "remove:/tmp/base",
  ]);
});

test("runBenchCompare - does not treat derived target as explicit", async () => {
  const file = await writeSuite(`version: 1
target: https://example.com
defaults:
  load: { rate: 1/s }
  duration: 1ms
scenarios:
  - name: wf
    type: webfinger
    recipient: "acct:alice@example.com"
`);
  const events: string[] = [];
  let code = -1;
  await runBenchCompare(
    command({
      file,
      readyUrl: "https://example.com/health",
      allowUnsafeTarget: true,
    }),
    {
      exit: (c) => {
        code = c;
      },
      writeOutput: () => Promise.resolve(),
      log: (message) => events.push(`compare:${message}`),
      createWorktree: (_ref, label) => Promise.resolve(`/tmp/${label}`),
      removeWorktree: () => Promise.resolve(),
      startTarget: () => Promise.resolve({ stop: () => Promise.resolve() }),
      waitReady: () => Promise.resolve(),
      benchDeps: {
        log: (message) => events.push(`bench:${message}`),
        fetch: () =>
          Promise.resolve(new Response("not found", { status: 404 })),
        resolveTargetAddresses: () => Promise.resolve(["93.184.216.34"]),
      },
    },
  );
  assert.strictEqual(code, 2);
  assert.match(events.join("\n"), /--target/);
});
