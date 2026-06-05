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
  ServerMetrics,
  TargetInfo,
} from "./model.ts";

/** The per-scenario measurement a runner produces. */
export interface ScenarioMeasurement {
  readonly requests: RequestSummary;
  readonly throughputPerSec: number;
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
  measurement: ScenarioMeasurement,
): ScenarioResult {
  const { results, passed } = evaluateExpect(scenario.expect, measurement);
  // A scenario that measured no requests must never pass: an empty sample set
  // makes every `expect` assertion vacuously true (and a missing-metric one
  // could only fail), so without this guard a run that sent nothing would
  // report a green gate.
  return {
    name: scenario.name,
    type: scenario.type,
    load: loadSummary(scenario),
    requests: measurement.requests,
    throughputPerSec: measurement.throughputPerSec,
    client: measurement.client,
    server: measurement.server,
    errors: measurement.errors,
    expectations: results,
    passed: passed && measurement.requests.total > 0,
    ...(measurement.histogram ? { histogram: measurement.histogram } : {}),
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
    schemaVersion: 1,
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
