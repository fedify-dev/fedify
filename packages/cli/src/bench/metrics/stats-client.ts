/**
 * Reading server-side metrics from the cooperative `stats` endpoint.
 *
 * The endpoint returns a JSON projection of the target's OpenTelemetry meters
 * (see *@fedify/fedify*'s benchmark module).  This module projects the relevant
 * instruments — signature verification latency and queue depth — into the
 * report's `server` section, marked distinct from client-measured numbers.
 *
 * The server reader is cumulative and has no reset, so a single snapshot covers
 * the target's whole lifetime.  To scope server numbers to one scenario's
 * measured window, callers take a {@link ServerSnapshot} baseline at the window
 * start and another at the end, {@link diffSnapshots} the two, and project the
 * difference with {@link snapshotToMetrics}.
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

/** An explicit-bucket histogram: bucket upper boundaries and their counts. */
export interface ServerHistogram {
  readonly boundaries: number[];
  readonly counts: number[];
}

/**
 * The relevant instruments extracted from a `stats` snapshot, kept in raw
 * (un-projected) form so that two snapshots can be diffed.
 */
export interface ServerSnapshot {
  /** The signature-verification latency histogram, or `null` if absent. */
  readonly signature: ServerHistogram | null;
  /** The maximum observed queue depth, or `null` if absent. */
  readonly queueDepthMax: number | null;
  /** Queue task counters, or `null` if absent. */
  readonly queueTasks?: QueueTaskCounts | null;
}

/** Queue task counts extracted from benchmark stats. */
export interface QueueTaskCounts {
  readonly enqueued: number;
  readonly completed: number;
  readonly failed: number;
}

/**
 * Parses a `stats` snapshot into raw server instruments.  A successful parse
 * always yields a snapshot, even when it carries no relevant instruments (both
 * fields `null`); `null` is reserved for an unparseable snapshot, so callers can
 * tell "available but empty" apart from "unavailable".
 * @param snapshot The parsed `stats` JSON.
 * @returns The raw server snapshot, or `null` if it could not be parsed.
 */
export function parseServerSnapshot(snapshot: unknown): ServerSnapshot | null {
  try {
    const metrics = flattenMetrics(snapshot as Snapshot);

    const sig = metrics.find((m) =>
      m.dataPointType === "histogram" &&
      (m.name ?? "").includes("signature.verification")
    );
    const signature = sig == null ? null : mergeHistogram(sig.dataPoints);

    let queueDepthMax: number | null = null;
    const depth = metrics.find((m) => m.name === "fedify.queue.depth");
    if (depth != null && Array.isArray(depth.dataPoints)) {
      const values = depth.dataPoints.map((p) => p.value).filter(
        isFiniteNumber,
      );
      if (values.length > 0) queueDepthMax = Math.max(...values);
    }

    const queueTasks = parseQueueTasks(metrics);

    return {
      signature,
      queueDepthMax,
      ...(queueTasks == null ? {} : { queueTasks }),
    };
  } catch {
    return null;
  }
}

/**
 * Subtracts a baseline snapshot from an end snapshot, yielding the instruments
 * accumulated between the two (the measured window).  Signature histogram
 * counts are diffed bucket by bucket; the queue depth is a gauge, not a
 * cumulative count, so the end value is kept as-is.  Callers that cannot obtain
 * both snapshots should not call this (and should report no server metrics)
 * rather than passing a stand-in, since a missing baseline cannot be diffed.
 * @param baseline The snapshot taken at the measured-window start.
 * @param end The snapshot taken at the measured-window end.
 * @returns The windowed snapshot.
 */
export function diffSnapshots(
  baseline: ServerSnapshot,
  end: ServerSnapshot,
): ServerSnapshot {
  const queueTasks = diffQueueTasks(
    baseline.queueTasks ?? null,
    end.queueTasks ?? null,
  );
  return {
    signature: diffHistogram(baseline.signature, end.signature),
    queueDepthMax: end.queueDepthMax,
    ...(queueTasks == null ? {} : { queueTasks }),
  };
}

/**
 * Projects a raw server snapshot into the report's server metrics, or `null`
 * when it carries no usable measurement.
 * @param snapshot The raw (optionally diffed) server snapshot.
 * @returns The projected server metrics, or `null`.
 */
export function snapshotToMetrics(
  snapshot: ServerSnapshot | null,
): ServerMetrics | null {
  if (snapshot == null) return null;
  const result: {
    signatureVerificationMs?: { overall: PartialLatencyMs };
    queue?: { depthMax?: number };
  } = {};

  if (snapshot.signature != null) {
    const total = snapshot.signature.counts.reduce((sum, n) => sum + n, 0);
    if (total > 0) {
      result.signatureVerificationMs = {
        overall: {
          p50: histogramPercentile(snapshot.signature, 50),
          p95: histogramPercentile(snapshot.signature, 95),
          p99: histogramPercentile(snapshot.signature, 99),
        },
      };
    }
  }
  if (snapshot.queueDepthMax != null) {
    result.queue = { depthMax: snapshot.queueDepthMax };
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Parses a `stats` snapshot directly into the report's server metrics, or
 * `null` when no relevant instruments are present.  Equivalent to
 * `snapshotToMetrics(parseServerSnapshot(snapshot))`.
 * @param snapshot The parsed `stats` JSON.
 * @returns The server metrics, or `null`.
 */
export function parseServerMetrics(snapshot: unknown): ServerMetrics | null {
  return snapshotToMetrics(parseServerSnapshot(snapshot));
}

/**
 * Fetches and parses the target's raw server snapshot.
 * @param target The target base URL.
 * @param fetchImpl The fetch implementation (overridable for tests).
 * @returns The raw server snapshot, or `null` if unavailable.
 */
export async function fetchServerSnapshot(
  target: URL,
  fetchImpl: typeof fetch = fetch,
): Promise<ServerSnapshot | null> {
  try {
    // Do not follow redirects: the stats reading must come from the target
    // itself, not from wherever a redirect points.
    const response = await fetchImpl(new URL(STATS_PATH, target), {
      redirect: "manual",
    });
    if (!response.ok) return null;
    return parseServerSnapshot(await response.json());
  } catch {
    return null;
  }
}

/**
 * Fetches and projects the target's server metrics from a single snapshot.
 * @param target The target base URL.
 * @param fetchImpl The fetch implementation (overridable for tests).
 * @returns The server metrics, or `null` if unavailable.
 */
export async function fetchServerMetrics(
  target: URL,
  fetchImpl: typeof fetch = fetch,
): Promise<ServerMetrics | null> {
  return snapshotToMetrics(await fetchServerSnapshot(target, fetchImpl));
}

/** Returns the queue task backlog represented by a diffed snapshot. */
export function queueTaskRemaining(
  snapshot: ServerSnapshot | null,
): number | null {
  if (snapshot?.queueTasks == null) return null;
  const { enqueued, completed, failed } = snapshot.queueTasks;
  return Math.max(0, enqueued - completed - failed);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function flattenMetrics(snapshot: Snapshot): SnapshotMetric[] {
  const scopes = Array.isArray(snapshot?.scopeMetrics)
    ? snapshot.scopeMetrics
    : [];
  return scopes.flatMap((scope) => {
    const metrics = scope?.metrics;
    // Drop null/undefined entries so one malformed element does not make the
    // whole snapshot parse throw and silently omit every server metric.
    return Array.isArray(metrics) ? metrics.filter((m) => m != null) : [];
  });
}

function mergeHistogram(
  dataPoints: SnapshotMetric["dataPoints"],
): ServerHistogram | null {
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
    } else if (
      counts != null && counts.length === c.length &&
      boundaries.length === b.length && boundaries.every((v, i) => v === b[i])
    ) {
      // Only sum data points that share the exact same bucketing; differing
      // boundaries would misalign the counts and skew the percentiles.
      for (let i = 0; i < c.length; i++) counts[i] += c[i];
    }
  }
  return boundaries != null && counts != null ? { boundaries, counts } : null;
}

function parseQueueTasks(
  metrics: readonly SnapshotMetric[],
): QueueTaskCounts | null {
  const enqueued = sumMetric(metrics, "fedify.queue.task.enqueued");
  const completed = sumMetric(metrics, "fedify.queue.task.completed");
  const failed = sumMetric(metrics, "fedify.queue.task.failed");
  return enqueued == null && completed == null && failed == null ? null : {
    enqueued: enqueued ?? 0,
    completed: completed ?? 0,
    failed: failed ?? 0,
  };
}

function sumMetric(
  metrics: readonly SnapshotMetric[],
  name: string,
): number | null {
  let total = 0;
  let found = false;
  for (const metric of metrics) {
    if (metric.name !== name || !Array.isArray(metric.dataPoints)) continue;
    for (const point of metric.dataPoints) {
      if (isFiniteNumber(point.value)) {
        total += point.value;
        found = true;
      }
    }
  }
  return found ? total : null;
}

function diffHistogram(
  baseline: ServerHistogram | null,
  end: ServerHistogram | null,
): ServerHistogram | null {
  if (end == null) return null;
  // A null baseline means nothing was recorded before the window opened, so the
  // whole end histogram belongs to the window.
  if (baseline == null) return end;
  // Two cumulative snapshots of the same instrument share fixed bucket
  // boundaries; if they somehow disagree, the buckets are not comparable, so
  // refuse to subtract rather than misattribute counts.
  if (!histogramsCompatible(baseline, end)) return null;
  const counts = end.counts.map((count, i) =>
    Math.max(0, count - baseline.counts[i])
  );
  return { boundaries: end.boundaries, counts };
}

function diffQueueTasks(
  baseline: QueueTaskCounts | null,
  end: QueueTaskCounts | null,
): QueueTaskCounts | null {
  if (end == null) return null;
  if (baseline == null) return end;
  return {
    enqueued: Math.max(0, end.enqueued - baseline.enqueued),
    completed: Math.max(0, end.completed - baseline.completed),
    failed: Math.max(0, end.failed - baseline.failed),
  };
}

function histogramsCompatible(
  a: ServerHistogram,
  b: ServerHistogram,
): boolean {
  return a.boundaries.length === b.boundaries.length &&
    a.counts.length === b.counts.length &&
    a.boundaries.every((boundary, i) => boundary === b.boundaries[i]);
}

function histogramPercentile(histogram: ServerHistogram, p: number): number {
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
