/**
 * Reading server-side metrics from the cooperative `stats` endpoint.
 *
 * The endpoint returns a JSON projection of the target's OpenTelemetry meters
 * (see *@fedify/fedify*'s benchmark module).  This module projects the relevant
 * instruments — signature verification latency and queue depth — into the
 * report's `server` section, marked distinct from client-measured numbers.
 * @since 2.3.0
 * @module
 */

import { STATS_PATH } from "../discovery/probe.ts";
import type { PartialLatencyMs, ServerMetrics } from "../result/model.ts";

interface OtelHistogram {
  readonly buckets?: {
    readonly boundaries?: number[];
    readonly counts?: number[];
  };
  readonly count?: number;
  readonly sum?: number;
}

interface SnapshotMetric {
  readonly name?: string;
  readonly dataPointType?: string;
  readonly dataPoints?: ReadonlyArray<{
    readonly attributes?: Record<string, unknown>;
    readonly value?: number | OtelHistogram;
  }>;
}

interface Snapshot {
  readonly scopeMetrics?: ReadonlyArray<
    { readonly metrics?: SnapshotMetric[] }
  >;
}

/**
 * Parses a `stats` snapshot into the report's server metrics, or `null` when
 * the snapshot carries no relevant instruments.
 * @param snapshot The parsed `stats` JSON.
 * @returns The server metrics, or `null`.
 */
export function parseServerMetrics(snapshot: unknown): ServerMetrics | null {
  try {
    const metrics = flattenMetrics(snapshot as Snapshot);
    const result: {
      signatureVerificationMs?: { overall: PartialLatencyMs };
      queue?: { depthMax?: number };
    } = {};

    const signature = metrics.find((m) =>
      m.dataPointType === "histogram" &&
      (m.name ?? "").includes("signature.verification")
    );
    const merged = signature == null
      ? null
      : mergeHistogram(signature.dataPoints);
    if (merged != null) {
      result.signatureVerificationMs = {
        overall: {
          p50: histogramPercentile(merged, 50),
          p95: histogramPercentile(merged, 95),
          p99: histogramPercentile(merged, 99),
        },
      };
    }

    const depth = metrics.find((m) => m.name === "fedify.queue.depth");
    if (depth != null && Array.isArray(depth.dataPoints)) {
      const values = depth.dataPoints
        .map((p) => p.value)
        .filter((v): v is number => typeof v === "number");
      if (values.length > 0) result.queue = { depthMax: Math.max(...values) };
    }

    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

/**
 * Fetches and parses the target's server metrics.
 * @param target The target base URL.
 * @param fetchImpl The fetch implementation (overridable for tests).
 * @returns The server metrics, or `null` if unavailable.
 */
export async function fetchServerMetrics(
  target: URL,
  fetchImpl: typeof fetch = fetch,
): Promise<ServerMetrics | null> {
  try {
    const response = await fetchImpl(new URL(STATS_PATH, target));
    if (!response.ok) return null;
    return parseServerMetrics(await response.json());
  } catch {
    return null;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function flattenMetrics(snapshot: Snapshot): SnapshotMetric[] {
  const scopes = Array.isArray(snapshot?.scopeMetrics)
    ? snapshot.scopeMetrics
    : [];
  return scopes.flatMap((scope) =>
    Array.isArray(scope?.metrics) ? scope.metrics : []
  );
}

interface Histogram {
  readonly boundaries: number[];
  readonly counts: number[];
}

function mergeHistogram(
  dataPoints: SnapshotMetric["dataPoints"],
): Histogram | null {
  if (!Array.isArray(dataPoints)) return null;
  let boundaries: number[] | null = null;
  let counts: number[] | null = null;
  for (const point of dataPoints) {
    const value = point?.value;
    if (typeof value !== "object" || value == null) continue;
    const b = value.buckets?.boundaries;
    const c = value.buckets?.counts;
    if (!Array.isArray(b) || !Array.isArray(c)) continue;
    if (!b.every(isFiniteNumber) || !c.every(isFiniteNumber)) continue;
    if (boundaries == null) {
      boundaries = [...b];
      counts = [...c];
    } else if (counts != null && counts.length === c.length) {
      for (let i = 0; i < c.length; i++) counts[i] += c[i];
    }
  }
  return boundaries != null && counts != null ? { boundaries, counts } : null;
}

function histogramPercentile(histogram: Histogram, p: number): number {
  const { boundaries, counts } = histogram;
  const total = counts.reduce((sum, n) => sum + n, 0);
  if (total === 0) return 0;
  const target = Math.ceil((p / 100) * total);
  let accumulated = 0;
  for (let i = 0; i < counts.length; i++) {
    accumulated += counts[i];
    if (accumulated >= target) {
      // Estimate by the bucket's upper boundary; the last bucket is unbounded,
      // so fall back to the highest boundary.
      return i < boundaries.length
        ? boundaries[i]
        : boundaries[boundaries.length - 1] ?? 0;
    }
  }
  return boundaries[boundaries.length - 1] ?? 0;
}
