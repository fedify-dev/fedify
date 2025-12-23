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
  BaseRelay,
  type Relay,
  RELAY_SERVER_ACTOR,
  relayBuilder,
  type RelayFollower,
  type RelayOptions,
  type RelayType,
  type SubscriptionRequestHandler,
} from "./relay.ts";

export { MastodonRelay } from "./mastodon.ts";
export { LitePubRelay } from "./litepub.ts";

import type { Relay, RelayOptions, RelayType } from "./relay.ts";
import { relayBuilder } from "./relay.ts";
import { MastodonRelay } from "./mastodon.ts";
import { LitePubRelay } from "./litepub.ts";

/**
 * Factory function to create a relay instance.
 *
 * @param type The type of relay to create ("mastodon" or "litepub")
 * @param options Configuration options for the relay
 * @returns A relay instance
 *
 * @example
 * ```ts
 * import { createRelay } from "@fedify/relay";
 * import { MemoryKvStore } from "@fedify/fedify";
 *
 * const relay = createRelay("mastodon", {
 *   kv: new MemoryKvStore(),
 *   domain: "relay.example.com",
 * });
 * ```
 *
 * @since 2.0.0
 */
export function createRelay(
  type: RelayType,
  options: RelayOptions,
): Relay {
  switch (type) {
    case "mastodon":
      return new MastodonRelay(options, relayBuilder);
    case "litepub":
      return new LitePubRelay(options, relayBuilder);
  }
}
