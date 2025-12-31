/**
 * ActivityPub relay integration for Fedify.
 *
 * This module provides ActivityPub relay implementations that can forward
 * activities between federated instances. It includes both Mastodon-compatible
 * and LitePub-compatible relay implementations.
 *
 * @module
 */
export { createRelay } from "./factory.ts";
export {
  type Relay,
  RELAY_SERVER_ACTOR,
  type RelayFollower,
  type RelayOptions,
  type RelayType,
  type SubscriptionRequestHandler,
} from "./types.ts";
