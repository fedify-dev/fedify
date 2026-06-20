import type { DocumentLoader } from "@fedify/vocab-runtime";
import { FetchError } from "@fedify/vocab-runtime";
import {
  type Attributes,
  type Counter,
  type Histogram,
  type MeterProvider,
  metrics,
  type ObservableGauge,
  type UpDownCounter,
} from "@opentelemetry/api";
import metadata from "../../deno.json" with { type: "json" };
import type { MessageQueue } from "./mq.ts";

/**
 * The role of a queued task, derived from the queued message's `type` field.
 * @since 2.3.0
 */
export type QueueTaskRole = "fanout" | "outbox" | "inbox" | "task";

/**
 * The terminal result of a queued task processing attempt.
 * @since 2.3.0
 */
export type QueueTaskResult = "completed" | "failed" | "aborted";

/**
 * The lifecycle event classification recorded on
 * `activitypub.inbox.activity` as the `activitypub.processing.result`
 * attribute.  Tracks Fedify-managed events at the activity level, separate
 * from the per-delivery and per-queue-task metrics.
 *
 *  -  `queued`: the activity was accepted at the inbox endpoint and
 *     enqueued for background processing.
 *  -  `processed`: the registered listener finished without throwing.
 *  -  `retried`: Fedify scheduled a retry after the listener threw.
 *  -  `rejected`: Fedify refused to process the activity (missing actor,
 *     duplicate, unsupported type, or no-queue listener error).
 *  -  `abandoned`: the inbox retry policy gave up after exhausted attempts.
 *
 * Native-retry message queue backends will not record `retried` or
 * `abandoned` because Fedify defers retry handling to the backend.
 * @since 2.3.0
 */
export type InboxActivityResult =
  | "queued"
  | "processed"
  | "retried"
  | "rejected"
  | "abandoned";

/**
 * The lifecycle event classification recorded on
 * `activitypub.outbox.activity` as the `activitypub.processing.result`
 * attribute.  Tracks Fedify-managed events at the outbox-task level,
 * separate from the per-delivery counters defined in #619.
 *
 *  -  `queued`: an initial outbox task was enqueued for delivery.
 *     Recorded once per recipient inbox: fanned-out activities are
 *     counted as each per-recipient outbox task is enqueued by the
 *     fanout worker, not at the fanout-task enqueue itself.  Retry
 *     re-enqueues are recorded as `retried`, not `queued`.
 *  -  `retried`: Fedify scheduled a retry after a delivery failure.
 *  -  `abandoned`: Fedify gave up on the recipient.  Recorded both
 *     when the outbox retry policy returns `null` after exhausted
 *     attempts and when the remote responded with a permanent-failure
 *     status code (`permanentFailureStatusCodes`, by default `404` or
 *     `410`); the per-recipient permanent-failure detail still lives
 *     on `activitypub.delivery.permanent_failure`.
 *
 * The per-recipient `sent`/`failed` view lives on
 * `activitypub.delivery.sent` and `activitypub.delivery.permanent_failure`
 * and is not duplicated here.  Native-retry backends will not record
 * `retried` or `abandoned`.
 * @since 2.3.0
 */
export type OutboxActivityResult = "queued" | "retried" | "abandoned";

/**
 * The bounded circuit breaker state value recorded on
 * `activitypub.circuit_breaker.state_change`.
 * @since 2.3.0
 */
export type CircuitBreakerMetricState = "closed" | "open" | "half_open";

/**
 * Common attributes shared by all queue task metrics.
 * @since 2.3.0
 */
export interface QueueTaskCommonAttributes {
  role: QueueTaskRole;
  queue?: MessageQueue;
  activityType?: string;

  /**
   * The registered name of a custom background task, emitted as the
   * `fedify.task.name` attribute.  Set only for the `"task"` role.
   * @since 2.3.0
   */
  taskName?: string;
}

/**
 * An entry for observing one queue role in `fedify.queue.depth`.
 *
 * This public API is used by {@link registerQueueDepthGauge()} to associate a
 * queue depth source with the task role it represents.
 * @since 2.3.0
 */
export interface QueueDepthGaugeEntry {
  /**
   * The task role whose queue depth is observed.
   */
  role: QueueTaskRole;

  /**
   * The message queue to observe, or `undefined` when the role has no queue.
   */
  queue?: MessageQueue;
}

/**
 * Options for observing queue depth metrics.
 * @since 2.3.0
 */
export interface QueueDepthGaugeOptions {
  /**
   * An opaque source identifier to distinguish queue depth series registered on
   * the same meter provider.
   */
  sourceId?: string;
}

/**
 * The kind of ActivityPub signature verified, used as the
 * `activitypub.signature.kind` metric attribute.
 * @since 2.3.0
 */
export type SignatureVerificationKind =
  | "http"
  | "linked_data"
  | "object_integrity";

/**
 * The terminal classification of a signature verification attempt, used as
 * the `activitypub.signature.result` metric attribute.
 *
 *  -  `verified`: the signature was checked and accepted.
 *  -  `rejected`: the signature was checked and refused (bad signature, key
 *     fetch failure, owner mismatch, etc.).
 *  -  `missing`: no signature was present.  Only HTTP Signatures and Linked
 *     Data Signatures distinguish this from `rejected`; Object Integrity
 *     Proofs never carry this value because callers decide whether to invoke
 *     {@link import("../sig/proof.ts").verifyProof} at all.
 *  -  `error`: verification threw an unexpected error.
 * @since 2.3.0
 */
export type SignatureVerificationResult =
  | "verified"
  | "rejected"
  | "missing"
  | "error";

/**
 * The terminal classification of a public key fetch performed as part of
 * signature verification, used as the
 * `activitypub.signature.key_fetch.result` metric attribute.
 *
 *  -  `hit`: the public key was served by the configured `KeyCache`.  The
 *     `KeyCache` itself may be backed by a remote store such as Redis or a
 *     database, in which case the measurement reflects whatever round trip
 *     that backend incurs.
 *  -  `fetched`: the public key was not in the cache and was loaded
 *     through the document loader, returning a usable key.  This typically
 *     corresponds to a network fetch, but a custom document loader that
 *     serves from a local store will also fall in this bucket.
 *  -  `error`: the fetch attempt returned no usable key (HTTP failure,
 *     invalid response body, cached negative entry, thrown exception,
 *     etc.).
 * @since 2.3.0
 */
export type SignatureKeyFetchResult = "hit" | "fetched" | "error";

/**
 * Bounded values recorded as `http_signatures.algorithm` on the signature
 * verification duration histogram.  Covers both the draft-cavage parameter
 * names and the RFC 9421 algorithm map keys; anything outside this set is
 * dropped from the metric to keep cardinality safe.
 * @since 2.3.0
 */
export type HttpSignatureMetricAlgorithm =
  // draft-cavage `algorithm` parameter values:
  | "ecdsa-sha256"
  | "ecdsa-sha384"
  | "ecdsa-sha512"
  | "ed25519"
  | "hs2019"
  | "rsa-sha1"
  | "rsa-sha256"
  | "rsa-sha512"
  // RFC 9421 algorithm map keys:
  | "rsa-v1_5-sha256"
  | "rsa-v1_5-sha512"
  | "rsa-pss-sha512"
  | "ecdsa-p256-sha256"
  | "ecdsa-p384-sha384";

/**
 * Bounded values recorded as `http_signatures.failure_reason` on `rejected`
 * HTTP signature verification rows.  `noSignature` is not included because
 * missing-signature requests are recorded as
 * `activitypub.signature.result=missing` and do not carry a failure reason.
 * @since 2.3.0
 */
export type HttpSignatureMetricFailureReason =
  | "invalidSignature"
  | "keyFetchError";

/**
 * The reason a custom background task terminated unsuccessfully, emitted as the
 * `fedify.task.failure_reason` attribute.  A small bounded set mapping to the
 * worker's dispatch decision points; open to later refinement.
 *
 *  -  `deserialization`: the wire payload could not be deserialized.
 *  -  `validation`: the deserialized payload failed schema validation.
 *  -  `unknown_task`: the task name has no registered handler.
 *  -  `handler`: the registered handler threw.
 * @since 2.3.0
 */
export type QueueTaskFailureReason =
  | "deserialization"
  | "validation"
  | "unknown_task"
  | "handler";

/**
 * Bounded values recorded as `ld_signatures.type` on the signature
 * verification duration histogram.  Fedify only signs and verifies
 * `RsaSignature2017`; other types come in only from external documents and
 * are dropped from the metric.
 * @since 2.3.0
 */
export type LinkedDataSignatureMetricType = "RsaSignature2017";

/**
 * Bounded values recorded as `object_integrity_proofs.cryptosuite` on the
 * signature verification duration histogram.  Fedify only signs and
 * verifies `eddsa-jcs-2022`; other cryptosuites come in only from external
 * proofs and are dropped from the metric.
 * @since 2.3.0
 */
export type ObjectIntegrityProofMetricCryptosuite = "eddsa-jcs-2022";

/**
 * The kind of remote ActivityPub lookup, recorded as
 * `activitypub.lookup.kind` on the public-key lookup and remote document
 * fetch metric families.
 *
 *  -  `public_key`: a public key lookup performed by `fetchKey` /
 *     `fetchKeyDetailed` (always recorded on `activitypub.key.lookup*`).
 *  -  `actor`: a document fetch whose resolved value is an Actor.  The
 *     bucket exists in the taxonomy for future actor-aware call sites;
 *     today, actor documents fetched through Fedify's generic document
 *     loader are still classified as `object` because the kind is decided
 *     at the loader boundary, before the response is parsed.
 *  -  `object`: a generic ActivityPub object fetch through Fedify's
 *     document loader.  This is the default classification for
 *     `documentLoader` invocations that do not match a more specific
 *     bucket.
 *  -  `context`: a JSON-LD `@context` document fetch through Fedify's
 *     context loader.
 *  -  `other`: a fetch that does not fit any of the above classifications.
 * @since 2.3.0
 */
export type LookupKind =
  | "public_key"
  | "actor"
  | "object"
  | "context"
  | "other";

/**
 * The terminal classification of a public-key lookup or remote document
 * fetch, recorded as `activitypub.lookup.result` on the lookup metric
 * families.
 *
 *  -  `hit`: served from a cache without going to the network.
 *  -  `miss`: a cache was consulted and returned no entry; only used on
 *     `activitypub.document.cache`.
 *  -  `fetched`: the remote document or key was loaded successfully.
 *  -  `not_found`: the remote responded with HTTP `404 Not Found` or
 *     `410 Gone`, or otherwise reported the resource is absent.
 *  -  `invalid`: the remote responded with content Fedify could not parse
 *     into the expected shape.
 *  -  `network_error`: no HTTP response was received (DNS failure, connect
 *     timeout, abort, redirect loop, etc.).
 *  -  `error`: any other unexpected failure.
 * @since 2.3.0
 */
export type LookupResult =
  | "hit"
  | "miss"
  | "fetched"
  | "not_found"
  | "invalid"
  | "network_error"
  | "error";

/**
 * The {@link LookupKind} values that can appear on remote document fetch
 * metrics.  `public_key` lookups are reported on the
 * `activitypub.key.lookup` metric family instead, so it is excluded here.
 * @since 2.3.0
 */
export type DocumentFetchKind = Exclude<LookupKind, "public_key">;

/**
 * The {@link LookupResult} values that can appear on the
 * `activitypub.document.fetch` and `activitypub.document.fetch.duration`
 * metrics.  Cache `hit` / `miss` outcomes are reported on
 * `activitypub.document.cache`, and `invalid` is reserved for the
 * key-lookup metrics (where the parser can decide that a successful
 * HTTP response still does not contain a usable key), so all three are
 * excluded here.
 * @since 2.3.0
 */
export type DocumentFetchResult = Exclude<
  LookupResult,
  "hit" | "miss" | "invalid"
>;

/**
 * The {@link LookupResult} values that can appear on the
 * `activitypub.key.lookup` and `activitypub.key.lookup.duration` metrics.
 * `miss` is a cache-internal classification that surfaces on
 * `activitypub.document.cache` only and is not a terminal key lookup
 * outcome, so it is excluded here.
 * @since 2.3.0
 */
export type KeyLookupResult = Exclude<LookupResult, "miss">;

/**
 * Attributes accepted by {@link recordKeyLookup}.  `remoteUrl` is taken as
 * a `URL` so that the helper can derive the URL host, including any
 * non-default port, for the `activitypub.remote.host` attribute internally
 * and refuse to record high-cardinality values such as full key IDs or actor
 * URLs.
 * @since 2.3.0
 */
export interface KeyLookupAttributes {
  /** The terminal lookup result. */
  result: KeyLookupResult;
  /** Elapsed lookup duration in milliseconds. */
  durationMs: number;
  /** URL of the key, used to derive `activitypub.remote.host`. */
  remoteUrl?: URL;
  /** Whether the lookup path had a `KeyCache` configured. */
  cacheEnabled: boolean;
  /** The HTTP response status code, when an HTTP response was received. */
  statusCode?: number;
}

/**
 * Attributes accepted by {@link recordDocumentFetch}.
 * @since 2.3.0
 */
export interface DocumentFetchAttributes {
  kind: DocumentFetchKind;
  result: DocumentFetchResult;
  /** URL of the fetched document, used to derive `activitypub.remote.host`. */
  remoteUrl?: URL;
  /** Elapsed fetch duration in milliseconds. */
  durationMs: number;
  cacheEnabled?: boolean;
  statusCode?: number;
}

/**
 * Attributes accepted by {@link recordDocumentCache}.
 * @since 2.3.0
 */
export interface DocumentCacheAttributes {
  kind: DocumentFetchKind;
  result: "hit" | "miss";
  /** URL of the looked-up document, used to derive `activitypub.remote.host`. */
  remoteUrl?: URL;
}

/**
 * Optional attributes recorded alongside an
 * `activitypub.signature.verification.duration` measurement.  Each field is
 * scoped to the matching signature kind and is omitted when its value is not
 * available; the field types are literal unions so the compiler enforces the
 * spec-bounded value sets that keep metric cardinality safe.
 * @since 2.3.0
 */
export interface SignatureVerificationExtraAttributes {
  /** `http_signatures.algorithm` (HTTP Signatures only). */
  algorithm?: HttpSignatureMetricAlgorithm;
  /** `ld_signatures.type` (Linked Data Signatures only). */
  ldType?: LinkedDataSignatureMetricType;
  /** `object_integrity_proofs.cryptosuite` (Object Integrity Proofs only). */
  cryptosuite?: ObjectIntegrityProofMetricCryptosuite;
  /**
   * `http_signatures.failure_reason`, recorded only on HTTP Signature
   * failures so the histogram can be sliced by reason without exploding
   * cardinality on success rows.
   */
  failureReason?: HttpSignatureMetricFailureReason;
}

/**
 * The terminal classification of an incoming WebFinger request handled by
 * Fedify, recorded as the `webfinger.handle.result` attribute on the
 * `webfinger.handle` counter and `webfinger.handle.duration` histogram.
 *
 *  -  `resolved`: Fedify returned a `200 OK` response with a JRD.
 *  -  `invalid`: Fedify returned `400 Bad Request` because the queried
 *     `resource` parameter was missing or unparseable.
 *  -  `not_found`: Fedify returned `404 Not Found` because no actor
 *     dispatcher matched the queried resource, the actor identifier was
 *     not recognised, or the queried `acct:` host did not match the
 *     server.
 *  -  `tombstoned`: Fedify returned `410 Gone` because the actor
 *     dispatcher resolved to a {@link import("@fedify/vocab").Tombstone}.
 *  -  `error`: the handler threw before producing a response.
 * @since 2.3.0
 */
export type WebFingerHandleResult =
  | "resolved"
  | "invalid"
  | "not_found"
  | "tombstoned"
  | "error";

/**
 * The bounded value set recorded as `webfinger.resource.scheme` on the
 * `webfinger.handle` counter and `webfinger.handle.duration` histogram.
 * The set covers the schemes WebFinger / fediverse clients legitimately use
 * (RFC 7565 + ActivityPub).  Anything outside that set is bucketed as
 * `other` at the call site so attacker-controlled query strings cannot
 * inflate metric cardinality.
 * @since 2.3.0
 */
export type WebFingerResourceScheme =
  | "acct"
  | "http"
  | "https"
  | "mailto"
  | "other";

/**
 * Attributes accepted by {@link recordWebFingerHandle}.
 * @since 2.3.0
 */
export interface WebFingerHandleAttributes {
  /** The terminal handling outcome. */
  result: WebFingerHandleResult;
  /** Elapsed handler duration in milliseconds. */
  durationMs: number;
  /**
   * The scheme of the queried resource URI, restricted to the bounded
   * {@link WebFingerResourceScheme} set so the metric attribute stays
   * cardinality-safe.  Omitted when Fedify could not extract a scheme
   * (no resource parameter, unparseable URI, or thrown exception before
   * parsing).
   */
  scheme?: WebFingerResourceScheme;
  /**
   * The HTTP response status code Fedify produced.  Omitted only when the
   * handler threw before constructing a response.
   */
  statusCode?: number;
}

/**
 * The bounded collection kind recorded on collection request metrics.
 * @since 2.3.0
 */
export type CollectionMetricKind =
  | "inbox"
  | "outbox"
  | "following"
  | "followers"
  | "liked"
  | "featured"
  | "featured_tags"
  | "custom";

/**
 * The terminal request classification recorded on collection metrics.
 * @since 2.3.0
 */
export type CollectionMetricResult =
  | "served"
  | "not_found"
  | "not_acceptable"
  | "unauthorized"
  | "error";

/**
 * Whether a collection request was handled by one of Fedify's built-in
 * ActivityPub collection dispatchers or by an application-defined custom
 * collection dispatcher.
 * @since 2.3.0
 */
export type CollectionMetricDispatcher = "built_in" | "custom";

/**
 * Common attributes accepted by collection metric helpers.
 * @since 2.3.0
 */
export interface CollectionMetricAttributes {
  kind: CollectionMetricKind;
  page: boolean;
  dispatcher: CollectionMetricDispatcher;
  result: CollectionMetricResult;
  statusCode?: number;
}

class FederationMetrics {
  readonly deliverySent: Counter;
  readonly deliveryPermanentFailure: Counter;
  readonly signatureVerificationFailure: Counter;
  readonly signatureVerificationDuration: Histogram;
  readonly signatureKeyFetchDuration: Histogram;
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
  readonly queueDepth: ObservableGauge;
  readonly fanoutRecipients: Histogram;
  readonly inboxActivity: Counter;
  readonly outboxActivity: Counter;
  readonly circuitBreakerStateChange: Counter;
  readonly keyLookup: Counter;
  readonly keyLookupDuration: Histogram;
  readonly documentFetch: Counter;
  readonly documentFetchDuration: Histogram;
  readonly documentCache: Counter;
  readonly webFingerHandle: Counter;
  readonly webFingerHandleDuration: Histogram;
  readonly collectionRequest: Counter;
  readonly collectionDispatchDuration: Histogram;
  readonly collectionPageItems: Histogram;
  readonly collectionTotalItems: Histogram;

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
    this.signatureVerificationDuration = meter.createHistogram(
      "activitypub.signature.verification.duration",
      {
        description:
          "Duration of ActivityPub signature verification, including local " +
          "key lookup and remote key fetches.",
        unit: "ms",
        advice: {
          explicitBucketBoundaries: [
            0.1,
            0.25,
            0.5,
            1,
            2.5,
            5,
            10,
            25,
            50,
            100,
            250,
            500,
            1000,
          ],
        },
      },
    );
    this.signatureKeyFetchDuration = meter.createHistogram(
      "activitypub.signature.key_fetch.duration",
      {
        description:
          "Duration of public key lookup performed during ActivityPub " +
          "signature verification.",
        unit: "ms",
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
    this.queueDepth = meter.createObservableGauge("fedify.queue.depth", {
      description:
        "Messages waiting in configured Fedify queues, as reported by the " +
        "queue backend.",
      unit: "{message}",
    });
    this.fanoutRecipients = meter.createHistogram(
      "activitypub.fanout.recipients",
      {
        description:
          "Number of recipient inboxes produced by an ActivityPub fanout " +
          "task.",
        unit: "{recipient}",
      },
    );
    this.inboxActivity = meter.createCounter("activitypub.inbox.activity", {
      description:
        "ActivityPub activities observed at the inbox lifecycle level: " +
        "queued, processed, retried, rejected, or abandoned.",
      unit: "{activity}",
    });
    this.outboxActivity = meter.createCounter("activitypub.outbox.activity", {
      description:
        "ActivityPub activities observed at the outbox lifecycle level: " +
        "queued, retried, or abandoned.  Per-recipient delivery counters " +
        "live on `activitypub.delivery.*`.",
      unit: "{activity}",
    });
    this.circuitBreakerStateChange = meter.createCounter(
      "activitypub.circuit_breaker.state_change",
      {
        description: "Outbound ActivityPub delivery circuit breaker changes.",
        unit: "{change}",
      },
    );
    this.keyLookup = meter.createCounter("activitypub.key.lookup", {
      description:
        "Public-key lookup attempts performed by Fedify, including both " +
        "cache hits and remote fetches.",
      unit: "{lookup}",
    });
    this.keyLookupDuration = meter.createHistogram(
      "activitypub.key.lookup.duration",
      {
        description:
          "Duration of public-key lookups performed by Fedify, including " +
          "any remote fetch.",
        unit: "ms",
        advice: {
          // Reuse the OpenTelemetry HTTP server semantic-conventions buckets
          // since key lookups span the same 5 ms to 10 s range that other
          // network-bound histograms in this package already use.
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
    this.documentFetch = meter.createCounter("activitypub.document.fetch", {
      description:
        "Remote JSON-LD document loader invocations made by Fedify-wrapped " +
        "loaders.",
      unit: "{fetch}",
    });
    this.documentFetchDuration = meter.createHistogram(
      "activitypub.document.fetch.duration",
      {
        description:
          "Duration of remote JSON-LD document loader invocations made by " +
          "Fedify-wrapped loaders.",
        unit: "ms",
        advice: {
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
    this.documentCache = meter.createCounter("activitypub.document.cache", {
      description:
        "KV-backed document loader cache lookups, with `hit` or `miss` " +
        "classification.",
      unit: "{lookup}",
    });
    this.webFingerHandle = meter.createCounter("webfinger.handle", {
      description:
        "Incoming WebFinger requests handled by Fedify, classified by " +
        "terminal outcome.",
      unit: "{request}",
    });
    this.webFingerHandleDuration = meter.createHistogram(
      "webfinger.handle.duration",
      {
        description:
          "Duration of incoming WebFinger request handling in Fedify.",
        unit: "ms",
        advice: {
          // Reuse the OpenTelemetry HTTP server semantic-conventions buckets
          // since WebFinger requests follow the same 5 ms to 10 s range as
          // the rest of Fedify's request path.
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
    this.collectionRequest = meter.createCounter(
      "activitypub.collection.request",
      {
        description:
          "ActivityPub collection and collection-page requests handled by " +
          "Fedify.",
        unit: "{request}",
      },
    );
    this.collectionDispatchDuration = meter.createHistogram(
      "activitypub.collection.dispatch.duration",
      {
        description: "Duration of ActivityPub collection dispatcher callbacks.",
        unit: "ms",
        advice: {
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
    this.collectionPageItems = meter.createHistogram(
      "activitypub.collection.page.items",
      {
        description: "Number of items Fedify materialized for an ActivityPub " +
          "collection response.",
        unit: "{item}",
      },
    );
    this.collectionTotalItems = meter.createHistogram(
      "activitypub.collection.total_items",
      {
        description:
          "Total item count reported by ActivityPub collection counters.",
        unit: "{item}",
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

  recordSignatureVerificationDuration(
    durationMs: number,
    kind: SignatureVerificationKind,
    result: SignatureVerificationResult,
    extra: SignatureVerificationExtraAttributes = {},
  ): void {
    const attributes: Attributes = {
      "activitypub.signature.kind": kind,
      "activitypub.signature.result": result,
    };
    if (extra.algorithm != null) {
      attributes["http_signatures.algorithm"] = extra.algorithm;
    }
    if (extra.failureReason != null) {
      attributes["http_signatures.failure_reason"] = extra.failureReason;
    }
    if (extra.ldType != null) {
      attributes["ld_signatures.type"] = extra.ldType;
    }
    if (extra.cryptosuite != null) {
      attributes["object_integrity_proofs.cryptosuite"] = extra.cryptosuite;
    }
    this.signatureVerificationDuration.record(durationMs, attributes);
  }

  recordSignatureKeyFetchDuration(
    durationMs: number,
    kind: SignatureVerificationKind,
    result: SignatureKeyFetchResult,
  ): void {
    this.signatureKeyFetchDuration.record(durationMs, {
      "activitypub.signature.kind": kind,
      "activitypub.signature.key_fetch.result": result,
    });
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
    failureReason?: QueueTaskFailureReason,
  ): void {
    const attributes = buildQueueTaskAttributes(common);
    attributes["fedify.queue.task.result"] = result;
    if (failureReason != null && result === "failed") {
      attributes["fedify.task.failure_reason"] = failureReason;
    }
    if (result === "completed") {
      this.queueTaskCompleted.add(1, attributes);
    } else if (result === "failed") {
      this.queueTaskFailed.add(1, attributes);
    }
    this.queueTaskDuration.record(durationMs, attributes);
  }

  recordFanoutRecipients(recipientCount: number, activityType?: string): void {
    const attributes: Attributes = {};
    if (activityType != null) {
      attributes["activitypub.activity.type"] = activityType;
    }
    this.fanoutRecipients.record(recipientCount, attributes);
  }

  recordInboxActivity(
    result: InboxActivityResult,
    activityType?: string,
  ): void {
    this.inboxActivity.add(
      1,
      buildActivityLifecycleAttributes(result, activityType),
    );
  }

  recordOutboxActivity(
    result: OutboxActivityResult,
    activityType?: string,
  ): void {
    this.outboxActivity.add(
      1,
      buildActivityLifecycleAttributes(result, activityType),
    );
  }

  recordCircuitBreakerStateChange(
    remoteHost: string,
    state: CircuitBreakerMetricState,
  ): void {
    this.circuitBreakerStateChange.add(1, {
      "activitypub.remote.host": remoteHost,
      "activitypub.circuit_breaker.state": state,
    });
  }

  recordKeyLookup(attrs: KeyLookupAttributes): void {
    const attributes: Attributes = {
      "activitypub.lookup.kind": "public_key",
      "activitypub.lookup.result": attrs.result,
      "activitypub.cache.enabled": attrs.cacheEnabled,
    };
    if (attrs.remoteUrl != null) {
      attributes["activitypub.remote.host"] = getRemoteHost(attrs.remoteUrl);
    }
    if (attrs.statusCode != null) {
      attributes["http.response.status_code"] = attrs.statusCode;
    }
    this.keyLookup.add(1, attributes);
    this.keyLookupDuration.record(attrs.durationMs, attributes);
  }

  recordDocumentFetch(attrs: DocumentFetchAttributes): void {
    const attributes: Attributes = {
      "activitypub.lookup.kind": attrs.kind,
      "activitypub.lookup.result": attrs.result,
    };
    if (attrs.remoteUrl != null) {
      attributes["activitypub.remote.host"] = getRemoteHost(attrs.remoteUrl);
    }
    if (attrs.cacheEnabled != null) {
      attributes["activitypub.cache.enabled"] = attrs.cacheEnabled;
    }
    if (attrs.statusCode != null) {
      attributes["http.response.status_code"] = attrs.statusCode;
    }
    this.documentFetch.add(1, attributes);
    this.documentFetchDuration.record(attrs.durationMs, attributes);
  }

  recordDocumentCache(attrs: DocumentCacheAttributes): void {
    const attributes: Attributes = {
      "activitypub.lookup.kind": attrs.kind,
      "activitypub.lookup.result": attrs.result,
    };
    if (attrs.remoteUrl != null) {
      attributes["activitypub.remote.host"] = getRemoteHost(attrs.remoteUrl);
    }
    this.documentCache.add(1, attributes);
  }

  recordWebFingerHandle(attrs: WebFingerHandleAttributes): void {
    const attributes: Attributes = {
      "webfinger.handle.result": attrs.result,
    };
    if (attrs.scheme != null) {
      attributes["webfinger.resource.scheme"] = attrs.scheme;
    }
    if (attrs.statusCode != null) {
      attributes["http.response.status_code"] = attrs.statusCode;
    }
    this.webFingerHandle.add(1, attributes);
    this.webFingerHandleDuration.record(attrs.durationMs, attributes);
  }

  recordCollectionRequest(attrs: CollectionMetricAttributes): void {
    this.collectionRequest.add(1, buildCollectionAttributes(attrs));
  }

  recordCollectionDispatchDuration(
    durationMs: number,
    attrs: CollectionMetricAttributes,
  ): void {
    this.collectionDispatchDuration.record(
      durationMs,
      buildCollectionAttributes(attrs),
    );
  }

  recordCollectionPageItems(
    itemCount: number,
    attrs: CollectionMetricAttributes,
  ): void {
    this.collectionPageItems.record(
      itemCount,
      buildCollectionAttributes(attrs),
    );
  }

  recordCollectionTotalItems(
    totalItems: number,
    attrs: CollectionMetricAttributes,
  ): void {
    this.collectionTotalItems.record(
      totalItems,
      buildCollectionAttributes(attrs),
    );
  }
}

function buildCollectionAttributes(
  attrs: CollectionMetricAttributes,
): Attributes {
  const attributes: Attributes = {
    "activitypub.collection.kind": attrs.kind,
    "activitypub.collection.page": attrs.page,
    "activitypub.collection.result": attrs.result,
    "fedify.collection.dispatcher": attrs.dispatcher,
  };
  if (attrs.statusCode != null) {
    attributes["http.response.status_code"] = attrs.statusCode;
  }
  return attributes;
}

function buildActivityLifecycleAttributes(
  result: InboxActivityResult | OutboxActivityResult,
  activityType?: string,
): Attributes {
  const attributes: Attributes = {
    "activitypub.processing.result": result,
  };
  if (activityType != null) {
    attributes["activitypub.activity.type"] = activityType;
  }
  return attributes;
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
  if (common.taskName != null) {
    attributes["fedify.task.name"] = common.taskName;
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
 * Registers a callback for observing queue backend depth.
 * @since 2.3.0
 */
export function registerQueueDepthGauge(
  meterProvider: MeterProvider,
  entries: readonly QueueDepthGaugeEntry[],
  options: QueueDepthGaugeOptions = {},
): void {
  const uniqueQueues = new Map<MessageQueue, QueueTaskRole[]>();
  for (const { role, queue } of entries) {
    if (queue?.getDepth == null) continue;
    const roles = uniqueQueues.get(queue);
    if (roles == null) {
      uniqueQueues.set(queue, [role]);
    } else if (!roles.includes(role)) {
      roles.push(role);
    }
  }
  if (uniqueQueues.size < 1) return;
  const queueEntries = Array.from(uniqueQueues.entries());
  const gauge = getFederationMetrics(meterProvider).queueDepth;
  gauge.addCallback(async (observableResult) => {
    await Promise.all(queueEntries.map(async ([queue, roles]) => {
      let depth;
      try {
        depth = await queue.getDepth!();
      } catch {
        return;
      }
      if (depth == null) return;
      const attributes = buildQueueDepthAttributes(queue, roles, options);
      observableResult.observe(depth.queued, {
        ...attributes,
        "fedify.queue.depth.state": "queued",
      });
      if (depth.ready != null) {
        observableResult.observe(depth.ready, {
          ...attributes,
          "fedify.queue.depth.state": "ready",
        });
      }
      if (depth.delayed != null) {
        observableResult.observe(depth.delayed, {
          ...attributes,
          "fedify.queue.depth.state": "delayed",
        });
      }
    }));
  });
}

function buildQueueDepthAttributes(
  queue: MessageQueue,
  roles: readonly QueueTaskRole[],
  options: QueueDepthGaugeOptions,
): Attributes {
  const sortedRoles = roles.toSorted();
  const role = sortedRoles.length === 1 ? sortedRoles[0] : "shared";
  const attributes: Attributes = {
    "fedify.queue.role": role,
  };
  if (options.sourceId != null) {
    attributes["fedify.federation.instance_id"] = options.sourceId;
  }
  if (role === "shared") {
    attributes["fedify.queue.roles"] = sortedRoles.join(",");
  }
  const backend = getQueueBackend(queue);
  if (backend != null) {
    attributes["fedify.queue.backend"] = backend;
  }
  const nativeRetrial = queue.nativeRetrial;
  if (typeof nativeRetrial === "boolean") {
    attributes["fedify.queue.native_retrial"] = nativeRetrial;
  }
  return attributes;
}

/**
 * Records `fedify.queue.task.enqueued` for an outgoing outbox enqueue and,
 * for the initial attempt, also records
 * `activitypub.outbox.activity{queued}`.
 *
 * Both `Context.sendActivity()` and `OutboxContext.forwardActivity()` enqueue
 * outbox messages with the same metric attributes (role, queue, activity
 * type, attempt), so they share this helper rather than each defining a local
 * closure.  Retry enqueues (attempt > 0) intentionally do not record a
 * second `activitypub.outbox.activity{queued}`; retries are reported as
 * `result=retried` from the retry-scheduling site, which has the failure
 * context.
 * @since 2.3.0
 */
export function recordOutboxEnqueue(
  meterProvider: MeterProvider | undefined,
  outboxQueue: MessageQueue,
  message: { readonly activityType: string; readonly attempt: number },
): void {
  const metrics = getFederationMetrics(meterProvider);
  metrics.recordQueueTaskEnqueued(
    {
      role: "outbox",
      queue: outboxQueue,
      activityType: message.activityType,
    },
    message.attempt,
  );
  if (message.attempt === 0) {
    metrics.recordOutboxActivity("queued", message.activityType);
  }
}

/**
 * Records `activitypub.fanout.recipients` with the number of recipient
 * inboxes a single fanout produced.  The histogram is unitless count
 * (one measurement per fanout enqueue).  Recipient URLs are deliberately
 * not recorded; only the activity type, when known.
 * @since 2.3.0
 */
export function recordFanoutRecipients(
  meterProvider: MeterProvider | undefined,
  recipientCount: number,
  activityType?: string,
): void {
  getFederationMetrics(meterProvider).recordFanoutRecipients(
    recipientCount,
    activityType,
  );
}

/**
 * Records one `activitypub.inbox.activity` measurement.  The
 * `activitypub.processing.result` attribute is always present;
 * `activitypub.activity.type` is recorded only when Fedify already knows
 * the activity type.
 * @since 2.3.0
 */
export function recordInboxActivity(
  meterProvider: MeterProvider | undefined,
  result: InboxActivityResult,
  activityType?: string,
): void {
  getFederationMetrics(meterProvider).recordInboxActivity(result, activityType);
}

/**
 * Records one `activitypub.outbox.activity` measurement.  The
 * `activitypub.processing.result` attribute is always present;
 * `activitypub.activity.type` is recorded only when Fedify already knows
 * the activity type (it is always known for outbox lifecycle events).
 * @since 2.3.0
 */
export function recordOutboxActivity(
  meterProvider: MeterProvider | undefined,
  result: OutboxActivityResult,
  activityType?: string,
): void {
  getFederationMetrics(meterProvider).recordOutboxActivity(
    result,
    activityType,
  );
}

/**
 * Records one outbound delivery circuit breaker state transition.
 * @since 2.3.0
 */
export function recordCircuitBreakerStateChange(
  meterProvider: MeterProvider | undefined,
  remoteHost: string,
  state: CircuitBreakerMetricState,
): void {
  getFederationMetrics(meterProvider).recordCircuitBreakerStateChange(
    remoteHost,
    state,
  );
}

/**
 * Records one measurement on `activitypub.key.lookup` (counter) and
 * `activitypub.key.lookup.duration` (histogram) for a public-key lookup.
 *
 * `activitypub.lookup.kind` is always recorded as `public_key`; the result
 * classification, remote host, HTTP status code (when an HTTP response was
 * received), and `activitypub.cache.enabled` are recorded as attributes on
 * both measurements.  Full key URLs and key IDs are deliberately omitted to
 * keep cardinality bounded.
 * @since 2.3.0
 */
export function recordKeyLookup(
  meterProvider: MeterProvider | undefined,
  attrs: KeyLookupAttributes,
): void {
  getFederationMetrics(meterProvider).recordKeyLookup(attrs);
}

/**
 * Records one measurement each on `activitypub.document.fetch` (counter)
 * and `activitypub.document.fetch.duration` (histogram) for one remote
 * JSON-LD document loader invocation, with bounded
 * `activitypub.lookup.kind` and `activitypub.lookup.result` attributes
 * plus the optional remote-host, cache-enabled, and HTTP status-code
 * attributes.  Counter and histogram are always recorded together so
 * aggregate rate and latency views stay in sync.
 * @since 2.3.0
 */
export function recordDocumentFetch(
  meterProvider: MeterProvider | undefined,
  attrs: DocumentFetchAttributes,
): void {
  getFederationMetrics(meterProvider).recordDocumentFetch(attrs);
}

/**
 * Records one `activitypub.document.cache` measurement, classifying the
 * lookup as `hit` (the cache returned an entry) or `miss` (the cache was
 * consulted and returned nothing, prompting a delegate fetch).
 * @since 2.3.0
 */
export function recordDocumentCache(
  meterProvider: MeterProvider | undefined,
  attrs: DocumentCacheAttributes,
): void {
  getFederationMetrics(meterProvider).recordDocumentCache(attrs);
}

/**
 * Records one measurement on `webfinger.handle` (counter) and
 * `webfinger.handle.duration` (histogram) for an incoming WebFinger
 * request handled by Fedify.  Counter and histogram are always recorded
 * together, with `webfinger.handle.result` set to one of `resolved`,
 * `invalid`, `not_found`, `tombstoned`, or `error`.  The queried
 * resource string is deliberately excluded; it remains on the
 * `webfinger.handle` span for trace-level investigation.
 * @since 2.3.0
 */
export function recordWebFingerHandle(
  meterProvider: MeterProvider | undefined,
  attrs: WebFingerHandleAttributes,
): void {
  getFederationMetrics(meterProvider).recordWebFingerHandle(attrs);
}

/**
 * Records one `activitypub.collection.request` measurement for a
 * collection or collection-page request handled by Fedify.
 * @since 2.3.0
 */
export function recordCollectionRequest(
  meterProvider: MeterProvider | undefined,
  attrs: CollectionMetricAttributes,
): void {
  getFederationMetrics(meterProvider).recordCollectionRequest(attrs);
}

/**
 * Records one `activitypub.collection.dispatch.duration` measurement for a
 * collection dispatcher callback invocation.
 * @since 2.3.0
 */
export function recordCollectionDispatchDuration(
  meterProvider: MeterProvider | undefined,
  durationMs: number,
  attrs: CollectionMetricAttributes,
): void {
  getFederationMetrics(meterProvider).recordCollectionDispatchDuration(
    durationMs,
    attrs,
  );
}

/**
 * Records one `activitypub.collection.page.items` measurement when Fedify
 * has materialized collection items in memory.
 * @since 2.3.0
 */
export function recordCollectionPageItems(
  meterProvider: MeterProvider | undefined,
  itemCount: number,
  attrs: CollectionMetricAttributes,
): void {
  getFederationMetrics(meterProvider).recordCollectionPageItems(
    itemCount,
    attrs,
  );
}

/**
 * Records one `activitypub.collection.total_items` measurement when a
 * collection counter has already reported a total item count.
 * @since 2.3.0
 */
export function recordCollectionTotalItems(
  meterProvider: MeterProvider | undefined,
  totalItems: number,
  attrs: CollectionMetricAttributes,
): void {
  getFederationMetrics(meterProvider).recordCollectionTotalItems(
    totalItems,
    attrs,
  );
}

/**
 * Classifies a thrown value from a key or document fetch into the bounded
 * {@link LookupResult} taxonomy and, when an HTTP response was received,
 * surfaces its status code.
 *
 *  -  `FetchError` with a `Response` whose status is `404` or `410`:
 *     `result=not_found` and the response status code.
 *  -  `FetchError` with any other `Response`: `result=error` and the
 *     response status code.
 *  -  `FetchError` without a `Response`: `result=network_error`.
 *  -  An `AbortError` (typically from a cancelled fetch): `result=network_error`.
 *  -  A bare `TypeError` (the shape native `fetch()` raises on DNS, connect,
 *     and TLS failures before any response is observed):
 *     `result=network_error`.
 *  -  Any other value: `result=error`.
 * @since 2.3.0
 */
export function classifyFetchError(
  error: unknown,
): { result: DocumentFetchResult; statusCode?: number } {
  if (error instanceof FetchError) {
    if (error.response != null) {
      const status = error.response.status;
      const result: DocumentFetchResult = status === 404 || status === 410
        ? "not_found"
        : "error";
      return { result, statusCode: status };
    }
    return { result: "network_error" };
  }
  if (isAbortError(error)) return { result: "network_error" };
  if (error instanceof TypeError) return { result: "network_error" };
  return { result: "error" };
}

/**
 * Options for {@link instrumentDocumentLoader}.
 * @since 2.3.0
 */
export interface InstrumentDocumentLoaderOptions {
  /**
   * The OpenTelemetry meter provider used to record
   * `activitypub.document.fetch` and `activitypub.document.fetch.duration`
   * measurements.  When omitted, the wrapper records nothing and simply
   * delegates to the wrapped loader.
   */
  meterProvider?: MeterProvider;

  /**
   * The lookup kind recorded on `activitypub.lookup.kind`.  Set to
   * `"object"` for the generic document loader, `"context"` for the
   * context loader, and `"other"` for callers that do not fit the
   * generic-object classification.
   */
  kind: DocumentFetchKind;

  /**
   * Whether the wrapped loader is cache-backed (for example via
   * {@link import("../utils/kv-cache.ts").kvCache}).  Recorded as
   * `activitypub.cache.enabled` on every measurement; omitted from the
   * attribute set when the option is not set.
   */
  cacheEnabled?: boolean;
}

/**
 * Wraps a {@link DocumentLoader} so each invocation records one
 * measurement on `activitypub.document.fetch` (counter) and one on
 * `activitypub.document.fetch.duration` (histogram), classifying the
 * outcome via {@link classifyFetchError} when the wrapped loader throws
 * and as `fetched` on success.  The wrapper rethrows whatever the
 * wrapped loader throws so caller behavior is unchanged.
 *
 * The wrapper records the host of the requested URL, including any
 * non-default port, on `activitypub.remote.host` when the URL parses; full
 * URLs, paths, and query strings are deliberately excluded to keep
 * cardinality bounded.
 * HTTP status codes are recorded only when the failure carries a
 * `Response` (currently, when the wrapped loader throws a
 * {@link FetchError} with a non-`null` `response`).
 * @since 2.3.0
 */
export function instrumentDocumentLoader(
  loader: DocumentLoader,
  options: InstrumentDocumentLoaderOptions,
): DocumentLoader {
  const meterProvider = options.meterProvider;
  if (meterProvider == null) return loader;
  return async (url, opts) => {
    const start = performance.now();
    let remoteUrl: URL | undefined;
    try {
      remoteUrl = new URL(url);
    } catch {
      remoteUrl = undefined;
    }
    try {
      const result = await loader(url, opts);
      recordDocumentFetch(meterProvider, {
        durationMs: getDurationMs(start),
        kind: options.kind,
        result: "fetched",
        remoteUrl,
        cacheEnabled: options.cacheEnabled,
      });
      return result;
    } catch (error) {
      const classified = classifyFetchError(error);
      recordDocumentFetch(meterProvider, {
        durationMs: getDurationMs(start),
        kind: options.kind,
        result: classified.result,
        remoteUrl,
        cacheEnabled: options.cacheEnabled,
        statusCode: classified.statusCode,
      });
      throw error;
    }
  };
}

/**
 * Times an awaited public key fetch and records exactly one
 * `activitypub.signature.key_fetch.duration` measurement, classifying the
 * outcome as `hit`, `fetched`, or `error` based on the `cached` flag and
 * whether the returned key is non-null.  Errors thrown by the fetch are
 * reported as `error` and rethrown, so verifier behavior is unchanged.
 *
 * Shared by the three signature verifiers (HTTP, Linked Data, Object
 * Integrity Proofs); the only per-call variation is the
 * `activitypub.signature.kind` attribute value.
 * @since 2.3.0
 */
export async function measureSignatureKeyFetch<
  T extends { readonly cached: boolean; readonly key: unknown },
>(
  meterProvider: MeterProvider | undefined,
  kind: SignatureVerificationKind,
  fetch: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fetch();
    getFederationMetrics(meterProvider).recordSignatureKeyFetchDuration(
      getDurationMs(start),
      kind,
      result.key != null ? (result.cached ? "hit" : "fetched") : "error",
    );
    return result;
  } catch (error) {
    getFederationMetrics(meterProvider).recordSignatureKeyFetchDuration(
      getDurationMs(start),
      kind,
      "error",
    );
    throw error;
  }
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
  return url.host;
}

/**
 * Gets an elapsed duration in milliseconds from a `performance.now()` value.
 * @since 2.3.0
 */
export function getDurationMs(start: number): number {
  return Math.max(0, performance.now() - start);
}
