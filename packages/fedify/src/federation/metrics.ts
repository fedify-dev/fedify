import {
  type Attributes,
  type Counter,
  type Histogram,
  type MeterProvider,
  metrics,
  type UpDownCounter,
} from "@opentelemetry/api";
import metadata from "../../deno.json" with { type: "json" };
import type { MessageQueue } from "./mq.ts";

/**
 * The role of a queued task, derived from the queued message's `type` field.
 * @since 2.3.0
 */
export type QueueTaskRole = "fanout" | "outbox" | "inbox";

/**
 * The terminal result of a queued task processing attempt.
 * @since 2.3.0
 */
export type QueueTaskResult = "completed" | "failed" | "aborted";

/**
 * Common attributes shared by all queue task metrics.
 * @since 2.3.0
 */
export interface QueueTaskCommonAttributes {
  role: QueueTaskRole;
  queue?: MessageQueue;
  activityType?: string;
}

class FederationMetrics {
  readonly deliverySent: Counter;
  readonly deliveryPermanentFailure: Counter;
  readonly signatureVerificationFailure: Counter;
  readonly deliveryDuration: Histogram;
  readonly inboxProcessingDuration: Histogram;
  readonly httpServerRequestCount: Counter;
  readonly httpServerRequestDuration: Histogram;
  readonly queueTaskEnqueued: Counter;
  readonly queueTaskStarted: Counter;
  readonly queueTaskCompleted: Counter;
  readonly queueTaskFailed: Counter;
  readonly queueTaskDuration: Histogram;
  readonly queueTaskInFlight: UpDownCounter;

  constructor(meterProvider: MeterProvider) {
    const meter = meterProvider.getMeter(metadata.name, metadata.version);
    this.deliverySent = meter.createCounter("activitypub.delivery.sent", {
      description: "ActivityPub delivery attempts.",
      unit: "{attempt}",
    });
    this.deliveryPermanentFailure = meter.createCounter(
      "activitypub.delivery.permanent_failure",
      {
        description: "ActivityPub deliveries abandoned as permanent failures.",
        unit: "{failure}",
      },
    );
    this.signatureVerificationFailure = meter.createCounter(
      "activitypub.signature.verification_failure",
      {
        description: "ActivityPub signature verification failures.",
        unit: "{failure}",
      },
    );
    this.deliveryDuration = meter.createHistogram(
      "activitypub.delivery.duration",
      {
        description: "Duration of ActivityPub delivery attempts.",
        unit: "ms",
      },
    );
    this.inboxProcessingDuration = meter.createHistogram(
      "activitypub.inbox.processing_duration",
      {
        description: "Duration of ActivityPub inbox listener processing.",
        unit: "ms",
      },
    );
    this.httpServerRequestCount = meter.createCounter(
      "fedify.http.server.request.count",
      {
        description: "HTTP requests handled by Federation.fetch().",
        unit: "{request}",
      },
    );
    this.httpServerRequestDuration = meter.createHistogram(
      "fedify.http.server.request.duration",
      {
        description: "Duration of HTTP requests handled by Federation.fetch().",
        unit: "ms",
        advice: {
          // Mirror the OpenTelemetry HTTP server semantic-conventions
          // recommended buckets, expressed in milliseconds.
          explicitBucketBoundaries: [
            5,
            10,
            25,
            50,
            75,
            100,
            250,
            500,
            750,
            1000,
            2500,
            5000,
            7500,
            10000,
          ],
        },
      },
    );
    this.queueTaskEnqueued = meter.createCounter("fedify.queue.task.enqueued", {
      description: "Tasks Fedify enqueued for inbox, outbox, or fanout work.",
      unit: "{task}",
    });
    this.queueTaskStarted = meter.createCounter("fedify.queue.task.started", {
      description: "Tasks Fedify began processing as a queue worker.",
      unit: "{task}",
    });
    this.queueTaskCompleted = meter.createCounter(
      "fedify.queue.task.completed",
      {
        description: "Queue tasks Fedify finished processing without throwing.",
        unit: "{task}",
      },
    );
    this.queueTaskFailed = meter.createCounter("fedify.queue.task.failed", {
      description: "Queue tasks Fedify abandoned because processing threw.",
      unit: "{task}",
    });
    this.queueTaskDuration = meter.createHistogram(
      "fedify.queue.task.duration",
      {
        description: "Duration of queue task processing in Fedify workers.",
        unit: "ms",
        advice: {
          // Reuse the OpenTelemetry HTTP server semantic-conventions buckets
          // since queue task durations span a similar 5 ms to 10 s range
          // (network-bound outbox delivery dominates the tail).
          explicitBucketBoundaries: [
            5,
            10,
            25,
            50,
            75,
            100,
            250,
            500,
            750,
            1000,
            2500,
            5000,
            7500,
            10000,
          ],
        },
      },
    );
    this.queueTaskInFlight = meter.createUpDownCounter(
      "fedify.queue.task.in_flight",
      {
        description:
          "Queue tasks currently being processed in this Fedify process.",
        unit: "{task}",
      },
    );
  }

  recordDelivery(
    inbox: URL,
    durationMs: number,
    success: boolean,
    activityType?: string,
  ): void {
    const deliveryAttributes: Attributes = {
      "activitypub.remote.host": getRemoteHost(inbox),
      "activitypub.delivery.success": success,
    };
    if (activityType != null) {
      deliveryAttributes["activitypub.activity.type"] = activityType;
    }
    this.deliverySent.add(1, deliveryAttributes);
    this.deliveryDuration.record(durationMs, deliveryAttributes);
  }

  recordPermanentFailure(inbox: URL, statusCode: number): void {
    this.deliveryPermanentFailure.add(1, {
      "activitypub.remote.host": getRemoteHost(inbox),
      "http.response.status_code": statusCode,
    });
  }

  recordSignatureVerificationFailure(
    reason: string,
    remoteHost?: string,
  ): void {
    const attributes: Attributes = {
      "activitypub.verification.failure_reason": reason,
    };
    if (remoteHost != null) {
      attributes["activitypub.remote.host"] = remoteHost;
    }
    this.signatureVerificationFailure.add(1, attributes);
  }

  recordInboxProcessingDuration(
    activityType: string,
    durationMs: number,
  ): void {
    this.inboxProcessingDuration.record(durationMs, {
      "activitypub.activity.type": activityType,
    });
  }

  recordHttpServerRequest(
    method: string,
    endpoint: string,
    durationMs: number,
    options: { statusCode?: number; routeTemplate?: string } = {},
  ): void {
    const attributes: Attributes = {
      "http.request.method": normalizeHttpMethod(method),
      "fedify.endpoint": endpoint,
    };
    if (options.statusCode != null) {
      attributes["http.response.status_code"] = options.statusCode;
    }
    if (options.routeTemplate != null) {
      attributes["fedify.route.template"] = options.routeTemplate;
    }
    this.httpServerRequestCount.add(1, attributes);
    this.httpServerRequestDuration.record(durationMs, attributes);
  }

  recordQueueTaskEnqueued(
    common: QueueTaskCommonAttributes,
    attempt: number,
  ): void {
    const attributes = buildQueueTaskAttributes(common);
    attributes["fedify.queue.task.attempt"] = attempt;
    this.queueTaskEnqueued.add(1, attributes);
  }

  recordQueueTaskStarted(common: QueueTaskCommonAttributes): void {
    this.queueTaskStarted.add(1, buildQueueTaskAttributes(common));
  }

  incrementQueueTaskInFlight(common: QueueTaskCommonAttributes): void {
    this.queueTaskInFlight.add(1, buildQueueTaskInFlightAttributes(common));
  }

  decrementQueueTaskInFlight(common: QueueTaskCommonAttributes): void {
    this.queueTaskInFlight.add(-1, buildQueueTaskInFlightAttributes(common));
  }

  recordQueueTaskOutcome(
    common: QueueTaskCommonAttributes,
    result: QueueTaskResult,
    durationMs: number,
  ): void {
    const attributes = buildQueueTaskAttributes(common);
    attributes["fedify.queue.task.result"] = result;
    if (result === "completed") {
      this.queueTaskCompleted.add(1, attributes);
    } else if (result === "failed") {
      this.queueTaskFailed.add(1, attributes);
    }
    this.queueTaskDuration.record(durationMs, attributes);
  }
}

function buildQueueTaskAttributes(
  common: QueueTaskCommonAttributes,
): Attributes {
  const attributes: Attributes = {
    "fedify.queue.role": common.role,
  };
  const backend = getQueueBackend(common.queue);
  if (backend != null) {
    attributes["fedify.queue.backend"] = backend;
  }
  const nativeRetrial = common.queue?.nativeRetrial;
  if (typeof nativeRetrial === "boolean") {
    attributes["fedify.queue.native_retrial"] = nativeRetrial;
  }
  if (common.activityType != null) {
    attributes["activitypub.activity.type"] = common.activityType;
  }
  return attributes;
}

function buildQueueTaskInFlightAttributes(
  common: QueueTaskCommonAttributes,
): Attributes {
  // The in-flight UpDownCounter is process-local and intentionally omits
  // per-message attributes (activity type, attempt, result) so that
  // increments and decrements pair up cleanly.
  return buildQueueTaskAttributes({ role: common.role, queue: common.queue });
}

/**
 * Returns the constructor name of the given message queue, when it is a
 * meaningful identifier.  Used as a best-effort `fedify.queue.backend`
 * attribute on queue task metrics; returns `undefined` for plain object
 * literals (whose constructor is `Object`) so the attribute does not appear
 * with a non-informative value.
 * @since 2.3.0
 */
export function getQueueBackend(queue?: MessageQueue): string | undefined {
  const name = queue?.constructor?.name;
  if (name == null || name === "" || name === "Object") return undefined;
  return name;
}

/**
 * Records `fedify.queue.task.enqueued` for an outgoing outbox enqueue.
 *
 * Both `Context.sendActivity()` and `OutboxContext.forwardActivity()` enqueue
 * outbox messages with the same metric attributes (role, queue, activity
 * type, attempt), so they share this helper rather than each defining a local
 * closure.
 * @since 2.3.0
 */
export function recordOutboxEnqueue(
  meterProvider: MeterProvider | undefined,
  outboxQueue: MessageQueue,
  message: { readonly activityType: string; readonly attempt: number },
): void {
  getFederationMetrics(meterProvider).recordQueueTaskEnqueued(
    {
      role: "outbox",
      queue: outboxQueue,
      activityType: message.activityType,
    },
    message.attempt,
  );
}

/**
 * Whether the given thrown value is an `AbortError`.
 *
 * `processQueuedTask` distinguishes aborted tasks (recorded as
 * `fedify.queue.task.result=aborted`) from other failures so that backend
 * shutdown signals do not inflate the `fedify.queue.task.failed` counter.
 * @since 2.3.0
 */
export function isAbortError(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" && name === "AbortError";
}

const KNOWN_HTTP_METHODS: ReadonlySet<string> = new Set([
  "CONNECT",
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
  "QUERY",
  "TRACE",
]);

function normalizeHttpMethod(method: string): string {
  const upper = method.toUpperCase();
  return KNOWN_HTTP_METHODS.has(upper) ? upper : "_OTHER";
}

const federationMetrics = new WeakMap<MeterProvider, FederationMetrics>();

/**
 * Gets the cached Fedify metric instruments for a meter provider.
 * @since 2.3.0
 */
export function getFederationMetrics(
  meterProvider: MeterProvider = metrics.getMeterProvider(),
): FederationMetrics {
  let instruments = federationMetrics.get(meterProvider);
  if (instruments == null) {
    instruments = new FederationMetrics(meterProvider);
    federationMetrics.set(meterProvider, instruments);
  }
  return instruments;
}

/**
 * Gets the bounded remote host attribute value for a URL.
 * @since 2.3.0
 */
export function getRemoteHost(url: URL): string {
  return url.hostname;
}

/**
 * Gets an elapsed duration in milliseconds from a `performance.now()` value.
 * @since 2.3.0
 */
export function getDurationMs(start: number): number {
  return Math.max(0, performance.now() - start);
}
