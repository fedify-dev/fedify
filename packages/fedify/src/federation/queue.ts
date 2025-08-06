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
  started: string;
  attempt: number;
  identifier: string | null;
  traceContext: Record<string, string>;
}
