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
 * The outcome of an outbound delivery attempt.
 *
 * @since 2.5.0
 */
export type DeliveryOutcome = "success" | "failed";

/**
 * The kind of failure for a failed outbound delivery attempt.
 *
 *  -  `"http"`: The inbox responded with a non-2xx HTTP status.
 *  -  `"transport"`: The request could not be sent at all, e.g., a DNS
 *     resolution failure or a network error.
 *  -  `"policy"`: The destination was refused by Fedify's own
 *     private-address policy before a request was made.
 *  -  `"local"`: The attempt failed for a reason other than the network or
 *     the remote response, e.g., the activity could not be serialized, or
 *     a signing or HTTP Message Signatures spec lookup failed.
 *  -  `"unknown"`: The attempt failed for a reason this version of Fedify
 *     does not classify.
 *
 * @since 2.5.0
 */
export type DeliveryFailureKind =
  | "http"
  | "transport"
  | "policy"
  | "local"
  | "unknown";

/**
 * The phase of a delivery attempt in which it failed.
 *
 *  -  `"pre-request"`: Before a request was ever built, e.g., a
 *     private-address policy rejection or activity serialization failure.
 *  -  `"request"`: While sending the request or awaiting a response.
 *  -  `"response"`: After a final response was received, but it was not a
 *     successful (2xx) status.
 *  -  `"post-response"`: After a successful response, during follow-up
 *     bookkeeping that is not part of the delivery itself.
 *  -  `"unknown"`: This version of Fedify did not record which phase the
 *     attempt failed in.
 *
 * @since 2.5.0
 */
export type DeliveryFailurePhase =
  | "pre-request"
  | "request"
  | "response"
  | "post-response"
  | "unknown";

/**
 * Details about a failed outbound delivery attempt.
 *
 * @since 2.5.0
 */
export interface DeliveryFailureDetails {
  /**
   * The kind of failure.
   */
  readonly kind: DeliveryFailureKind;

  /**
   * The phase of the delivery attempt in which it failed.
   */
  readonly phase: DeliveryFailurePhase;

  /**
   * The HTTP status code of the response the delivery attempt observed,
   * if any.  Set when {@link kind} is `"http"`, and also when {@link kind}
   * is `"local"` and {@link phase} is `"post-response"`, since that
   * failure happens after a response was already received.
   */
  readonly statusCode?: number;
}

/**
 * A disposition the outbox queue worker reached for a message without
 * necessarily entering {@link TraceActivityRecord | an attempt}.
 *
 *  -  `"held"`: The circuit breaker deferred the message to a later time.
 *  -  `"dropped"`: The circuit breaker gave up on the message, e.g., after
 *     its hold expired.
 *  -  `"preparation_failed"`: The worker could not even prepare the
 *     delivery, e.g., the queued message's inbox URL was malformed.
 *  -  `"action_failed"`: The worker's own hold or drop action failed, e.g.,
 *     re-enqueueing the held message was rejected by the queue backend.
 *
 * @since 2.5.0
 */
export type OutboundWorkerDisposition =
  | "held"
  | "dropped"
  | "preparation_failed"
  | "action_failed";

/**
 * A record of a disposition the outbox queue worker reached for a message,
 * captured from the worker's own span.  This is distinct from
 * {@link TraceActivityRecord}: it describes the worker's execution, not a
 * delivery attempt, and a worker execution that reaches
 * `sendActivity()` still produces its own `TraceActivityRecord` for that
 * attempt instead of (or in addition to) a record here.
 *
 * @since 2.5.0
 */
export interface TraceOutboundWorkerRecord {
  /**
   * The trace ID from OpenTelemetry.
   */
  readonly traceId: string;

  /**
   * The worker's own span ID from OpenTelemetry.
   */
  readonly spanId: string;

  /**
   * The parent span ID, if any.
   */
  readonly parentSpanId?: string;

  /**
   * The disposition the worker reached.
   */
  readonly disposition: OutboundWorkerDisposition;

  /**
   * The number of times this worker execution actually entered
   * `sendActivity()`.  This is tracked from the execution itself, not
   * inferred from whether a span was exported, since a sampled-out span
   * is not evidence that no attempt happened.
   */
  readonly attemptsStarted: number;

  /**
   * The ActivityPub activity type (e.g., "Create", "Follow", "Like"), if
   * known.
   */
  readonly activityType?: string;

  /**
   * The message queue's own retry round for this execution, if the
   * message came from a queue.  This is the queue's redelivery count, not
   * a count of delivery attempts: native queue redelivery can leave it
   * unchanged, and a single round can run more than one attempt when
   * trying a portable actor's gateways.  Absent for an immediate send
   * that never went through a queue.
   */
  readonly queueAttempt?: number;

  /**
   * The timestamp when this record was created (ISO 8601 format).
   */
  readonly timestamp: string;
}

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
   * The full JSON representation of the activity, if the span event included
   * it.
   */
  readonly activityJson?: string;

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

  /**
   * The outcome of an outbound delivery attempt (for outbound activities).
   *
   * Absent on records persisted before this field was introduced.  Such
   * a record is always for a successful delivery, since a failed outbound
   * delivery attempt used to leave no record at all.
   *
   * @since 2.5.0
   */
  readonly outcome?: DeliveryOutcome;

  /**
   * Details about why an outbound delivery attempt failed (for outbound
   * activities).  Only set when {@link outcome} is `"failed"`.
   *
   * @since 2.5.0
   */
  readonly failure?: DeliveryFailureDetails;

  /**
   * The message queue's own retry round this attempt ran under (for
   * outbound activities), if it was dispatched from a queued outbox
   * message.  This is the queue's redelivery count, not a count of
   * delivery attempts: native queue redelivery can leave it unchanged,
   * and a single round can run more than one attempt when trying a
   * portable actor's gateways.  Absent for an immediate send that never
   * went through a queue.
   *
   * @since 2.5.0
   */
  readonly queueAttempt?: number;
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

  /**
   * The number of {@link TraceOutboundWorkerRecord}s recorded for this
   * trace.  A trace with only worker records and no attempts has
   * {@link activityCount} `0` and this field greater than `0`.
   *
   * @since 2.5.0
   */
  readonly outboundWorkerCount?: number;
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
      const { activities, workers } = this.#extractRecords(span);
      for (const record of activities) {
        storeOperations.push(this.#storeRecord(record));
      }
      for (const record of workers) {
        storeOperations.push(this.#storeWorkerRecord(record));
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

  #extractRecords(span: ReadableSpan): {
    activities: TraceActivityRecord[];
    workers: TraceOutboundWorkerRecord[];
  } {
    const activities: TraceActivityRecord[] = [];
    const workers: TraceOutboundWorkerRecord[] = [];
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
        if (record != null) activities.push(record);
      } else if (event.name === "activitypub.activity.sent") {
        const record = this.#extractOutboundRecord(
          event,
          span,
          traceId,
          spanId,
          parentSpanId,
          "success",
        );
        if (record != null) activities.push(record);
      } else if (event.name === "activitypub.activity.send_failed") {
        const record = this.#extractOutboundRecord(
          event,
          span,
          traceId,
          spanId,
          parentSpanId,
          "failed",
        );
        if (record != null) activities.push(record);
      } else if (event.name === "activitypub.outbox.worker.disposition") {
        const record = this.#extractWorkerRecord(
          event,
          span,
          traceId,
          spanId,
          parentSpanId,
        );
        if (record != null) workers.push(record);
      }
    }

    return { activities, workers };
  }

  #extractWorkerRecord(
    event: ReadableSpan["events"][number],
    span: ReadableSpan,
    traceId: string,
    spanId: string,
    parentSpanId: string | undefined,
  ): TraceOutboundWorkerRecord | null {
    const attrs = event.attributes;
    if (attrs == null) return null;

    const disposition = attrs["activitypub.outbox.worker.disposition"];
    if (typeof disposition !== "string") return null;

    const attemptsStarted = attrs["activitypub.outbox.worker.attempts_started"];
    const activityType = span.attributes["activitypub.activity.type"];
    const queueAttempt = span.attributes["activitypub.activity.retries"];

    return {
      traceId,
      spanId,
      parentSpanId,
      disposition: disposition as OutboundWorkerDisposition,
      attemptsStarted: typeof attemptsStarted === "number"
        ? attemptsStarted
        : 0,
      activityType: typeof activityType === "string" ? activityType : undefined,
      queueAttempt: typeof queueAttempt === "number" ? queueAttempt : undefined,
      timestamp: new Date(
        event.time[0] * 1000 + event.time[1] / 1e6,
      ).toISOString(),
    };
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
    span: ReadableSpan,
    traceId: string,
    spanId: string,
    parentSpanId: string | undefined,
    outcome: DeliveryOutcome,
  ): TraceActivityRecord | null {
    const attrs = event.attributes;
    if (attrs == null) return null;

    const activityJson = attrs["activitypub.activity.json"];

    let activityType = "Unknown";
    let activityId: string | undefined;
    let actorId: string | undefined;

    if (typeof activityJson === "string") {
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
    }

    const inboxUrl = attrs["activitypub.inbox.url"];
    const explicitActivityId = attrs["activitypub.activity.id"];
    const explicitActivityType = attrs["activitypub.activity.type"];
    const explicitActorId = attrs["activitypub.actor.id"];
    const failureKind = attrs["activitypub.delivery.failure_kind"];
    const failurePhase = attrs["activitypub.delivery.failure_phase"];
    const statusCode = attrs["http.response.status_code"];
    const queueAttempt = span.attributes["activitypub.activity.retries"];

    return {
      traceId,
      spanId,
      parentSpanId,
      direction: "outbound",
      activityType:
        typeof explicitActivityType === "string" && explicitActivityType !== ""
          ? explicitActivityType
          : activityType,
      activityId: activityId ??
        (typeof explicitActivityId === "string" && explicitActivityId !== ""
          ? explicitActivityId
          : undefined),
      actorId: typeof explicitActorId === "string" && explicitActorId !== ""
        ? explicitActorId
        : actorId,
      ...(typeof activityJson === "string" ? { activityJson } : {}),
      timestamp: new Date(
        event.time[0] * 1000 + event.time[1] / 1e6,
      ).toISOString(),
      inboxUrl: typeof inboxUrl === "string" ? inboxUrl : undefined,
      outcome,
      ...(typeof queueAttempt === "number" ? { queueAttempt } : {}),
      ...(outcome === "failed"
        ? {
          failure: {
            kind: typeof failureKind === "string"
              ? failureKind as DeliveryFailureKind
              : "unknown",
            phase: typeof failurePhase === "string"
              ? failurePhase as DeliveryFailurePhase
              : "unknown",
            ...(typeof statusCode === "number" ? { statusCode } : {}),
          },
        }
        : {}),
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
    const alreadyStored = await this.#kv.get(key) != null;
    await this.#kv.set(key, record, options);
    if (!alreadyStored) {
      await this.#updateTraceSummary(record, options);
    }
  }

  async #setWithCasRetry<T>(
    key: KvKey,
    transform: (existing: T | undefined) => T,
    options?: KvStoreSetOptions,
  ): Promise<void> {
    if (this.#kv.cas != null) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const existing = await this.#kv.get<T>(key);
        const newValue = transform(existing);
        if (await this.#kv.cas(key, existing, newValue, options)) {
          return;
        }
      }
    }

    // Fallback to non-atomic set if CAS is not available or fails
    const existing = await this.#kv.get<T>(key);
    const newValue = transform(existing);
    await this.#kv.set(key, newValue, options);
  }

  async #updateTraceSummary(
    record: TraceActivityRecord,
    options?: KvStoreSetOptions,
  ): Promise<void> {
    const summaryKey: KvKey = [
      ...this.#keyPrefix,
      "_summaries",
      record.traceId,
    ] as KvKey;

    await this.#setWithCasRetry<TraceSummary>(
      summaryKey,
      (existing) => {
        const activityCount = existing != null ? existing.activityCount + 1 : 1;
        const activityTypes = existing != null
          ? existing.activityTypes.includes(record.activityType)
            ? existing.activityTypes
            : [...existing.activityTypes, record.activityType]
          : [record.activityType];
        return {
          traceId: existing?.traceId ?? record.traceId,
          timestamp: existing?.timestamp ?? record.timestamp,
          activityCount,
          activityTypes,
          ...(existing?.outboundWorkerCount == null
            ? {}
            : { outboundWorkerCount: existing.outboundWorkerCount }),
        };
      },
      options,
    );
  }

  async #storeWorkerRecord(record: TraceOutboundWorkerRecord): Promise<void> {
    const options: KvStoreSetOptions | undefined = this.#ttl != null
      ? { ttl: this.#ttl }
      : undefined;

    const key: KvKey = [
      ...this.#keyPrefix,
      "_workers",
      record.traceId,
      record.spanId,
    ] as KvKey;
    const alreadyStored = await this.#kv.get(key) != null;
    await this.#kv.set(key, record, options);
    if (!alreadyStored) {
      await this.#updateWorkerSummary(record, options);
    }
  }

  async #updateWorkerSummary(
    record: TraceOutboundWorkerRecord,
    options?: KvStoreSetOptions,
  ): Promise<void> {
    const summaryKey: KvKey = [
      ...this.#keyPrefix,
      "_summaries",
      record.traceId,
    ] as KvKey;

    await this.#setWithCasRetry<TraceSummary>(
      summaryKey,
      (existing) => ({
        traceId: existing?.traceId ?? record.traceId,
        timestamp: existing?.timestamp ?? record.timestamp,
        activityCount: existing?.activityCount ?? 0,
        activityTypes: existing?.activityTypes ?? [],
        outboundWorkerCount: (existing?.outboundWorkerCount ?? 0) + 1,
      }),
      options,
    );
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
   * Gets all outbox queue worker records for a specific trace ID.  These
   * are kept separate from {@link getActivitiesByTraceId}'s results: a
   * worker record describes the worker's own execution, not a delivery
   * attempt.
   *
   * @param traceId The trace ID to query.
   * @returns An array of worker records belonging to the trace.
   *
   * @since 2.5.0
   */
  async getWorkerRecordsByTraceId(
    traceId: string,
  ): Promise<TraceOutboundWorkerRecord[]> {
    const prefix: KvKey = [...this.#keyPrefix, "_workers", traceId] as KvKey;
    const records: TraceOutboundWorkerRecord[] = [];

    for await (const entry of this.#kv.list(prefix)) {
      records.push(entry.value as TraceOutboundWorkerRecord);
    }

    return records;
  }

  /**
   * Gets recent traces with summary information.
   *
   * @param options Options for the query.
   * @returns An array of trace summaries.
   */
  async getRecentTraces(
    options?: GetRecentTracesOptions,
  ): Promise<TraceSummary[]> {
    const summaryPrefix = [...this.#keyPrefix, "_summaries"] as KvKey;
    const summaries: TraceSummary[] = [];

    for await (const entry of this.#kv.list(summaryPrefix)) {
      summaries.push(entry.value as TraceSummary);
    }

    // Sort by timestamp descending (most recent first)
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
