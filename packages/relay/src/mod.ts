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
export type { Relay, RelayOptions } from "./relay.ts";
export { LitePubRelay, MastodonRelay } from "./relay.ts";
