/**
 * The single registry mapping `expect` metric names to their natural unit.
 *
 * Both the evaluator (for unit-compatibility checks) and the renderers (for
 * displaying measured values in the metric's own unit) read from here, so the
 * two never disagree about what `latency.p95` or `successRate` mean.
 * @since 2.3.0
 * @module
 */

/** The natural unit class of a metric. */
export type MetricUnit = "ratio" | "ms" | "rate" | "count";

/**
 * Returns the natural unit class of a metric, or `null` if the metric name is
 * not recognized.
 * @param metric The metric name, e.g. `"latency.p95"`.
 */
export function metricUnit(metric: string): MetricUnit | null {
  switch (metric) {
    case "successRate":
      return "ratio";
    case "throughputPerSec":
    case "deliveryThroughput":
      return "rate";
    case "errors.total":
    case "errors.4xx":
    case "errors.5xx":
      return "count";
  }
  if (
    metric.startsWith("latency.") ||
    metric.startsWith("signatureVerification.") ||
    metric.startsWith("queueDrain.")
  ) {
    return "ms";
  }
  return null;
}

/**
 * Returns the human display unit for a metric (`"%"`, `"ms"`, `"/s"`), or
 * `null` for counts and unknown metrics.
 * @param metric The metric name.
 */
export function metricDisplayUnit(metric: string): string | null {
  switch (metricUnit(metric)) {
    case "ratio":
      return "%";
    case "ms":
      return "ms";
    case "rate":
      return "/s";
    default:
      return null;
  }
}
