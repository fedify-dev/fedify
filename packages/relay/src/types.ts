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
  origin: string;
  name?: string;
  documentLoaderFactory?: DocumentLoaderFactory;
  authenticatedDocumentLoaderFactory?: AuthenticatedDocumentLoaderFactory;
  queue?: MessageQueue;
  subscriptionHandler: SubscriptionRequestHandler;
}

/**
 * Internal storage format for follower data in KV store.
 * Contains JSON-LD representation of the actor.
 * Exported for internal package use but not re-exported from mod.ts.
 *
 * @internal
 */
export interface RelayFollowerData {
  /** The actor's JSON-LD representation (serialized for storage). */
  readonly actor: unknown;
  /** The follower's state. */
  readonly state: "pending" | "accepted";
}

/**
 * A follower of the relay with validated Actor instance.
 * This is the public API type returned by follower query methods.
 *
 * @since 2.0.0
 */
export interface RelayFollower {
  /** The actor ID (URL) of the follower. */
  readonly actorId: string;
  /** The validated Actor object. */
  readonly actor: Actor;
  /** The follower's state. */
  readonly state: "pending" | "accepted";
}

/**
 * Public interface for ActivityPub relay implementations.
 * Use {@link createRelay} to create a relay instance.
 *
 * @since 2.0.0
 */
export interface Relay {
  /**
   * Handle incoming HTTP requests.
   *
   * @param request The incoming HTTP request
   * @returns The HTTP response
   */
  fetch(request: Request): Promise<Response>;

  /**
   * Lists all followers of the relay.
   *
   * @returns An async iterator of follower entries
   */
  listFollowers(): AsyncIterableIterator<RelayFollower>;

  /**
   * Gets a specific follower by actor ID.
   *
   * @param actorId The actor ID (URL) of the follower to retrieve
   * @returns The follower entry if found, null otherwise
   */
  getFollower(actorId: string): Promise<RelayFollower | null>;

  /**
   * Gets the URI of the relay actor.
   *
   * @returns The URI of the relay actor
   */
  getActorUri(): Promise<URL>;

  /**
   * Gets the shared inbox URI of the relay.
   *
   * @returns The shared inbox URI
   */
  getSharedInboxUri(): Promise<URL>;
}

/**
 * Type predicate to check if a value is valid RelayFollowerData from KV store.
 * Validates the storage format (JSON-LD), not the deserialized Actor instance.
 *
 * @param value The value to check
 * @returns true if the value is a RelayFollowerData
 * @internal
 */
export function isRelayFollowerData(
  value: unknown,
): value is RelayFollowerData {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    "actor" in obj &&
    "state" in obj &&
    typeof obj.state === "string" &&
    (obj.state === "pending" || obj.state === "accepted")
  );
}
