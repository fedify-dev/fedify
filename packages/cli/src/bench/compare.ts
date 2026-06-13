import {
  type ChildProcess,
  spawn,
  type SpawnOptions,
} from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import type { BenchCompareCommand, BenchRunCommand } from "./command.ts";
import runBench from "./action.ts";
import type { RunBenchDeps } from "./action.ts";
import { COMPARE_REPORT_SCHEMA_ID } from "./compare/schema.ts";
import { parseDuration } from "./scenario/units.ts";
import type {
  BenchReport,
  ScenarioResult,
  ScenarioRunResult,
} from "./result/model.ts";
import { metricUnit } from "./result/expect/metrics.ts";
import { describeError } from "../utils.ts";

/** A benchmark comparison report. */
export interface BenchCompareReport {
  readonly $schema: string;
  readonly schemaVersion: 1;
  readonly tool: BenchReport["tool"];
  readonly environment: BenchReport["environment"];
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly suite: BenchReport["suite"];
  readonly maxRegression: number;
  readonly base: CompareSide;
  readonly head: CompareSide;
  readonly comparisons: ComparisonResult[];
  readonly passed: boolean;
}

/** One side of a comparison. */
export interface CompareSide {
  readonly ref: string;
  readonly report: BenchReport;
}

/** One metric comparison between base and head. */
export interface ComparisonResult {
  readonly scenario: string;
  readonly metric: string;
  readonly direction: "lower-is-better" | "higher-is-better";
  readonly base: number | null;
  readonly head: number | null;
  readonly regression: number | null;
  readonly noiseBand: number;
  readonly allowedRegression: number;
  readonly pass: boolean;
}

/** Dependencies injectable for tests. */
export interface RunBenchCompareDeps {
  readonly exit?: (code: number) => void;
  readonly writeOutput?: (
    content: string,
    outputPath: string | undefined,
  ) => Promise<void>;
  readonly log?: (message: string) => void;
  readonly createWorktree?: (
    ref: string,
    label: "base" | "head",
  ) => Promise<string>;
  readonly removeWorktree?: (path: string) => Promise<void>;
  readonly startTarget?: (
    cwd: string,
    startCommand: string,
  ) => Promise<StartedTarget>;
  readonly waitReady?: (url: URL, timeoutMs: number) => Promise<void>;
  readonly runBenchInWorktree?: (
    input: RunBenchInWorktreeInput,
  ) => Promise<BenchReport>;
  readonly benchDeps?: RunBenchDeps;
}

/** A started target process. */
export interface StartedTarget {
  stop(): Promise<void>;
}

/** Input to a worktree-local benchmark run. */
export interface RunBenchInWorktreeInput {
  readonly cwd: string;
  readonly command: BenchCompareCommand;
  readonly target: string;
}

type ProcessOutput = {
  write(chunk: string | Uint8Array): unknown;
};

type SpawnTarget = (
  command: string,
  options: SpawnOptions,
) => ChildProcess;

type BenchRunCompareCommand = BenchRunCommand & {
  readonly explicitCliTarget: boolean;
};

/** Options for starting a benchmark target. */
export interface StartBenchmarkTargetOptions {
  readonly platform?: NodeJS.Platform;
  readonly spawn?: SpawnTarget;
  readonly stderr?: ProcessOutput;
}

/** Options for stopping a benchmark target process. */
export interface StopTargetProcessOptions {
  readonly platform?: NodeJS.Platform;
  readonly killWindowsProcessTree?: (
    pid: number,
    signal: NodeJS.Signals,
  ) => void;
  readonly killProcessGroup?: (pid: number, signal: NodeJS.Signals) => void;
  readonly forceTimeoutMs?: number;
  readonly forceKillTimeoutMs?: number;
}

/** Dependencies for waiting until a benchmark target is ready. */
export interface WaitReadyUrlDeps {
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

type CreateTempDir = (prefix: string) => Promise<string>;
type RemovePath = (
  path: string,
  options: { readonly recursive: boolean; readonly force: boolean },
) => Promise<void>;
type RunGit = (args: readonly string[]) => Promise<void>;

/** Dependencies for creating benchmark comparison worktrees. */
export interface CreateBenchmarkWorktreeDeps {
  readonly createTempDir?: CreateTempDir;
  readonly removePath?: RemovePath;
  readonly runGit?: RunGit;
}

/** Runs `fedify bench compare`. */
export async function runBenchCompare(
  command: BenchCompareCommand,
  deps: RunBenchCompareDeps = {},
): Promise<void> {
  const exit = deps.exit ?? ((code: number) => {
    process.exitCode = code;
  });
  const writeOutput = deps.writeOutput ?? defaultWriteOutput;
  const log = deps.log ??
    ((message: string) => process.stderr.write(`${message}\n`));
  const createWorktree = deps.createWorktree ?? defaultCreateWorktree;
  const removeWorktree = deps.removeWorktree ?? defaultRemoveWorktree;
  const startTarget = deps.startTarget ?? defaultStartTarget;
  const waitReady = deps.waitReady ?? defaultWaitReady;
  const runBenchInWorktree = deps.runBenchInWorktree ??
    ((input) => defaultRunBenchInWorktree(input, deps.benchDeps));

  let readyUrl: URL;
  let readyTimeoutMs: number;
  let maxRegression: number;
  try {
    readyUrl = new URL(command.readyUrl);
    readyTimeoutMs = parseDuration(command.readyTimeout);
    maxRegression = parseRegressionTolerance(command.maxRegression);
  } catch (error) {
    log(describeError(error));
    return void exit(2);
  }
  const target = command.target ?? new URL("/", readyUrl).origin;
  const worktrees: string[] = [];
  const startedAt = new Date().toISOString();
  try {
    const baseReport = await runSide("base", command.base);
    const headReport = await runSide("head", command.head);
    const report = buildCompareReport({
      baseRef: command.base,
      headRef: command.head,
      baseReport,
      headReport,
      maxRegression,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    await writeOutput(
      renderCompareReport(report, command.format),
      command.output,
    );
    return void exit(report.passed ? 0 : 1);
  } catch (error) {
    log(describeError(error));
    return void exit(2);
  } finally {
    for (const path of worktrees.toReversed()) {
      try {
        await removeWorktree(path);
      } catch (error) {
        log(
          `Failed to remove benchmark worktree ${path}: ${
            describeError(error)
          }`,
        );
      }
    }
  }

  async function runSide(
    label: "base" | "head",
    ref: string,
  ): Promise<BenchReport> {
    log(`Checking out ${label} benchmark ref ${ref}…`);
    const cwd = await createWorktree(ref, label);
    worktrees.push(cwd);
    const targetProcess = await startTarget(cwd, command.startCommand);
    try {
      await waitReady(readyUrl, readyTimeoutMs);
      return await runBenchInWorktree({ cwd, command, target });
    } finally {
      await targetProcess.stop();
    }
  }
}

/** Parses `--max-regression`, accepting ratios or percentages. */
export function parseRegressionTolerance(value: string): number {
  const trimmed = value.trim();
  const match = /^(\d+(?:\.\d+)?|\.\d+)(%)?$/.exec(trimmed);
  const numeric = match == null ? NaN : Number(match[1]);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new RangeError(
      `Invalid --max-regression value: ${JSON.stringify(value)}.`,
    );
  }
  return match?.[2] === "%" ? numeric / 100 : numeric;
}

/** Builds a compare report from two benchmark reports. */
export function buildCompareReport(input: {
  readonly baseRef: string;
  readonly headRef: string;
  readonly baseReport: BenchReport;
  readonly headReport: BenchReport;
  readonly maxRegression: number;
  readonly startedAt: string;
  readonly finishedAt: string;
}): BenchCompareReport {
  const comparisons = compareReports(
    input.baseReport,
    input.headReport,
    input.maxRegression,
  );
  return {
    $schema: COMPARE_REPORT_SCHEMA_ID,
    schemaVersion: 1,
    tool: input.headReport.tool,
    environment: input.headReport.environment,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    suite: input.headReport.suite,
    maxRegression: input.maxRegression,
    base: { ref: input.baseRef, report: input.baseReport },
    head: { ref: input.headRef, report: input.headReport },
    comparisons,
    passed: input.headReport.passed && comparisons.every((c) => c.pass),
  };
}

function compareReports(
  base: BenchReport,
  head: BenchReport,
  maxRegression: number,
): ComparisonResult[] {
  const results: ComparisonResult[] = [];
  const baseByScenario = new Map<string, ScenarioResult[]>();
  for (const baseScenario of base.scenarios) {
    const key = comparisonScenarioKey(baseScenario);
    const scenarios = baseByScenario.get(key);
    if (scenarios == null) {
      baseByScenario.set(key, [baseScenario]);
    } else {
      scenarios.push(baseScenario);
    }
  }
  const headCounts = new Map<string, number>();
  for (const headScenario of head.scenarios) {
    const key = comparisonScenarioKey(headScenario);
    const occurrence = headCounts.get(key) ?? 0;
    headCounts.set(key, occurrence + 1);
    const baseScenario = baseByScenario.get(key)?.[occurrence];
    if (baseScenario == null) {
      results.push(newScenario(headScenario.name, maxRegression));
      continue;
    }
    for (const metric of comparisonMetrics(headScenario)) {
      results.push(
        compareMetric(baseScenario, headScenario, metric, maxRegression),
      );
    }
  }
  return results;
}

function comparisonScenarioKey(scenario: ScenarioResult): string {
  return `${scenario.name}\0${scenario.type}`;
}

function comparisonMetrics(scenario: ScenarioResult): string[] {
  const fromExpect = scenario.expectations
    .map((e) => e.metric)
    .filter(isPerformanceMetric);
  return [
    ...new Set(
      fromExpect.length < 1 ? ["latency.p95", "throughputPerSec"] : fromExpect,
    ),
  ];
}

function isPerformanceMetric(metric: string): boolean {
  const unit = metricUnit(metric);
  return unit === "ms" || unit === "rate";
}

function compareMetric(
  baseScenario: ScenarioResult,
  headScenario: ScenarioResult,
  metric: string,
  maxRegression: number,
): ComparisonResult {
  const direction = metricUnit(metric) === "rate"
    ? "higher-is-better"
    : "lower-is-better";
  const base = metricValue(baseScenario, metric);
  const head = metricValue(headScenario, metric);
  const noiseBand = Math.max(
    relativeNoise(baseScenario, metric),
    relativeNoise(headScenario, metric),
  );
  const regression = base == null || head == null
    ? null
    : regressionRatio(base, head, direction);
  const allowedRegression = maxRegression + noiseBand;
  return {
    scenario: headScenario.name,
    metric,
    direction,
    base,
    head,
    regression,
    noiseBand,
    allowedRegression,
    pass: regression != null && regression <= allowedRegression,
  };
}

function newScenario(
  scenario: string,
  maxRegression: number,
): ComparisonResult {
  return {
    scenario,
    metric: "scenario",
    direction: "lower-is-better",
    base: null,
    head: null,
    regression: null,
    noiseBand: 0,
    allowedRegression: maxRegression,
    pass: true,
  };
}

function metricValue(
  scenario: ScenarioResult | ScenarioRunResult,
  metric: string,
): number | null {
  switch (metric) {
    case "throughputPerSec":
      return scenario.throughputPerSec;
    case "deliveryThroughput":
      return scenario.deliveryThroughputPerSec ?? null;
  }
  if (metric.startsWith("latency.")) {
    const latency = scenario.client?.latencyMs;
    return latency == null ? null : latencyValue(latency, metric.slice(8));
  }
  if (metric.startsWith("signatureVerification.")) {
    return partialValue(
      scenario.server?.signatureVerificationMs?.overall,
      metric.slice("signatureVerification.".length),
    );
  }
  if (metric.startsWith("queueDrain.")) {
    return partialValue(
      scenario.server?.queue?.drainMs,
      metric.slice("queueDrain.".length),
    );
  }
  return null;
}

function latencyValue(
  latency: ScenarioResult["client"]["latencyMs"],
  field: string,
): number | null {
  switch (field) {
    case "p50":
      return latency.p50;
    case "p95":
      return latency.p95;
    case "p99":
      return latency.p99;
    case "mean":
      return latency.mean;
    case "max":
      return latency.max;
    default:
      return null;
  }
}

function partialValue(
  latency: {
    readonly p50?: number;
    readonly p95?: number;
    readonly p99?: number;
  } | undefined,
  field: string,
): number | null {
  switch (field) {
    case "p50":
      return latency?.p50 ?? null;
    case "p95":
      return latency?.p95 ?? null;
    case "p99":
      return latency?.p99 ?? null;
    default:
      return null;
  }
}

function regressionRatio(
  base: number,
  head: number,
  direction: ComparisonResult["direction"],
): number | null {
  if (!Number.isFinite(base) || !Number.isFinite(head)) {
    return null;
  }
  if (base < 0) {
    return base === head ? 0 : null;
  }
  if (base === 0) {
    if (base === head) return 0;
    return direction === "higher-is-better" && head > base ? 0 : null;
  }
  return direction === "higher-is-better"
    ? (base - head) / base
    : (head - base) / base;
}

function relativeNoise(scenario: ScenarioResult, metric: string): number {
  const values = (scenario.runs ?? [])
    .map((run) => metricValue(run, metric))
    .filter((value): value is number =>
      value != null && Number.isFinite(value)
    );
  if (values.length < 2) return 0;
  const medianValue = median(values);
  if (medianValue <= 0) {
    return 0;
  }
  return (Math.max(...values) - Math.min(...values)) / (2 * medianValue);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function renderCompareReport(
  report: BenchCompareReport,
  format: BenchCompareCommand["format"],
): string {
  switch (format) {
    case "json":
      return `${JSON.stringify(report, null, 2)}\n`;
    case "markdown":
      return renderCompareMarkdown(report);
    case "text":
      return renderCompareText(report);
  }
  throw new RangeError(`Unsupported benchmark report format: ${format}.`);
}

function renderCompareText(report: BenchCompareReport): string {
  const lines = [
    "Fedify benchmark comparison",
    "",
    `Base: ${report.base.ref}`,
    `Head: ${report.head.ref}`,
    `Maximum regression: ${formatPercent(report.maxRegression)}`,
    "",
  ];
  for (const comparison of report.comparisons) {
    lines.push(
      `[${comparison.pass ? "PASS" : "FAIL"}] ${comparison.scenario} ` +
        `${comparison.metric}: base ${formatNumberOrNull(comparison.base)}, ` +
        `head ${formatNumberOrNull(comparison.head)}, regression ${
          formatNumberOrNull(comparison.regression, formatPercent)
        }, noise ${formatPercent(comparison.noiseBand)}`,
    );
  }
  lines.push("", `Overall: ${report.passed ? "PASS" : "FAIL"}`);
  return `${lines.join("\n")}\n`;
}

function renderCompareMarkdown(report: BenchCompareReport): string {
  const lines = [
    "# Fedify benchmark comparison",
    "",
    `**Result:** ${report.passed ? "PASS" : "FAIL"}`,
    "",
    `- **Base:** \`${report.base.ref}\``,
    `- **Head:** \`${report.head.ref}\``,
    `- **Maximum regression:** ${formatPercent(report.maxRegression)}`,
    "",
    "| Scenario | Metric | Base | Head | Regression | Noise | Result |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const comparison of report.comparisons) {
    lines.push(
      `| ${comparison.scenario} | \`${comparison.metric}\` | ${
        formatNumberOrNull(comparison.base)
      } | ${formatNumberOrNull(comparison.head)} | ${
        formatNumberOrNull(comparison.regression, formatPercent)
      } | ${formatPercent(comparison.noiseBand)} | ${
        comparison.pass ? "PASS" : "FAIL"
      } |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function formatNumberOrNull(
  value: number | null,
  formatter: (value: number) => string = formatNumber,
): string {
  return value == null ? "n/a" : formatter(value);
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return `${(value * 100).toFixed(1)}%`;
}

async function defaultRunBenchInWorktree(
  input: RunBenchInWorktreeInput,
  benchDeps: RunBenchDeps = {},
): Promise<BenchReport> {
  let output = "";
  let exitCode = 0;
  const runCommand: BenchRunCompareCommand = {
    command: "bench",
    mode: "run",
    scenario: input.command.file,
    target: input.target,
    format: "json",
    output: undefined,
    dryRun: false,
    advertiseHost: input.command.advertiseHost,
    allowUnsafeTarget: input.command.allowUnsafeTarget,
    userAgent: input.command.userAgent,
    explicitCliTarget: input.command.target != null,
  };
  await runBench(runCommand, {
    ...benchDeps,
    exit: (code) => {
      exitCode = code;
    },
    writeOutput: (content) => {
      output = content;
      return Promise.resolve();
    },
  });
  if (exitCode === 2 || output.trim() === "") {
    throw new Error(`Benchmark run failed for ${input.cwd}.`);
  }
  return JSON.parse(output) as BenchReport;
}

function defaultCreateWorktree(
  ref: string,
  label: "base" | "head",
): Promise<string> {
  return createBenchmarkWorktree(ref, label);
}

/** Creates a detached Git worktree for one side of a benchmark comparison. */
export async function createBenchmarkWorktree(
  ref: string,
  label: "base" | "head",
  deps: CreateBenchmarkWorktreeDeps = {},
): Promise<string> {
  const createTempDir = deps.createTempDir ?? mkdtemp;
  const removePath = deps.removePath ?? rm;
  const run = deps.runGit ?? runGit;
  const path = await createTempDir(join(tmpdir(), `fedify-bench-${label}-`));
  await removePath(path, { recursive: true, force: true });
  try {
    await run(["worktree", "add", "--detach", path, ref]);
  } catch (error) {
    try {
      await run(["worktree", "remove", "--force", path]);
    } catch {
      // Preserve the original checkout failure.
    }
    try {
      await removePath(path, { recursive: true, force: true });
    } catch {
      // Preserve the original checkout failure.
    }
    throw error;
  }
  return path;
}

async function defaultRemoveWorktree(path: string): Promise<void> {
  await runGit(["worktree", "remove", "--force", path]);
}

function runGit(args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`git ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function defaultStartTarget(
  cwd: string,
  startCommand: string,
): Promise<StartedTarget> {
  return Promise.resolve(startBenchmarkTarget(cwd, startCommand));
}

/** Starts a benchmark target process. */
export function startBenchmarkTarget(
  cwd: string,
  startCommand: string,
  options: StartBenchmarkTargetOptions = {},
): StartedTarget {
  const platform = options.platform ?? process.platform;
  const spawnTarget = options.spawn ?? spawn;
  const stderr = options.stderr ?? process.stderr;
  const child = spawnTarget(startCommand, {
    cwd,
    detached: platform !== "win32",
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  forwardTargetOutput(child, stderr);
  return { stop: () => stopTargetProcess(child, { platform }) };
}

function forwardTargetOutput(child: ChildProcess, stderr: ProcessOutput): void {
  child.stdout?.on("data", (chunk: string | Uint8Array) => {
    stderr.write(chunk);
  });
  child.stderr?.on("data", (chunk: string | Uint8Array) => {
    stderr.write(chunk);
  });
}

/** Stops a benchmark target process. */
export function stopTargetProcess(
  child: ChildProcess,
  options: StopTargetProcessOptions = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  const killWindowsProcessTree = options.killWindowsProcessTree ??
    defaultKillWindowsProcessTree;
  const killProcessGroup = options.killProcessGroup ??
    ((pid, signal) => process.kill(pid, signal));
  const forceTimeoutMs = options.forceTimeoutMs ?? 5000;
  const forceKillTimeoutMs = options.forceKillTimeoutMs ?? forceTimeoutMs;
  return new Promise((resolve, reject) => {
    if (
      child.pid == null || child.exitCode != null || child.signalCode != null
    ) {
      resolve();
      return;
    }
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    const clearTimers = () => {
      clearTimeout(forceTimer);
      if (forceKillTimer != null) clearTimeout(forceKillTimer);
    };
    const onExit = () => {
      clearTimers();
      resolve();
    };
    const forceTimer = setTimeout(() => {
      killTargetProcess(child, "SIGKILL", {
        platform,
        killWindowsProcessTree,
        killProcessGroup,
      });
      forceKillTimer = setTimeout(() => {
        child.removeListener("exit", onExit);
        reject(
          new Error(
            `Benchmark target process ${child.pid ?? "<unknown>"} ` +
              "did not exit after SIGKILL.",
          ),
        );
      }, forceKillTimeoutMs);
    }, forceTimeoutMs);
    child.once("exit", onExit);
    killTargetProcess(child, "SIGTERM", {
      platform,
      killWindowsProcessTree,
      killProcessGroup,
    });
  });
}

interface KillTargetProcessOptions {
  readonly platform: NodeJS.Platform;
  readonly killWindowsProcessTree: (
    pid: number,
    signal: NodeJS.Signals,
  ) => void;
  readonly killProcessGroup: (pid: number, signal: NodeJS.Signals) => void;
}

function killTargetProcess(
  child: ChildProcess,
  signal: NodeJS.Signals,
  options: KillTargetProcessOptions,
): void {
  if (child.pid == null) {
    child.kill(signal);
    return;
  }
  if (options.platform === "win32") {
    options.killWindowsProcessTree(child.pid, signal);
    return;
  }
  try {
    options.killProcessGroup(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

function defaultKillWindowsProcessTree(
  pid: number,
  signal: NodeJS.Signals,
): void {
  const child = spawn("taskkill", windowsTaskkillArgs(pid, signal), {
    stdio: "ignore",
    windowsHide: true,
  });
  child.on("error", () => {});
}

export function windowsTaskkillArgs(
  pid: number,
  signal: NodeJS.Signals,
): string[] {
  const args = ["/pid", String(pid), "/T"];
  if (signal === "SIGKILL") args.push("/F");
  return args;
}

async function defaultWaitReady(url: URL, timeoutMs: number): Promise<void> {
  return await waitReadyUrl(url, timeoutMs);
}

/** Waits until a benchmark target readiness URL responds successfully. */
export async function waitReadyUrl(
  url: URL,
  timeoutMs: number,
  deps: WaitReadyUrlDeps = {},
): Promise<void> {
  const fetchReady = deps.fetch ?? fetch;
  const sleep = deps.sleep ??
    ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() <= deadline) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error(`ready URL timed out after ${timeoutMs}ms`));
    }, remainingMs);
    try {
      const response = await fetchReady(url, { signal: controller.signal });
      void response.body?.cancel().catch(() => {});
      if (response.status >= 200 && response.status < 400) return;
      lastError = new Error(`ready URL returned ${response.status}`);
    } catch (error) {
      if (controller.signal.aborted) {
        lastError = controller.signal.reason ?? error;
        break;
      }
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
    const delayMs = Math.min(250, deadline - Date.now());
    if (delayMs > 0) await sleep(delayMs);
  }
  throw new Error(
    `Timed out waiting for ${url.href}: ${describeError(lastError)}.`,
  );
}

async function defaultWriteOutput(
  content: string,
  outputPath: string | undefined,
): Promise<void> {
  if (outputPath == null) {
    process.stdout.write(content.endsWith("\n") ? content : `${content}\n`);
    return;
  }
  await writeFile(outputPath, content, { encoding: "utf-8" });
}
