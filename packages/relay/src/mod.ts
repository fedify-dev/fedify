/**
 * ActivityPub relay integration for Fedify.
 *
 * This module provides ActivityPub relay implementations that can forward
 * activities between federated instances. It includes both Mastodon-compatible
 * and LitePub-compatible relay implementations.
 *
 * @module
 */

// Export relay functionality here
export {
  createRelay,
  type Relay,
  RELAY_SERVER_ACTOR,
  type RelayFollower,
  type RelayOptions,
  type RelayType,
  type SubscriptionRequestHandler,
} from "./relay.ts";

export { MastodonRelay } from "./mastodon.ts";
export { LitePubRelay } from "./litepub.ts";
