import { relayBuilder } from "./builder.ts";
import { LitePubRelay } from "./litepub.ts";
import { MastodonRelay } from "./mastodon.ts";
import type { Relay, RelayOptions, RelayType } from "./types.ts";

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
 *   origin: "https://relay.example.com",
 *   subscriptionHandler: async (ctx, actor) => true,
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
