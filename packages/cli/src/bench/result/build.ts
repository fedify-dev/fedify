/**
 * Assembly of the canonical benchmark report from measured scenario data.
 *
 * The runners produce per-scenario measurements; this module turns each into a
 * {@link ScenarioResult} (evaluating its `expect` block) and assembles the
 * top-level {@link BenchReport} with reproducibility metadata.
 * @since 2.3.0
 * @module
 */

import { createHash } from "node:crypto";
import { cpus } from "node:os";
import process from "node:process";
import metadata from "../../../deno.json" with { type: "json" };
import type { ResolvedScenario } from "../scenario/normalize.ts";
import { LogLinearHistogram } from "../metrics/histogram.ts";
import type { SerializedHistogram } from "../metrics/histogram.ts";
import { evaluateExpect } from "./expect/evaluate.ts";
import { REPORT_SCHEMA_ID } from "./schema.ts";
import type {
  BenchReport,
  ClientMetrics,
  Environment,
  ErrorBucket,
  LoadSummary,
  RequestSummary,
  ScenarioResult,
  ScenarioRunResult,
  ServerMetrics,
  TargetInfo,
} from "./model.ts";

/** The per-scenario measurement a runner produces. */
export interface ScenarioMeasurement {
  readonly requests: RequestSummary;
  readonly throughputPerSec: number;
  readonly deliveryThroughputPerSec?: number;
  readonly client: ClientMetrics;
  readonly server: ServerMetrics | null;
  readonly errors: ErrorBucket[];
  readonly histogram?: SerializedHistogram;
}

/**
 * Builds a scenario result from its resolved definition and measurement,
 * evaluating the `expect` block in the process.
 * @param scenario The resolved scenario.
 * @param measurement The measured client and server metrics.
 * @returns The assembled scenario result.
 */
export function buildScenarioResult(
  scenario: ResolvedScenario,
  measurement: ScenarioMeasurement | readonly ScenarioMeasurement[],
): ScenarioResult {
  const measurements = Array.isArray(measurement) ? measurement : [measurement];
  if (measurements.length < 1) {
    throw new RangeError("At least one scenario measurement is required.");
  }
  const aggregate = measurements.length === 1
    ? measurements[0]
    : aggregateMeasurements(measurements);
  const { results, passed } = evaluateExpect(scenario.expect, aggregate);
  // A scenario that measured no requests must never pass: an empty sample set
  // makes every `expect` assertion vacuously true (and a missing-metric one
  // could only fail), so without this guard a run that sent nothing would
  // report a green gate.
  return {
    name: scenario.name,
    type: scenario.type,
    load: loadSummary(scenario),
    requests: aggregate.requests,
    throughputPerSec: aggregate.throughputPerSec,
    ...(aggregate.deliveryThroughputPerSec == null ? {} : {
      deliveryThroughputPerSec: aggregate.deliveryThroughputPerSec,
    }),
    client: aggregate.client,
    server: aggregate.server,
    errors: aggregate.errors,
    expectations: results,
    passed: passed && measurements.every((m) => m.requests.total > 0),
    runCount: measurements.length,
    ...(measurements.length > 1
      ? { runs: measurements.map((m, index) => runResult(index + 1, m)) }
      : {}),
    ...(aggregate.histogram ? { histogram: aggregate.histogram } : {}),
  };
}

/** Inputs for {@link buildReport} beyond the scenario results. */
export interface ReportInput {
  readonly scenarios: ScenarioResult[];
  readonly environment: Environment;
  readonly target: TargetInfo;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly suite: { readonly name?: string; readonly configHash: string };
}

/**
 * Assembles the top-level report.  The gate passes only when every scenario
 * passes.
 * @param input The report inputs.
 * @returns The complete report.
 */
export function buildReport(input: ReportInput): BenchReport {
  return {
    $schema: REPORT_SCHEMA_ID,
    schemaVersion: 3,
    tool: { name: "@fedify/cli", version: metadata.version },
    environment: input.environment,
    target: input.target,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    suite: input.suite,
    passed: input.scenarios.every((s) => s.passed),
    scenarios: input.scenarios,
  };
}

function aggregateMeasurements(
  measurements: readonly ScenarioMeasurement[],
): ScenarioMeasurement {
  const errors = sumErrorBuckets(measurements.flatMap((m) => m.errors));
  const total = sum(measurements.map((m) => m.requests.total));
  const ok = sum(measurements.map((m) => m.requests.ok));
  const failed = sum(measurements.map((m) => m.requests.failed));
  const delivery = medianPresent(
    measurements.map((m) => m.deliveryThroughputPerSec),
  );
  return {
    requests: {
      total,
      ok,
      failed,
      // Correctness gates are intentionally pessimistic in repeated runs:
      // one bad run should not be hidden by two clean ones.
      successRate: Math.min(...measurements.map((m) => m.requests.successRate)),
    },
    throughputPerSec: median(measurements.map((m) => m.throughputPerSec)),
    ...(delivery == null ? {} : { deliveryThroughputPerSec: delivery }),
    client: {
      latencyMs: {
        p50: median(measurements.map((m) => m.client.latencyMs.p50)),
        p95: median(measurements.map((m) => m.client.latencyMs.p95)),
        p99: median(measurements.map((m) => m.client.latencyMs.p99)),
        mean: median(measurements.map((m) => m.client.latencyMs.mean)),
        max: median(measurements.map((m) => m.client.latencyMs.max)),
      },
    },
    server: aggregateServer(measurements.map((m) => m.server)),
    errors,
    ...aggregateHistogram(measurements),
  };
}

function runResult(
  run: number,
  measurement: ScenarioMeasurement,
): ScenarioRunResult {
  return {
    run,
    requests: measurement.requests,
    throughputPerSec: measurement.throughputPerSec,
    ...(measurement.deliveryThroughputPerSec == null ? {} : {
      deliveryThroughputPerSec: measurement.deliveryThroughputPerSec,
    }),
    client: measurement.client,
    server: measurement.server,
    errors: measurement.errors,
    ...(measurement.histogram ? { histogram: measurement.histogram } : {}),
  };
}

function aggregateServer(
  servers: readonly (ServerMetrics | null)[],
): ServerMetrics | null {
  const present = servers.filter((s): s is ServerMetrics => s != null);
  if (present.length < 1) return null;
  const signature = aggregateSignatureVerification(present);
  const queue = aggregateQueue(present);
  return {
    ...(signature == null ? {} : { signatureVerificationMs: signature }),
    ...(queue == null ? {} : { queue }),
  };
}

function aggregateSignatureVerification(
  servers: readonly ServerMetrics[],
): NonNullable<ServerMetrics["signatureVerificationMs"]> | null {
  const values = servers
    .map((s) => s.signatureVerificationMs)
    .filter((s): s is NonNullable<ServerMetrics["signatureVerificationMs"]> =>
      s != null
    );
  if (values.length < 1) return null;
  const standards = new Set<string>();
  for (const value of values) {
    for (const key of Object.keys(value.byStandard ?? {})) standards.add(key);
  }
  const byStandard: Record<string, ReturnType<typeof aggregatePartial>> = {};
  for (const standard of standards) {
    byStandard[standard] = aggregatePartial(
      values.map((v) => v.byStandard?.[standard]),
    );
  }
  return {
    overall: aggregatePartial(values.map((v) => v.overall)),
    ...(Object.keys(byStandard).length < 1 ? {} : { byStandard }),
  };
}

function aggregateQueue(
  servers: readonly ServerMetrics[],
): NonNullable<ServerMetrics["queue"]> | null {
  const values = servers
    .map((s) => s.queue)
    .filter((q): q is NonNullable<ServerMetrics["queue"]> => q != null);
  if (values.length < 1) return null;
  const drainMs = aggregatePartial(values.map((v) => v.drainMs));
  const depths = values.map((v) => v.depthMax).filter(isNumber);
  return {
    ...(hasPartial(drainMs) ? { drainMs } : {}),
    ...(depths.length < 1 ? {} : { depthMax: Math.max(...depths) }),
  };
}

type PartialMetric = {
  readonly p50?: number;
  readonly p95?: number;
  readonly p99?: number;
};

function aggregatePartial(values: readonly (PartialMetric | undefined)[]) {
  return {
    ...partialField(values, "p50"),
    ...partialField(values, "p95"),
    ...partialField(values, "p99"),
  };
}

function partialField(
  values:
    readonly ({ readonly [key: string]: number | undefined } | undefined)[],
  key: "p50" | "p95" | "p99",
): Record<typeof key, number> | Record<string, never> {
  const fieldValues = values.map((v) => v?.[key]).filter(isNumber);
  return fieldValues.length < 1
    ? {}
    : { [key]: median(fieldValues) } as Record<typeof key, number>;
}

function hasPartial(value: {
  readonly p50?: number;
  readonly p95?: number;
  readonly p99?: number;
}): boolean {
  return value.p50 != null || value.p95 != null || value.p99 != null;
}

function aggregateHistogram(
  measurements: readonly ScenarioMeasurement[],
): { readonly histogram?: SerializedHistogram } {
  const histograms = measurements.map((m) => m.histogram);
  if (histograms.some((h) => h == null)) return {};
  const [first, ...rest] = histograms as SerializedHistogram[];
  const merged = LogLinearHistogram.fromJSON(first);
  for (const histogram of rest) {
    merged.merge(LogLinearHistogram.fromJSON(histogram));
  }
  return { histogram: merged.toJSON() };
}

function sumErrorBuckets(errors: readonly ErrorBucket[]): ErrorBucket[] {
  const buckets = new Map<string, ErrorBucket>();
  for (const error of errors) {
    const key = `${error.kind}|${error.status ?? ""}|${error.reason}`;
    const previous = buckets.get(key);
    buckets.set(key, {
      ...error,
      count: (previous?.count ?? 0) + error.count,
    });
  }
  return [...buckets.values()].sort((a, b) => b.count - a.count);
}

function medianPresent(values: readonly (number | undefined)[]): number | null {
  const present = values.filter(isNumber);
  return present.length < 1 ? null : median(present);
}

function median(values: readonly number[]): number {
  if (values.length < 1) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function isNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Detects the current runtime environment for reproducibility metadata. */
export function detectEnvironment(): Environment {
  const g = globalThis as {
    Deno?: { version?: { deno?: string } };
    Bun?: { version?: string };
  };
  let runtime = "node";
  let runtimeVersion = process.versions?.node ?? "unknown";
  if (g.Deno?.version?.deno != null) {
    runtime = "deno";
    runtimeVersion = g.Deno.version.deno;
  } else if (g.Bun?.version != null) {
    runtime = "bun";
    runtimeVersion = g.Bun.version;
  }
  let cpuCount = 0;
  try {
    cpuCount = cpus().length;
  } catch {
    cpuCount = 0;
  }
  return { runtime, runtimeVersion, os: process.platform, cpuCount };
}

/**
 * Computes a stable `sha256:` hash of a resolved configuration, so CI only
 * compares runs from the same configuration.
 * @param config The configuration object to hash.
 * @returns A `sha256:`-prefixed hex digest.
 */
export function configHash(config: unknown): string {
  const digest = createHash("sha256").update(canonicalJson(config)).digest(
    "hex",
  );
  return `sha256:${digest}`;
}

/** A guard against unbounded recursion on pathologically nested input. */
const MAX_HASH_DEPTH = 100;

function canonicalJson(value: unknown, depth = 0): string {
  if (depth > MAX_HASH_DEPTH) {
    throw new RangeError("Maximum depth exceeded while hashing the config.");
  }
  // Mirror JSON.stringify: `undefined` is dropped from objects and becomes
  // `null` inside arrays.
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  // Honor toJSON() (as JSON.stringify does) so URL, Date, and similar values
  // are hashed by their serialized form rather than as an empty object.
  const toJson = (value as { toJSON?: unknown }).toJSON;
  if (typeof toJson === "function") {
    return canonicalJson((toJson as () => unknown).call(value), depth + 1);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v, depth + 1)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${
    entries.map(([k, v]) =>
      `${JSON.stringify(k)}:${canonicalJson(v, depth + 1)}`
    )
      .join(",")
  }}`;
}

function loadSummary(scenario: ResolvedScenario): LoadSummary {
  const { load, durationMs, warmupMs } = scenario;
  const maxInFlight = load.maxInFlight == null
    ? {}
    : { maxInFlight: load.maxInFlight };
  if (load.kind === "closed") {
    return {
      model: "closed",
      concurrency: load.concurrency,
      durationMs,
      warmupMs,
      ...maxInFlight,
    };
  }
  return {
    model: "open",
    ratePerSec: load.ratePerSec,
    arrival: load.arrival,
    durationMs,
    warmupMs,
    ...maxInFlight,
  };
}
