import type { SerializedInboxAuthentication } from "./inbox-authentication.ts";
import type { SerializedVerifiedActivityView } from "./inbox-view.ts";

export interface SenderKeyJwkPair {
  readonly keyId: string;
  readonly privateKey: JsonWebKey;
}

/**
 * A message that represents a task to be processed by the background worker.
 * The concrete type of the message depends on the `type` property.
 *
 * Please do not depend on the concrete types of the messages, as they may
 * change in the future.  You should treat the `Message` type as an opaque
 * type.
 * @since 1.6.0
 */
export type Message =
  | FanoutMessage
  | OutboxMessage
  | InboxMessage
  | TaskMessage;

export interface FanoutMessage {
  readonly type: "fanout";
  readonly id: ReturnType<typeof crypto.randomUUID>;
  /**
   * The identifier of the broadcast (the `Context.sendActivity()` or
   * `~Context.forwardActivity()` call) that this fanout belongs to, shared
   * by every delivery it fans out into.  Absent on a message enqueued by a
   * version of Fedify that predates this field; such a fanout has no
   * recoverable broadcast identity other than its own {@link id}.
   * @internal
   */
  readonly broadcastId?: string;
  readonly baseUrl: string;
  readonly keys: readonly SenderKeyJwkPair[];
  readonly inboxes: Readonly<
    Record<
      string,
      {
        readonly actorIds: readonly string[];
        readonly sharedInbox: boolean;
        /**
         * The identifier of this deduplicated destination's delivery,
         * stable across retries, holds, and gateway-list changes.  Absent
         * on a message enqueued by a version of Fedify that predates this
         * field.
         * @internal
         */
        readonly deliveryId?: string;
        /**
         * The canonical form of the FEP-ef61 portable inbox that the inbox
         * stands for.
         * @internal
         */
        readonly portableInbox?: string;
        /**
         * The compatible identifiers of the portable inbox on each gateway to
         * deliver through, in order.
         * @internal
         */
        readonly gatewayInboxes?: readonly string[];
      }
    >
  >;
  readonly activity: unknown;
  readonly activityId?: string;
  readonly activityType: string;
  readonly collectionSync?: string;
  readonly orderingKey?: string;
  /**
   * Whether to apply outgoing JSON-LD wire-format normalization to queued
   * activities that already carry Object Integrity Proofs.
   *
   * `true` is used for proofs Fedify created before fanout, or when callers
   * explicitly request normalization for locally pre-signed activities.
   * `false`/`undefined` preserves existing proofs as-is.
   */
  readonly normalizeExistingProofs?: boolean;
  readonly traceContext: Readonly<Record<string, string>>;
}

export interface OutboxMessage {
  readonly type: "outbox";
  readonly id: ReturnType<typeof crypto.randomUUID>;
  /**
   * The identifier of the broadcast (the `Context.sendActivity()` or
   * `~Context.forwardActivity()` call) that this delivery was fanned out
   * from.  Absent on a message enqueued by a version of Fedify that
   * predates this field.
   * @internal
   */
  readonly broadcastId?: string;
  /**
   * The identifier of this deduplicated destination's delivery, stable
   * across retries, holds, and gateway-list changes, i.e., across every
   * {@link OutboxMessage} that represents a later attempt at the same
   * delivery.  Absent on a message enqueued by a version of Fedify that
   * predates this field; {@link id} is itself stable across those same
   * mutations and is the fallback identity for such a message.
   * @internal
   */
  readonly deliveryId?: string;
  /**
   * Whether this delivery is an ordinary fallback attempt at one logical
   * destination (trying each of {@link gatewayInboxes} in turn until one
   * accepts), or a FEP-ef61 gateway's independent replication of an
   * activity it received to the portable actor's other gateways, each of
   * which must receive its own copy.  Absent on a message enqueued by a
   * version of Fedify that predates this field, or on a non-portable
   * delivery, which is always `"fallback"`.
   * @internal
   */
  readonly deliveryKind?: "fallback" | "replication";
  readonly baseUrl: string;
  readonly keys: readonly SenderKeyJwkPair[];
  readonly activity: unknown;
  readonly activityId?: string;
  readonly activityType: string;
  readonly inbox: string;
  readonly sharedInbox: boolean;
  readonly actorIds?: readonly string[];
  readonly started: string;
  readonly attempt: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly orderingKey?: string;
  /**
   * Whether this message is currently held by the outbound circuit breaker.
   * @internal
   */
  readonly circuitHeld?: true;
  /**
   * When Fedify first held this message because the remote host circuit was
   * open.
   * @internal
   */
  readonly circuitHeldSince?: string;
  /**
   * The canonical form of the FEP-ef61 portable inbox that {@link inbox}, its
   * compatible identifier on a gateway, stands for.
   * @internal
   */
  readonly portableInbox?: string;
  /**
   * The compatible identifiers of the FEP-ef61 portable inbox on each gateway
   * that is still to be tried, in order.  {@link inbox} is the first one.
   * If there is more than one, the activity is delivered through the first
   * gateway that accepts it.
   * @internal
   */
  readonly gatewayInboxes?: readonly string[];
  /**
   * The times before which each of {@link gatewayInboxes} must not be tried
   * again, as their responses' `Retry-After` headers requested, keyed by
   * the inbox URL, in ISO 8601.
   * @internal
   */
  readonly gatewayNotBefore?: Readonly<Record<string, string>>;
  readonly traceContext: Readonly<Record<string, string>>;
}

/**
 * A message that carries a custom background task.  Every field is
 * a string, number, or plain record so that the message survives both
 * JSON serialization and structured clone on every queue backend.
 * @since 2.4.0
 */
export interface TaskMessage {
  readonly type: "task";
  readonly id: ReturnType<typeof crypto.randomUUID>;
  readonly baseUrl: string;
  readonly taskName: string;
  /** devalue-encoded task data; vocab objects bridged to expanded JSON-LD. */
  readonly data: string;
  readonly started: string;
  readonly attempt: number;
  readonly orderingKey?: string;
  readonly traceContext: Readonly<Record<string, string>>;
}

export interface InboxMessage {
  readonly type: "inbox";
  readonly id: ReturnType<typeof crypto.randomUUID>;
  readonly baseUrl: string;
  readonly activity: unknown;
  /**
   * The normalized JSON-LD representation of a signed inbox activity that
   * Fedify already compacted successfully while accepting the request.  Queue
   * workers can reuse this producer-side parse cache under stricter loader or
   * network constraints without changing the raw payload preserved for
   * forwarding.
   *
   * This may exist even when {@link ldSignatureVerified} is `false`, because
   * fallback-authenticated traffic and already-queued backlog items can still
   * depend on the cached normalized form to avoid re-fetching remote custom
   * contexts during worker processing.
   *
   * This is optional for backward compatibility with messages that were
   * queued by older Fedify versions or that were already in a queue before
   * upgrading.
   *
   * Fedify keeps this on the queued message itself instead of an external
   * sidecar because generic queue backends do not provide reliable lifecycle
   * guarantees for auxiliary storage across retries and redeliveries.
   *
   * @internal
   */
  readonly normalizedActivity?: unknown;
  /**
   * Whether the producer actually verified the Linked Data Signature before
   * queueing this message.  This lets workers distinguish verified LDS replay
   * from other authenticated inbox traffic that merely happened to include a
   * signature block.  This provenance marker is separate from the optional
   * normalizedActivity parse cache.
   *
   * `undefined` preserves backward compatibility with older queued messages
   * that predate this marker.
   *
   * @internal
   */
  readonly ldSignatureVerified?: boolean;
  /**
   * The interpretation of the activity that Fedify authenticated, i.e., which
   * document it was parsed from and every JSON-LD context response the parse
   * used, so that the worker and its retries dispatch the very same
   * interpretation without loading contexts again.  Absent in messages queued
   * by older Fedify versions.
   * @internal
   */
  readonly verifiedView?: SerializedVerifiedActivityView;
  /**
   * Who Fedify authenticated for the activity.  Absent in messages queued by
   * older Fedify versions.
   * @internal
   */
  readonly authentication?: SerializedInboxAuthentication;
  readonly started: string;
  readonly attempt: number;
  readonly identifier: string | null;
  readonly traceContext: Readonly<Record<string, string>>;
}
