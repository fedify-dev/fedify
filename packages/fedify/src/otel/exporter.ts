import { getLogger } from "@logtape/logtape";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { ExportResultCode } from "@opentelemetry/core";
import type { KvKey, KvStore, KvStoreSetOptions } from "../federation/kv.ts";

/**
 * The direction of an activity in the trace.
 *
 * @since 1.10.0
 */
export type ActivityDirection = "inbound" | "outbound";

/**
 * Signature verification details for an inbound activity.
 *
 * @since 1.10.0
 */
export interface SignatureVerificationDetails {
  /**
   * Whether HTTP Signatures were verified.
   */
  readonly httpSignaturesVerified: boolean;

  /**
   * The key ID used for HTTP signature verification, if available.
   */
  readonly httpSignaturesKeyId?: string;

  /**
   * The reason why HTTP signature verification failed, if available.
   */
  readonly httpSignaturesFailureReason?: string;

  /**
   * The HTTP status code from a failed key fetch, if available.
   */
  readonly httpSignaturesKeyFetchStatus?: number;

  /**
   * The error type from a non-HTTP key fetch failure, if available.
   */
  readonly httpSignaturesKeyFetchError?: string;

  /**
   * Whether Linked Data Signatures were verified.
   */
  readonly ldSignaturesVerified: boolean;
}

/**
 * A record of an activity captured from a trace span.
 * This interface stores the activity data along with trace context
 * for distributed tracing support.
 *
 * @since 1.10.0
 */
export interface TraceActivityRecord {
  /**
   * The trace ID from OpenTelemetry.
   */
  readonly traceId: string;

  /**
   * The span ID from OpenTelemetry.
   */
  readonly spanId: string;

  /**
   * The parent span ID, if any.
   */
  readonly parentSpanId?: string;

  /**
   * Whether this is an inbound or outbound activity.
   */
  readonly direction: ActivityDirection;

  /**
   * The ActivityPub activity type (e.g., "Create", "Follow", "Like").
   */
  readonly activityType: string;

  /**
   * The activity's ID URL, if present.
   */
  readonly activityId?: string;

  /**
   * The actor ID URL (sender of the activity).
   */
  readonly actorId?: string;

  /**
   * The full JSON representation of the activity.
   */
  readonly activityJson: string;

  /**
   * Whether the activity was verified (for inbound activities).
   */
  readonly verified?: boolean;

  /**
   * Detailed signature verification information (for inbound activities).
   */
  readonly signatureDetails?: SignatureVerificationDetails;

  /**
   * The timestamp when this record was created (ISO 8601 format).
   */
  readonly timestamp: string;

  /**
   * The target inbox URL (for outbound activities).
   */
  readonly inboxUrl?: string;
}

/**
 * Summary information about a trace.
 *
 * @since 1.10.0
 */
export interface TraceSummary {
  /**
   * The trace ID.
   */
  readonly traceId: string;

  /**
   * The timestamp of the first activity in the trace.
   */
  readonly timestamp: string;

  /**
   * The number of activities in the trace.
   */
  readonly activityCount: number;

  /**
   * Activity types present in this trace.
   */
  readonly activityTypes: readonly string[];
}

/**
 * Options for configuring the {@link FedifySpanExporter}.
 *
 * @since 1.10.0
 */
export interface FedifySpanExporterOptions {
  /**
   * The time-to-live for stored trace data.
   * If not specified, data will be stored indefinitely
   * (or until manually deleted).
   */
  readonly ttl?: Temporal.Duration;

  /**
   * The key prefix for storing trace data in the KvStore.
   * Defaults to `["fedify", "traces"]`.
   */
  readonly keyPrefix?: KvKey;
}

/**
 * Options for the {@link FedifySpanExporter.getRecentTraces} method.
 *
 * @since 1.10.0
 */
export interface GetRecentTracesOptions {
  /**
   * Maximum number of traces to return.
   * If not specified, returns all available traces.
   */
  limit?: number;
}

/**
 * A SpanExporter that persists ActivityPub activity traces to a
 * {@link KvStore}.  This enables distributed tracing across multiple
 * nodes in a Fedify deployment.
 *
 * The exporter captures activity data from OpenTelemetry span events
 * (`activitypub.activity.received` and `activitypub.activity.sent`)
 * and stores them in the KvStore with trace context preserved.
 *
 * @example Basic usage with MemoryKvStore
 * ```typescript ignore
 * import { MemoryKvStore } from "@fedify/fedify";
 * import { FedifySpanExporter } from "@fedify/fedify/otel";
 * import {
 *   BasicTracerProvider,
 *   SimpleSpanProcessor,
 * } from "@opentelemetry/sdk-trace-base";
 *
 * const kv = new MemoryKvStore();
 * const exporter = new FedifySpanExporter(kv, {
 *   ttl: Temporal.Duration.from({ hours: 1 }),
 * });
 *
 * const provider = new BasicTracerProvider({
 *   spanProcessors: [new SimpleSpanProcessor(exporter)],
 * });
 * ```
 *
 * @example Querying stored traces
 * ```typescript ignore
 * import { MemoryKvStore } from "@fedify/fedify";
 * import { FedifySpanExporter } from "@fedify/fedify/otel";
 *
 * const kv = new MemoryKvStore();
 * const exporter = new FedifySpanExporter(kv);
 * const traceId = "abc123";
 *
 * // Get all activities for a specific trace
 * const activities = await exporter.getActivitiesByTraceId(traceId);
 *
 * // Get recent traces
 * const recentTraces = await exporter.getRecentTraces({ limit: 100 });
 * ```
 *
 * @since 1.10.0
 */
export class FedifySpanExporter implements SpanExporter {
  readonly #kv: KvStore;
  readonly #ttl?: Temporal.Duration;
  readonly #keyPrefix: KvKey;

  /**
   * Creates a new FedifySpanExporter.
   *
   * @param kv The KvStore to persist trace data to.
   * @param options Configuration options.
   */
  constructor(kv: KvStore, options?: FedifySpanExporterOptions) {
    this.#kv = kv;
    this.#ttl = options?.ttl;
    this.#keyPrefix = options?.keyPrefix ?? ["fedify", "traces"];
  }

  /**
   * Exports spans to the KvStore.
   *
   * @param spans The spans to export.
   * @param resultCallback Callback to invoke with the export result.
   */
  export(
    spans: ReadableSpan[],
    resultCallback: (result: { code: ExportResultCode }) => void,
  ): void {
    this.#exportAsync(spans)
      .then(() => resultCallback({ code: ExportResultCode.SUCCESS }))
      .catch((error) => {
        getLogger(["fedify", "otel", "exporter"]).error(
          "Failed to export spans to KvStore: {error}",
          { error },
        );
        resultCallback({ code: ExportResultCode.FAILED });
      });
  }

  async #exportAsync(spans: ReadableSpan[]): Promise<void> {
    const storeOperations: Promise<void>[] = [];
    for (const span of spans) {
      const records = this.#extractRecords(span);
      for (const record of records) {
        storeOperations.push(this.#storeRecord(record));
      }
    }
    const results = await Promise.allSettled(storeOperations);
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    if (rejected.length > 0) {
      throw new AggregateError(
        rejected.map((r) => r.reason),
        "Failed to store one or more trace activity records.",
      );
    }
  }

  #extractRecords(span: ReadableSpan): TraceActivityRecord[] {
    const records: TraceActivityRecord[] = [];
    const spanContext = span.spanContext();
    const traceId = spanContext.traceId;
    const spanId = spanContext.spanId;
    const parentSpanId = span.parentSpanContext?.spanId;

    for (const event of span.events) {
      if (event.name === "activitypub.activity.received") {
        const record = this.#extractInboundRecord(
          event,
          traceId,
          spanId,
          parentSpanId,
        );
        if (record != null) records.push(record);
      } else if (event.name === "activitypub.activity.sent") {
        const record = this.#extractOutboundRecord(
          event,
          traceId,
          spanId,
          parentSpanId,
        );
        if (record != null) records.push(record);
      }
    }

    return records;
  }

  #extractInboundRecord(
    event: ReadableSpan["events"][number],
    traceId: string,
    spanId: string,
    parentSpanId?: string,
  ): TraceActivityRecord | null {
    const attrs = event.attributes;
    if (attrs == null) return null;

    const activityJson = attrs["activitypub.activity.json"];
    if (typeof activityJson !== "string") return null;

    let activityType = "Unknown";
    let activityId: string | undefined;
    let actorId: string | undefined;

    try {
      const activity = JSON.parse(activityJson);
      activityType = activity.type ?? "Unknown";
      activityId = activity.id;
      // Extract actor ID from activity
      if (typeof activity.actor === "string") {
        actorId = activity.actor;
      } else if (
        activity.actor != null && typeof activity.actor.id === "string"
      ) {
        actorId = activity.actor.id;
      }
    } catch {
      // Ignore JSON parse errors
    }

    const verified = attrs["activitypub.activity.verified"];

    // Extract signature verification details
    const httpSigVerified = attrs["http_signatures.verified"];
    const httpSigKeyId = attrs["http_signatures.key_id"];
    const httpSigFailureReason = attrs["http_signatures.failure_reason"];
    const httpSigKeyFetchStatus = attrs["http_signatures.key_fetch_status"];
    const httpSigKeyFetchError = attrs["http_signatures.key_fetch_error"];
    const ldSigVerified = attrs["ld_signatures.verified"];

    let signatureDetails: SignatureVerificationDetails | undefined;
    if (
      typeof httpSigVerified === "boolean" ||
      typeof ldSigVerified === "boolean" ||
      typeof httpSigFailureReason === "string"
    ) {
      signatureDetails = {
        httpSignaturesVerified: httpSigVerified === true,
        httpSignaturesKeyId:
          typeof httpSigKeyId === "string" && httpSigKeyId !== ""
            ? httpSigKeyId
            : undefined,
        httpSignaturesFailureReason: typeof httpSigFailureReason === "string" &&
            httpSigFailureReason !== ""
          ? httpSigFailureReason
          : undefined,
        httpSignaturesKeyFetchStatus: typeof httpSigKeyFetchStatus === "number"
          ? httpSigKeyFetchStatus
          : undefined,
        httpSignaturesKeyFetchError: typeof httpSigKeyFetchError === "string" &&
            httpSigKeyFetchError !== ""
          ? httpSigKeyFetchError
          : undefined,
        ldSignaturesVerified: ldSigVerified === true,
      };
    }

    return {
      traceId,
      spanId,
      parentSpanId,
      direction: "inbound",
      activityType,
      activityId,
      actorId,
      activityJson,
      verified: typeof verified === "boolean" ? verified : undefined,
      signatureDetails,
      timestamp: new Date(
        event.time[0] * 1000 + event.time[1] / 1e6,
      ).toISOString(),
    };
  }

  #extractOutboundRecord(
    event: ReadableSpan["events"][number],
    traceId: string,
    spanId: string,
    parentSpanId?: string,
  ): TraceActivityRecord | null {
    const attrs = event.attributes;
    if (attrs == null) return null;

    const activityJson = attrs["activitypub.activity.json"];
    if (typeof activityJson !== "string") return null;

    let activityType = "Unknown";
    let activityId: string | undefined;
    let actorId: string | undefined;

    try {
      const activity = JSON.parse(activityJson);
      activityType = activity.type ?? "Unknown";
      activityId = activity.id;
      // Extract actor ID from activity
      if (typeof activity.actor === "string") {
        actorId = activity.actor;
      } else if (
        activity.actor != null && typeof activity.actor.id === "string"
      ) {
        actorId = activity.actor.id;
      }
    } catch {
      // Ignore JSON parse errors
    }

    const inboxUrl = attrs["activitypub.inbox.url"];
    const explicitActivityId = attrs["activitypub.activity.id"];

    return {
      traceId,
      spanId,
      parentSpanId,
      direction: "outbound",
      activityType,
      activityId: activityId ??
        (typeof explicitActivityId === "string" && explicitActivityId !== ""
          ? explicitActivityId
          : undefined),
      actorId,
      activityJson,
      timestamp: new Date(
        event.time[0] * 1000 + event.time[1] / 1e6,
      ).toISOString(),
      inboxUrl: typeof inboxUrl === "string" ? inboxUrl : undefined,
    };
  }

  async #storeRecord(record: TraceActivityRecord): Promise<void> {
    const options: KvStoreSetOptions | undefined = this.#ttl != null
      ? { ttl: this.#ttl }
      : undefined;

    const key: KvKey = [
      ...this.#keyPrefix,
      record.traceId,
      record.spanId,
    ] as KvKey;
    await this.#kv.set(key, record, options);
  }

  /**
   * Gets all activity records for a specific trace ID.
   *
   * @param traceId The trace ID to query.
   * @returns An array of activity records belonging to the trace.
   */
  async getActivitiesByTraceId(
    traceId: string,
  ): Promise<TraceActivityRecord[]> {
    const prefix: KvKey = [...this.#keyPrefix, traceId] as KvKey;
    const records: TraceActivityRecord[] = [];

    for await (const entry of this.#kv.list(prefix)) {
      records.push(entry.value as TraceActivityRecord);
    }

    return records;
  }

  /**
   * Gets recent traces with summary information.
   *
   * Each summary is computed directly from the activity records currently
   * stored for each trace, rather than from a separately maintained
   * counter.  This guarantees that a trace is discoverable, and its
   * `activityCount` accurate, as soon as its records are stored, even if
   * an earlier attempt at summarizing it (in a previous version of this
   * exporter) never completed, and that the count always reflects
   * records that have not expired.  It costs a full scan of every stored
   * record on every call, including full inbound activity JSON.  The
   * `limit` option only truncates the returned summaries and does not
   * reduce the scan.  Callers that poll this method frequently should
   * account for the total retained data when choosing a TTL and polling
   * interval.
   *
   * @param options Options for the query.
   * @returns An array of trace summaries.
   */
  async getRecentTraces(
    options?: GetRecentTracesOptions,
  ): Promise<TraceSummary[]> {
    const aggregates = new Map<string, {
      timestamp: string;
      activityCount: number;
      activityTypes: string[];
    }>();
    const traceIdIndex = this.#keyPrefix.length;

    for await (const entry of this.#kv.list(this.#keyPrefix)) {
      const traceId = entry.key[traceIdIndex];
      // Skip summary entries left behind by older versions of this
      // exporter; they are no longer read or maintained.
      if (traceId == null || traceId === "_summaries") continue;
      const record = entry.value as TraceActivityRecord | undefined;
      if (record == null || typeof record.timestamp !== "string") continue;

      const aggregate = aggregates.get(traceId);
      if (aggregate == null) {
        aggregates.set(traceId, {
          timestamp: record.timestamp,
          activityCount: 1,
          activityTypes: [record.activityType],
        });
      } else {
        aggregate.activityCount++;
        if (record.timestamp < aggregate.timestamp) {
          aggregate.timestamp = record.timestamp;
        }
        if (!aggregate.activityTypes.includes(record.activityType)) {
          aggregate.activityTypes.push(record.activityType);
        }
      }
    }

    const summaries: TraceSummary[] = [...aggregates].map(
      ([traceId, aggregate]) => ({ traceId, ...aggregate }),
    );
    summaries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (options?.limit != null) {
      return summaries.slice(0, options.limit);
    }

    return summaries;
  }

  /**
   * Forces the exporter to flush any buffered data.
   * This is a no-op because we write directly to the KvStore without buffering.
   */
  async forceFlush(): Promise<void> {
    // No-op: data is written directly to KvStore without buffering
  }

  /**
   * Shuts down the exporter.
   */
  async shutdown(): Promise<void> {
    // No cleanup needed
  }
}
