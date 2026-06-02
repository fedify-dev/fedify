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

export async function handleBenchmarkTrigger<TContextData>(
  request: Request,
  context: Context<TContextData>,
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
    const sinks = parseSinks(body.sinks);
    const recipients = await parseRecipients(body.recipients, context);
    const activity = await parseActivity(body.activity, context);
    const inboxes = extractInboxes({ recipients });
    const inboxUrls = Object.keys(inboxes);
    const unsafeInboxes = inboxUrls.filter((inbox) => !sinks.has(inbox));
    if (unsafeInboxes.length > 0 && body.allowUnsafeRecipients !== true) {
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
        activityId: activity.id?.href ?? null,
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

function parseSinks(value: unknown): Set<string> {
  if (!Array.isArray(value)) {
    throw new BenchmarkTriggerError("sinks must be an array of inbox URLs.");
  }
  return new Set(value.map((sink) => {
    if (typeof sink !== "string") {
      throw new BenchmarkTriggerError("sinks must contain only URL strings.");
    }
    try {
      return new URL(sink).href;
    } catch {
      throw new BenchmarkTriggerError("sinks must contain only valid URLs.");
    }
  }));
}

async function parseRecipients<TContextData>(
  value: unknown,
  context: Context<TContextData>,
): Promise<Recipient[]> {
  if (!Array.isArray(value)) {
    throw new BenchmarkTriggerError("recipients must be an array.");
  }
  const recipients: Recipient[] = [];
  for (const item of value) {
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
    recipients.push(recipient);
  }
  return recipients;
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
