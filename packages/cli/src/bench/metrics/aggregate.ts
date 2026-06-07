/**
 * Aggregation of raw load-generator samples into the client side of a scenario
 * measurement: request counts, throughput, the latency distribution, and
 * grouped errors.  Warm-up samples are excluded from every figure.
 * @since 2.3.0
 * @module
 */

import type { Sample } from "../load/generator.ts";
import type {
  ClientMetrics,
  ErrorBucket,
  RequestSummary,
} from "../result/model.ts";
import type { ScenarioMeasurement } from "../result/build.ts";
import { LogLinearHistogram } from "./histogram.ts";

/** Options for {@link aggregateSamples}. */
export interface AggregateOptions {
  /** The measured window (excluding warm-up) in ms, used for throughput. */
  readonly measuredWindowMs: number;
  /** Whether to include the serialized latency histogram in the result. */
  readonly includeHistogram?: boolean;
}

/**
 * Aggregates samples into the client side of a scenario measurement (the
 * `server` field is left `null` for the runner to fill from the stats endpoint).
 * @param samples The raw samples from the load generator.
 * @param options Aggregation options.
 * @returns The client-side scenario measurement.
 */
export function aggregateSamples(
  samples: readonly Sample[],
  options: AggregateOptions,
): ScenarioMeasurement {
  const measured = samples.filter((s) => !s.warmup);
  const histogram = new LogLinearHistogram();
  const errorCounts = new Map<string, ErrorBucket>();
  let ok = 0;
  for (const sample of measured) {
    histogram.record(sample.latencyMs);
    if (sample.outcome.ok) {
      ok++;
    } else {
      bucketError(errorCounts, sample);
    }
  }
  const total = measured.length;
  const requests: RequestSummary = {
    total,
    ok,
    failed: total - ok,
    successRate: total === 0 ? 1 : ok / total,
  };
  const windowSec = Math.max(options.measuredWindowMs, 1) / 1000;
  const client: ClientMetrics = {
    latencyMs: {
      p50: histogram.percentile(50),
      p95: histogram.percentile(95),
      p99: histogram.percentile(99),
      mean: histogram.mean,
      max: histogram.max,
    },
  };
  const errors = [...errorCounts.values()].sort((a, b) => b.count - a.count);
  return {
    requests,
    throughputPerSec: total / windowSec,
    client,
    server: null,
    errors,
    ...(options.includeHistogram ? { histogram: histogram.toJSON() } : {}),
  };
}

function bucketError(
  buckets: Map<string, ErrorBucket>,
  sample: Sample,
): void {
  const { status, errorKind, reason } = sample.outcome;
  const kind = errorKind ?? (status != null ? "http" : "error");
  const reasonText = reason ?? (status != null ? `status_${status}` : "error");
  const key = `${kind}|${status ?? ""}|${reasonText}`;
  const existing = buckets.get(key);
  if (existing != null) {
    buckets.set(key, { ...existing, count: existing.count + 1 });
  } else {
    buckets.set(key, {
      kind,
      ...(status != null ? { status } : {}),
      reason: reasonText,
      count: 1,
    });
  }
}
