import type { Context, Federation, FederationBuilder } from "@fedify/fedify";
import { isActor, Object as APObject } from "@fedify/vocab";
import {
  isRelayFollowerData,
  type Relay,
  RELAY_SERVER_ACTOR,
  type RelayFollower,
  type RelayOptions,
} from "./types.ts";

/**
 * Abstract base class for relay implementations.
 * Provides common infrastructure for both Mastodon and LitePub relays.
 *
 * @internal
 */
export abstract class BaseRelay implements Relay {
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
    return await (await this.#getFederation()).fetch(request, {
      contextData: this.options,
    });
  }

  /**
   * Helper method to parse and validate follower data from storage.
   * Deserializes JSON-LD actor data and validates it.
   *
   * @param actorId The actor ID of the follower
   * @param data Raw data from KV store
   * @returns RelayFollower object if valid, null otherwise
   * @internal
   */
  private async parseFollowerData(
    actorId: string,
    data: unknown,
  ): Promise<RelayFollower | null> {
    if (!isRelayFollowerData(data)) return null;

    const actor = await APObject.fromJsonLd(data.actor);
    if (!isActor(actor)) return null;

    return {
      actorId,
      actor,
      state: data.state,
    };
  }

  /**
   * Lists all followers of the relay.
   *
   * @returns An async iterator of follower entries
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
   *
   * for await (const follower of relay.listFollowers()) {
   *   console.log(`Follower: ${follower.actorId}`);
   *   console.log(`State: ${follower.state}`);
   *   console.log(`Actor: ${follower.actor.name}`);
   * }
   * ```
   *
   * @since 2.0.0
   */
  async *listFollowers(): AsyncIterableIterator<RelayFollower> {
    for await (const entry of this.options.kv.list(["follower"])) {
      const actorId = entry.key[1];
      if (typeof actorId !== "string") continue;

      const follower = await this.parseFollowerData(actorId, entry.value);
      if (follower) yield follower;
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
   * import { createRelay } from "@fedify/relay";
   * import { MemoryKvStore } from "@fedify/fedify";
   *
   * const relay = createRelay("mastodon", {
   *   kv: new MemoryKvStore(),
   *   origin: "https://relay.example.com",
   *   subscriptionHandler: async (ctx, actor) => true,
   * });
   *
   * const follower = await relay.getFollower(
   *   "https://mastodon.example.com/users/alice"
   * );
   * if (follower) {
   *   console.log(`State: ${follower.state}`);
   *   console.log(`Actor: ${follower.actor.preferredUsername}`);
   * }
   * ```
   *
   * @since 2.0.0
   */
  async getFollower(actorId: string): Promise<RelayFollower | null> {
    const followerData = await this.options.kv.get(["follower", actorId]);
    return await this.parseFollowerData(actorId, followerData);
  }

  /**
   * Set up inbox listeners for handling ActivityPub activities.
   * Each relay type implements this method with protocol-specific logic.
   */
  protected abstract setupInboxListeners(): void;

  async #getFederation(): Promise<Federation<RelayOptions>> {
    if (this.federation == null) {
      this.federation = await this.federationBuilder.build(this.options);
      this.setupInboxListeners();
    }
    return this.federation;
  }

  async #createContext(): Promise<Context<RelayOptions>> {
    const context = (await this.#getFederation()).createContext(
      new URL(this.options.origin),
      this.options,
    );
    return context;
  }

  async getActorUri(): Promise<URL> {
    const context = await this.#createContext();
    return context.getActorUri(RELAY_SERVER_ACTOR);
  }

  async getSharedInboxUri(): Promise<URL> {
    const context = await this.#createContext();
    return context.getInboxUri();
  }
}
