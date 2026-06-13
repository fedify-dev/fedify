import { type ChildProcess, spawn } from "node:child_process";
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
  const baseScenarios = new Map(base.scenarios.map((s) => [s.name, s]));
  const results: ComparisonResult[] = [];
  for (const headScenario of head.scenarios) {
    const baseScenario = baseScenarios.get(headScenario.name);
    if (baseScenario == null || baseScenario.type !== headScenario.type) {
      results.push(missingScenario(headScenario.name, maxRegression));
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

function missingScenario(
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
    pass: false,
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
    return latencyValue(scenario.client.latencyMs, metric.slice(8));
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
  if (!Number.isFinite(base) || !Number.isFinite(head) || base <= 0) {
    return base === head ? 0 : null;
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
    return Math.max(...values) === Math.min(...values) ? 0 : Infinity;
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
  const runCommand: BenchRunCommand = {
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

async function defaultCreateWorktree(
  ref: string,
  label: "base" | "head",
): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), `fedify-bench-${label}-`));
  await rm(path, { recursive: true, force: true });
  await runGit(["worktree", "add", "--detach", path, ref]);
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
  const child = spawn(startCommand, {
    cwd,
    detached: process.platform !== "win32",
    shell: true,
    stdio: "inherit",
    env: process.env,
  });
  return Promise.resolve({
    stop: () => stopProcess(child),
  });
}

function stopProcess(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode != null || child.signalCode != null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      killTargetProcess(child, "SIGKILL");
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    killTargetProcess(child, "SIGTERM");
  });
}

function killTargetProcess(
  child: ChildProcess,
  signal: NodeJS.Signals,
): void {
  if (child.pid == null || process.platform === "win32") {
    child.kill(signal);
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

async function defaultWaitReady(url: URL, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() <= deadline) {
    try {
      const response = await fetch(url);
      await response.arrayBuffer().catch(() => {});
      if (response.status >= 200 && response.status < 400) return;
      lastError = new Error(`ready URL returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
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
