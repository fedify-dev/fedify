import { Activity, Object as VocabObject, type Recipient } from "@fedify/vocab";
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
import type { Context } from "./context.ts";
import { extractInboxes } from "./send.ts";

/**
 * Metric reader owned by `benchmarkMode`.
 * @since 2.3.0
 */
export class BenchmarkMetricReader extends MetricReader {
  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }

  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Creates the in-process OpenTelemetry meter provider used by benchmark mode.
 * @returns The meter provider and the metric reader attached to it.
 * @since 2.3.0
 */
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

/**
 * A serialized snapshot of all benchmark-mode OpenTelemetry metrics.
 *
 * The `scopeMetrics` field contains the collected metrics grouped by
 * instrumentation scope.  The `errors` field contains stringified collection
 * errors reported by the metric reader.
 * @since 2.3.0
 */
export interface BenchmarkMetricSnapshot {
  /** The schema version of this snapshot shape. */
  readonly version: 1;
  /** The snapshot source.  Always `"server"` for Fedify benchmark targets. */
  readonly source: "server";
  /** The ISO 8601 time when the snapshot was generated. */
  readonly generatedAt: string;
  /** Metrics grouped by OpenTelemetry instrumentation scope. */
  readonly scopeMetrics: readonly BenchmarkScopeMetrics[];
  /** Stringified metric collection errors, if any. */
  readonly errors: readonly string[];
}

/**
 * Metrics collected from one OpenTelemetry instrumentation scope.
 * @since 2.3.0
 */
export interface BenchmarkScopeMetrics {
  /** The OpenTelemetry instrumentation scope descriptor. */
  readonly scope: {
    /** The instrumentation scope name. */
    readonly name: string;
    /** The instrumentation scope version, if provided. */
    readonly version?: string;
  };
  /** The metrics emitted by the scope. */
  readonly metrics: readonly BenchmarkMetric[];
}

/**
 * A serialized OpenTelemetry metric in a benchmark snapshot.
 * @since 2.3.0
 */
export interface BenchmarkMetric {
  /** The OpenTelemetry metric name. */
  readonly name: string;
  /** The OpenTelemetry metric description. */
  readonly description: string;
  /** The OpenTelemetry metric unit, such as `ms` or `{count}`. */
  readonly unit: string;
  /** The metric data point kind. */
  readonly dataPointType:
    | "histogram"
    | "exponential_histogram"
    | "gauge"
    | "sum";
  /** The serialized data points for the metric. */
  readonly dataPoints: readonly BenchmarkDataPoint[];
}

/**
 * A serialized OpenTelemetry metric data point.
 *
 * The timestamp fields use OpenTelemetry high-resolution time tuples.
 * Histogram values preserve their SDK histogram shape, including bucket
 * boundaries and counts.
 * @since 2.3.0
 */
export interface BenchmarkDataPoint {
  /** The metric attributes attached to the data point. */
  readonly attributes: Record<string, unknown>;
  /** The OpenTelemetry data point start time. */
  readonly startTime: readonly [number, number];
  /** The OpenTelemetry data point end time. */
  readonly endTime: readonly [number, number];
  /** The data point value or histogram payload. */
  readonly value:
    | number
    | Histogram
    | ExponentialHistogram;
}

/**
 * Collects and serializes benchmark-mode metrics from a benchmark reader.
 * @param reader The benchmark metric reader to collect from.
 * @returns A server metric snapshot with any collection errors stringified.
 * @since 2.3.0
 */
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

/**
 * Handles `GET /.well-known/fedify/bench/stats`.
 * @param request The HTTP request to handle.
 * @param reader The benchmark metric reader to collect from.
 * @returns A JSON metric snapshot response, or `405 Method Not Allowed`.
 * @since 2.3.0
 */
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
  return jsonResponse(await collectBenchmarkMetrics(reader));
}

/**
 * Handles `POST /.well-known/fedify/bench/trigger`.
 *
 * The handler validates a benchmark trigger request, checks recipients against
 * server-controlled trigger options, and calls `Context.sendActivity()` to use
 * the target's normal outbox path.
 * @param request The HTTP request to handle.
 * @param context The Fedify context used to resolve actors and send activity.
 * @param options Server-controlled benchmark trigger delivery options.
 * @returns A JSON response describing the sent activity, or a validation error.
 * @since 2.3.0
 */
export async function handleBenchmarkTrigger<TContextData>(
  request: Request,
  context: Context<TContextData>,
  options: BenchmarkTriggerOptions = {},
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { "Allow": "POST" },
    });
  }
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON request body." }, 400);
  }
  try {
    const body = asRecord(json, "request body");
    const sender = parseSender(body.sender);
    const recipients = await parseRecipients(body.recipients, context);
    const activity = await parseActivity(body.activity, context);
    if (activity.id == null) {
      throw new BenchmarkTriggerError("activity must have an id.");
    }
    const activityId = activity.id.href;
    const inboxes = extractInboxes({ recipients });
    const inboxUrls = Object.keys(inboxes);
    if (inboxUrls.length < 1) {
      throw new BenchmarkTriggerError(
        "No valid recipient inboxes found. The recipients list must not be empty.",
      );
    }
    const unsafeInboxes = options.allowUnsafeRecipients
      ? []
      : inboxUrls.filter((inbox) => !options.sinks?.has(inbox));
    if (unsafeInboxes.length > 0) {
      return jsonResponse(
        {
          error: "unsafe_recipient",
          unsafeInboxes,
        },
        403,
      );
    }
    await context.sendActivity(sender, recipients, activity);
    return jsonResponse(
      {
        version: 1,
        activityId,
        queueCorrelationId: activityId,
        recipientCount: recipients.length,
        inboxCount: inboxUrls.length,
      },
      202,
    );
  } catch (error) {
    if (error instanceof BenchmarkTriggerError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    throw error;
  }
}

/**
 * Server-controlled options for benchmark trigger delivery.
 * @since 2.3.0
 */
export interface BenchmarkTriggerOptions {
  /** Inbox URLs that the trigger endpoint may deliver to. */
  readonly sinks?: ReadonlySet<string>;
  /**
   * Whether recipients outside {@link BenchmarkTriggerOptions.sinks} may be
   * used.
   */
  readonly allowUnsafeRecipients?: boolean;
}

class BenchmarkTriggerError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

type BenchmarkSender = { identifier: string } | { username: string };

function parseSender(value: unknown): BenchmarkSender {
  const sender = asRecord(value, "sender");
  if (typeof sender.identifier === "string") {
    return { identifier: sender.identifier };
  }
  if (typeof sender.username === "string") {
    return { username: sender.username };
  }
  throw new BenchmarkTriggerError(
    "sender must be { identifier } or { username }.",
  );
}

async function parseRecipients<TContextData>(
  value: unknown,
  context: Context<TContextData>,
): Promise<Recipient[]> {
  if (!Array.isArray(value)) {
    throw new BenchmarkTriggerError("recipients must be an array.");
  }
  return await Promise.all(value.map(async (item) => {
    let object: VocabObject;
    try {
      object = await VocabObject.fromJsonLd(item, {
        documentLoader: context.documentLoader,
        contextLoader: context.contextLoader,
      });
    } catch (error) {
      throw new BenchmarkTriggerError(
        `Invalid ActivityPub recipient: ${error}`,
      );
    }
    if (!isRecipient(object)) {
      throw new BenchmarkTriggerError(
        "each recipient must be an ActivityPub actor.",
      );
    }
    const recipient: Recipient = object;
    if (recipient.id == null || recipient.inboxId == null) {
      throw new BenchmarkTriggerError(
        "each recipient must have id and inbox properties.",
      );
    }
    return recipient;
  }));
}

function isRecipient(value: unknown): value is Recipient {
  return value != null && typeof value === "object" && "id" in value &&
    "inboxId" in value;
}

async function parseActivity<TContextData>(
  value: unknown,
  context: Context<TContextData>,
): Promise<Activity> {
  try {
    return await Activity.fromJsonLd(value, {
      documentLoader: context.documentLoader,
      contextLoader: context.contextLoader,
    });
  } catch (error) {
    throw new BenchmarkTriggerError(`Invalid ActivityPub activity: ${error}`);
  }
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new BenchmarkTriggerError(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
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
