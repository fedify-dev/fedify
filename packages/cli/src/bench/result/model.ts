/**
 * Hand-written TypeScript types for the canonical benchmark report model.
 *
 * The report is the single result model from which the terminal, JSON, and
 * Markdown renderers all derive, so the three outputs can never drift apart.
 * JSON is the canonical machine form, pinned by the published schema in
 * {@link ./schema.ts} and *schema/bench/report-v1.json*.
 *
 * Conventions:
 *
 *  -  `client` and `server` numbers are split by nesting, honoring the
 *     requirement that the report makes clear which numbers the load generator
 *     measured and which came from the target's `stats` endpoint.
 *  -  Numeric keys bake in their unit (`latencyMs`, `drainMs`) so no consumer
 *     parses `"1.8s"`.
 *  -  Each `expect` assertion becomes an evaluated record, with a top-level
 *     `passed`, so the report is a self-contained CI gate.
 * @since 2.3.0
 * @module
 */

import type { ScenarioType } from "../scenario/types.ts";
import type { SerializedHistogram } from "../metrics/histogram.ts";

/** The reproducibility environment a run was measured in. */
export interface Environment {
  /** The JavaScript runtime, e.g. `"node"`, `"deno"`, or `"bun"`. */
  readonly runtime: string;
  /** The runtime version string. */
  readonly runtimeVersion: string;
  /** The operating system, e.g. `"linux"`. */
  readonly os: string;
  /** The number of logical CPUs. */
  readonly cpuCount: number;
}

/** Information about the benchmarked target. */
export interface TargetInfo {
  /** The target base URL. */
  readonly url: string;
  /** The target's Fedify version, if it could be determined. */
  readonly fedifyVersion?: string | null;
  /** Whether the target's `stats` endpoint was available. */
  readonly statsAvailable: boolean;
}

/** A latency distribution measured by the client (all values milliseconds). */
export interface LatencyMs {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly mean: number;
  readonly max: number;
}

/** A partial latency distribution as projected from server metrics. */
export interface PartialLatencyMs {
  readonly p50?: number;
  readonly p95?: number;
  readonly p99?: number;
}

/** The load model summary recorded in a scenario result. */
export type LoadSummary =
  | {
    readonly model: "open";
    readonly ratePerSec: number;
    readonly arrival: string;
    readonly durationMs: number;
    readonly warmupMs: number;
    readonly maxInFlight?: number;
  }
  | {
    readonly model: "closed";
    readonly concurrency: number;
    readonly durationMs: number;
    readonly warmupMs: number;
    readonly maxInFlight?: number;
  };

/** A request count summary. */
export interface RequestSummary {
  readonly total: number;
  readonly ok: number;
  readonly failed: number;
  readonly successRate: number;
}

/** Client-measured metrics. */
export interface ClientMetrics {
  readonly latencyMs: LatencyMs;
}

/** Server-reported metrics, read from the target's `stats` endpoint. */
export interface ServerMetrics {
  readonly signatureVerificationMs?: {
    readonly overall: PartialLatencyMs;
    readonly byStandard?: Record<string, PartialLatencyMs>;
  };
  readonly queue?: {
    readonly drainMs?: PartialLatencyMs;
    readonly depthMax?: number;
  };
}

/** An aggregated error bucket. */
export interface ErrorBucket {
  /** The error kind, e.g. `"http"` or `"network"`. */
  readonly kind: string;
  /** The HTTP status code, when applicable. */
  readonly status?: number;
  /** A short machine-readable reason. */
  readonly reason: string;
  /** How many times this error occurred. */
  readonly count: number;
}

/** A comparison operator in an evaluated expectation. */
export type ExpectOp = "lt" | "lte" | "gt" | "gte" | "eq";

/** An evaluated `expect` assertion. */
export interface ExpectResult {
  /** The metric name, e.g. `"latency.p95"`. */
  readonly metric: string;
  /** The comparison operator. */
  readonly op: ExpectOp;
  /** The normalized numeric threshold. */
  readonly threshold: number;
  /** The threshold's unit (`"ms"`, `"%"`, `"/s"`), or `null` for a count. */
  readonly unit: string | null;
  /** The measured value in the same normalized unit, or `null` if absent. */
  readonly actual: number | null;
  /** The assertion severity. */
  readonly severity: "warn" | "fail";
  /** Whether the assertion held. */
  readonly pass: boolean;
}

/** The result of one scenario. */
export interface ScenarioResult {
  readonly name: string;
  readonly type: ScenarioType;
  readonly load: LoadSummary;
  readonly requests: RequestSummary;
  readonly throughputPerSec: number;
  readonly deliveryThroughputPerSec?: number;
  readonly client: ClientMetrics;
  readonly server: ServerMetrics | null;
  readonly errors: ErrorBucket[];
  readonly expectations: ExpectResult[];
  readonly passed: boolean;
  /** The number of runs aggregated into this scenario result. */
  readonly runCount: number;
  /** Per-run measurements, present when a scenario was repeated. */
  readonly runs?: ScenarioRunResult[];
  /** An optional serialized client latency histogram for re-aggregation. */
  readonly histogram?: SerializedHistogram;
}

/** The measured result of one repeated scenario run. */
export interface ScenarioRunResult {
  readonly run: number;
  readonly requests: RequestSummary;
  readonly throughputPerSec: number;
  readonly deliveryThroughputPerSec?: number;
  readonly client: ClientMetrics;
  readonly server: ServerMetrics | null;
  readonly errors: ErrorBucket[];
  readonly histogram?: SerializedHistogram;
}

/** A complete benchmark report. */
export interface BenchReport {
  /** The published report schema URL. */
  readonly $schema?: string;
  readonly schemaVersion: 3;
  readonly tool: { readonly name: string; readonly version: string };
  readonly environment: Environment;
  readonly target: TargetInfo;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly suite: { readonly name?: string; readonly configHash: string };
  readonly passed: boolean;
  readonly scenarios: ScenarioResult[];
}
