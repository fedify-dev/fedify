import type { Context, KvStore, MessageQueue } from "@fedify/fedify";
import type { Actor } from "@fedify/fedify/vocab";
import type {
  AuthenticatedDocumentLoaderFactory,
  DocumentLoaderFactory,
} from "@fedify/vocab-runtime";

export const RELAY_SERVER_ACTOR = "relay";

/**
 * Supported relay types.
 */
export type RelayType = "mastodon" | "litepub";

/**
 * Handler for subscription requests (Follow/Undo activities).
 */
export type SubscriptionRequestHandler = (
  ctx: Context<RelayOptions>,
  clientActor: Actor,
) => Promise<boolean>;

/**
 * Configuration options for the ActivityPub relay.
 */
export interface RelayOptions {
  kv: KvStore;
  domain?: string;
  name?: string;
  documentLoaderFactory?: DocumentLoaderFactory;
  authenticatedDocumentLoaderFactory?: AuthenticatedDocumentLoaderFactory;
  queue?: MessageQueue;
  subscriptionHandler?: SubscriptionRequestHandler;
}

export interface RelayFollower {
  readonly actor: unknown;
  readonly state: "pending" | "accepted";
}
