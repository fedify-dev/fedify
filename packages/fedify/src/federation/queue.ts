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
export type Message = FanoutMessage | OutboxMessage | InboxMessage;

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
  readonly started: string;
  readonly attempt: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly traceContext: Readonly<Record<string, string>>;
}

export interface InboxMessage {
  readonly type: "inbox";
  readonly id: ReturnType<typeof crypto.randomUUID>;
  readonly baseUrl: string;
  readonly activity: unknown;
  readonly started: string;
  readonly attempt: number;
  readonly identifier: string | null;
  readonly traceContext: Readonly<Record<string, string>>;
}
