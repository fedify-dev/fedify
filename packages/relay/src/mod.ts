/**
 * ActivityPub relay integration for Fedify.
 *
 * This module provides ActivityPub relay implementations that can forward
 * activities between federated instances. It includes both Mastodon-compatible
 * and LitePub-compatible relay implementations.
 *
 * @module
 */
export { relayBuilder } from "./builder.ts";
export { createRelay } from "./factory.ts";
export { LitePubRelay } from "./litepub.ts";
export { MastodonRelay } from "./mastodon.ts";
export {
  RELAY_SERVER_ACTOR,
  type RelayFollower,
  type RelayOptions,
  type RelayType,
  type SubscriptionRequestHandler,
} from "./types.ts";
