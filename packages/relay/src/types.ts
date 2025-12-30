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
  subscriptionHandler: SubscriptionRequestHandler;
}

export interface RelayFollower {
  readonly actor: unknown;
  readonly state: "pending" | "accepted";
}

/**
 * Type predicate to check if a value is a valid RelayFollower.
 * Provides both runtime validation and compile-time type narrowing.
 *
 * @param value The value to check
 * @returns true if the value is a RelayFollower
 */
export function isRelayFollower(value: unknown): value is RelayFollower {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    "actor" in obj &&
    "state" in obj &&
    typeof obj.state === "string" &&
    (obj.state === "pending" || obj.state === "accepted")
  );
}
