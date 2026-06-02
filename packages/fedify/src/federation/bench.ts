import {
  DataPointType,
  type ExponentialHistogram,
  type Histogram,
  MeterProvider,
  type MetricData,
  MetricReader,
  type ResourceMetrics,
  type ScopeMetrics,
} from "@opentelemetry/sdk-metrics";

/**
 * Metric reader owned by `benchmarkMode`.
 */
export class BenchmarkMetricReader extends MetricReader {
  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }

  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

export function createBenchmarkMeterProvider(): {
  readonly meterProvider: MeterProvider;
  readonly reader: BenchmarkMetricReader;
} {
  const reader = new BenchmarkMetricReader();
  return {
    meterProvider: new MeterProvider({ readers: [reader] }),
    reader,
  };
}

export interface BenchmarkMetricSnapshot {
  readonly version: 1;
  readonly source: "server";
  readonly generatedAt: string;
  readonly scopeMetrics: readonly BenchmarkScopeMetrics[];
  readonly errors: readonly string[];
}

export interface BenchmarkScopeMetrics {
  readonly scope: {
    readonly name: string;
    readonly version?: string;
  };
  readonly metrics: readonly BenchmarkMetric[];
}

export interface BenchmarkMetric {
  readonly name: string;
  readonly description: string;
  readonly unit: string;
  readonly dataPointType:
    | "histogram"
    | "exponential_histogram"
    | "gauge"
    | "sum";
  readonly dataPoints: readonly BenchmarkDataPoint[];
}

export interface BenchmarkDataPoint {
  readonly attributes: Record<string, unknown>;
  readonly startTime: readonly [number, number];
  readonly endTime: readonly [number, number];
  readonly value:
    | number
    | Histogram
    | ExponentialHistogram;
}

export async function collectBenchmarkMetrics(
  reader: BenchmarkMetricReader,
): Promise<BenchmarkMetricSnapshot> {
  const result = await reader.collect();
  return {
    version: 1,
    source: "server",
    generatedAt: new Date().toISOString(),
    scopeMetrics: serializeScopeMetrics(result.resourceMetrics),
    errors: result.errors.map((error) => String(error)),
  };
}

export async function handleBenchmarkStats(
  request: Request,
  reader: BenchmarkMetricReader,
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { "Allow": "GET" },
    });
  }
  return new Response(JSON.stringify(await collectBenchmarkMetrics(reader)), {
    headers: { "Content-Type": "application/json" },
  });
}

function serializeScopeMetrics(
  resourceMetrics: ResourceMetrics,
): readonly BenchmarkScopeMetrics[] {
  return resourceMetrics.scopeMetrics.map(serializeScope);
}

function serializeScope(scopeMetrics: ScopeMetrics): BenchmarkScopeMetrics {
  return {
    scope: {
      name: scopeMetrics.scope.name,
      version: scopeMetrics.scope.version,
    },
    metrics: scopeMetrics.metrics.map(serializeMetric),
  };
}

function serializeMetric(metric: MetricData): BenchmarkMetric {
  return {
    name: metric.descriptor.name,
    description: metric.descriptor.description,
    unit: metric.descriptor.unit,
    dataPointType: serializeDataPointType(metric.dataPointType),
    dataPoints: metric.dataPoints.map((point) => ({
      attributes: { ...point.attributes },
      startTime: point.startTime,
      endTime: point.endTime,
      value: point.value,
    })),
  };
}

function serializeDataPointType(
  dataPointType: DataPointType,
): BenchmarkMetric["dataPointType"] {
  switch (dataPointType) {
    case DataPointType.HISTOGRAM:
      return "histogram";
    case DataPointType.EXPONENTIAL_HISTOGRAM:
      return "exponential_histogram";
    case DataPointType.GAUGE:
      return "gauge";
    case DataPointType.SUM:
      return "sum";
  }
}
