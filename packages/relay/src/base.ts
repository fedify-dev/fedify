import type { Federation, FederationBuilder } from "@fedify/fedify";
import type {
  RelayFollower,
  RelayFollowerEntry,
  RelayOptions,
} from "./types.ts";

/**
 * Abstract base class for relay implementations.
 * Provides common infrastructure for both Mastodon and LitePub relays.
 *
 * @since 2.0.0
 */
export abstract class BaseRelay {
  protected federationBuilder: FederationBuilder<RelayOptions>;
  protected options: RelayOptions;
  protected federation?: Federation<RelayOptions>;

  constructor(
    options: RelayOptions,
    relayBuilder: FederationBuilder<RelayOptions>,
  ) {
    this.options = options;
    this.federationBuilder = relayBuilder;
  }

  async fetch(request: Request): Promise<Response> {
    if (this.federation == null) {
      this.federation = await this.federationBuilder.build(this.options);
      this.setupInboxListeners();
    }

    return await this.federation.fetch(request, {
      contextData: this.options,
    });
  }

  /**
   * Lists all followers of the relay.
   *
   * @returns An async iterator of follower entries
   *
   * @example
   * ```ts
   * for await (const follower of relay.listFollowers()) {
   *   console.log(`Follower: ${follower.actorId}`);
   *   console.log(`State: ${follower.state}`);
   * }
   * ```
   *
   * @since 2.0.0
   */
  async *listFollowers(): AsyncIterableIterator<RelayFollowerEntry> {
    for await (const entry of this.options.kv.list(["follower"])) {
      const actorId = entry.key[1];
      const follower = entry.value as RelayFollower;
      if (typeof actorId === "string" && follower?.actor && follower?.state) {
        yield {
          actorId,
          actor: follower.actor,
          state: follower.state,
        };
      }
    }
  }

  /**
   * Gets a specific follower by actor ID.
   *
   * @param actorId The actor ID (URL) of the follower to retrieve
   * @returns The follower entry if found, null otherwise
   *
   * @example
   * ```ts
   * const follower = await relay.getFollower("https://mastodon.example.com/users/alice");
   * if (follower) {
   *   console.log(`State: ${follower.state}`);
   * }
   * ```
   *
   * @since 2.0.0
   */
  async getFollower(actorId: string): Promise<RelayFollowerEntry | null> {
    const follower = await this.options.kv.get<RelayFollower>([
      "follower",
      actorId,
    ]);
    if (follower == null) return null;

    return {
      actorId,
      actor: follower.actor,
      state: follower.state,
    };
  }

  /**
   * Set up inbox listeners for handling ActivityPub activities.
   * Each relay type implements this method with protocol-specific logic.
   */
  protected abstract setupInboxListeners(): void;
}
