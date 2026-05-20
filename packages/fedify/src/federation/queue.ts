export interface SenderKeyJwkPair {
  keyId: string;
  privateKey: JsonWebKey;
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
export type Message = FanoutMessage | OutboxMessage | InboxMessage;

export interface FanoutMessage {
  type: "fanout";
  id: ReturnType<typeof crypto.randomUUID>;
  baseUrl: string;
  keys: SenderKeyJwkPair[];
  inboxes: Record<string, { actorIds: string[]; sharedInbox: boolean }>;
  activity: unknown;
  activityId?: string;
  activityType: string;
  collectionSync?: string;
  traceContext: Record<string, string>;
}

export interface OutboxMessage {
  type: "outbox";
  id: ReturnType<typeof crypto.randomUUID>;
  baseUrl: string;
  keys: SenderKeyJwkPair[];
  activity: unknown;
  activityId?: string;
  activityType: string;
  inbox: string;
  sharedInbox: boolean;
  started: string;
  attempt: number;
  headers: Record<string, string>;
  traceContext: Record<string, string>;
}

export interface InboxMessage {
  type: "inbox";
  id: ReturnType<typeof crypto.randomUUID>;
  baseUrl: string;
  activity: unknown;
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
  normalizedActivity?: unknown;
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
  ldSignatureVerified?: boolean;
  started: string;
  attempt: number;
  identifier: string | null;
  traceContext: Record<string, string>;
}
