/**
 * Evaluation of a scenario's `expect` block against its measured metrics.
 *
 * Each assertion becomes an {@link ExpectResult}; the gate passes when every
 * `fail`-severity assertion holds (`warn`-severity assertions annotate without
 * failing the build).
 * @since 2.3.0
 * @module
 */

import type { ExpectBlock } from "../../scenario/types.ts";
import type {
  ErrorBucket,
  ExpectResult,
  LatencyMs,
  PartialLatencyMs,
  ScenarioResult,
} from "../model.ts";
import { AssertionParseError, compare, parseAssertion } from "./assert.ts";
import { type MetricUnit, metricUnit } from "./metrics.ts";

/**
 * Parses every assertion in an `expect` block, throwing on the first malformed
 * one.  Run during preflight so that a typo in a CI gate is reported as a
 * configuration error before any load is sent, instead of crashing the run with
 * an uncaught {@link AssertionParseError} after the traffic has already gone out.
 * @param expect The scenario's `expect` block.
 * @throws {AssertionParseError} If an entry has no assertion string or its
 *         assertion cannot be parsed.
 */
export function validateExpectBlock(expect: ExpectBlock): void {
  for (const [metric, value] of Object.entries(expect)) {
    const assertion = typeof value === "string" ? value : value.assert;
    if (typeof assertion !== "string") {
      throw new AssertionParseError(
        `The \`expect\` entry for "${metric}" has no assertion string.`,
      );
    }
    try {
      parseAssertion(assertion);
    } catch (error) {
      if (!(error instanceof AssertionParseError)) throw error;
      throw new AssertionParseError(
        `Invalid \`expect\` assertion for "${metric}": ${
          JSON.stringify(assertion)
        }.`,
      );
    }
  }
}

/** The subset of a scenario result that `expect` metrics are looked up from. */
export type MetricView = Pick<
  ScenarioResult,
  "requests" | "throughputPerSec" | "client" | "server" | "errors"
>;

/** The outcome of evaluating an `expect` block. */
export interface ExpectEvaluation {
  readonly results: ExpectResult[];
  readonly passed: boolean;
}

/**
 * Evaluates an `expect` block against measured metrics.
 * @param expect The scenario's `expect` block.
 * @param metrics The measured metrics to evaluate against.
 * @returns The evaluated assertions and whether the gate passed.
 */
export function evaluateExpect(
  expect: ExpectBlock,
  metrics: MetricView,
): ExpectEvaluation {
  const results: ExpectResult[] = [];
  for (const [metric, value] of Object.entries(expect)) {
    const assertion = typeof value === "string" ? value : value.assert;
    const severity = typeof value === "string"
      ? "fail"
      : value.severity ?? "fail";
    const { op, threshold, unit } = parseAssertion(assertion);
    const lookup = lookupMetric(metrics, metric);
    const actual = lookup?.value ?? null;
    const pass = lookup != null && actual != null &&
      unitCompatible(unit, lookup.unit) &&
      compare(actual, op, threshold, lookup.unit !== "count");
    results.push({ metric, op, threshold, unit, actual, severity, pass });
  }
  const passed = results.every((r) => r.severity === "warn" || r.pass);
  return { results, passed };
}

interface MetricLookup {
  /** The measured value, or `null` if the metric was not measured. */
  readonly value: number | null;
  /** The metric's natural unit. */
  readonly unit: MetricUnit;
}

/**
 * Whether an assertion's (normalized) unit is compatible with a metric's
 * natural unit.  A unitless assertion is always compatible.
 */
function unitCompatible(
  assertionUnit: string | null,
  unit: MetricUnit,
): boolean {
  if (assertionUnit == null) return true;
  switch (unit) {
    case "ratio":
      return assertionUnit === "%";
    case "ms":
      return assertionUnit === "ms";
    case "rate":
      return assertionUnit === "/s";
    case "count":
      return false;
  }
}

function lookupMetric(
  metrics: MetricView,
  metric: string,
): MetricLookup | null {
  const unit = metricUnit(metric);
  if (unit == null) return null; // Unknown metric name.
  return { value: lookupValue(metrics, metric), unit };
}

function lookupValue(metrics: MetricView, metric: string): number | null {
  switch (metric) {
    case "successRate":
      return metrics.requests.successRate;
    case "throughputPerSec":
      return metrics.throughputPerSec;
    case "deliveryThroughput":
      return metrics.throughputPerSec;
    case "errors.total":
      return sumErrors(metrics.errors);
    case "errors.4xx":
      return sumErrors(metrics.errors, { min: 400, max: 500 });
    case "errors.5xx":
      return sumErrors(metrics.errors, { min: 500, max: 600 });
  }
  if (metric.startsWith("latency.")) {
    return latencyField(metrics.client.latencyMs, metric.slice(8));
  }
  if (metric.startsWith("signatureVerification.")) {
    return partialField(
      metrics.server?.signatureVerificationMs?.overall,
      metric.slice("signatureVerification.".length),
    );
  }
  if (metric.startsWith("queueDrain.")) {
    return partialField(
      metrics.server?.queue?.drainMs,
      metric.slice("queueDrain.".length),
    );
  }
  return null;
}

function latencyField(latency: LatencyMs, key: string): number | null {
  switch (key) {
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

function partialField(
  source: PartialLatencyMs | undefined,
  key: string,
): number | null {
  if (source == null) return null;
  switch (key) {
    case "p50":
      return source.p50 ?? null;
    case "p95":
      return source.p95 ?? null;
    case "p99":
      return source.p99 ?? null;
    default:
      return null;
  }
}

/**
 * Sums error counts, optionally restricted to a half-open HTTP status range.
 * The bounds are a single coupled argument so a caller cannot pass one without
 * the other.
 */
function sumErrors(
  errors: ErrorBucket[],
  range?: { readonly min: number; readonly max: number },
): number {
  let total = 0;
  for (const error of errors) {
    if (range == null) {
      total += error.count;
    } else if (
      error.status != null && error.status >= range.min &&
      error.status < range.max
    ) {
      total += error.count;
    }
  }
  return total;
}
