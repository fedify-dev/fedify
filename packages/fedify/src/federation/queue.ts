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
  readonly baseUrl: string;
  readonly keys: readonly SenderKeyJwkPair[];
  readonly inboxes: Readonly<
    Record<
      string,
      { readonly actorIds: readonly string[]; readonly sharedInbox: boolean }
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
  readonly started: string;
  readonly attempt: number;
  readonly identifier: string | null;
  readonly traceContext: Readonly<Record<string, string>>;
}
