import type {
  Context,
  Federation,
  FederationBuilder,
  InboxContext,
  InboxListenerSetters,
} from "@fedify/fedify";
import {
  type Actor,
  Announce,
  Create,
  Delete,
  Follow,
  isActor,
  Move,
  Object as APObject,
  Undo,
  Update,
} from "@fedify/vocab";
import type { Logger } from "@logtape/logtape";
import {
  handleUndoFollow,
  sendFollowResponse,
  validateFollowActivity,
} from "./follow.ts";
import {
  isRelayFollowerData,
  type Relay,
  RELAY_SERVER_ACTOR,
  type RelayFollower,
  type RelayFollowerState,
  type RelayOptions,
} from "./types.ts";

/** @internal */
export type RelayableActivity = Create | Delete | Move | Update | Announce;

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

  protected abstract readonly initialFollowerState: RelayFollowerState;
  protected abstract readonly logger: Logger;

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

  protected shouldSkipFollow(
    _ctx: InboxContext<RelayOptions>,
    _follower: Actor,
  ): Promise<boolean> {
    return Promise.resolve(false);
  }

  protected afterFollowApproved(
    _ctx: InboxContext<RelayOptions>,
    _follower: Actor,
  ): Promise<void> {
    return Promise.resolve();
  }

  protected abstract deliverActivity(
    ctx: InboxContext<RelayOptions>,
    activity: RelayableActivity,
    excludeBaseUris: URL[],
  ): Promise<void>;

  async #handleFollow(
    ctx: InboxContext<RelayOptions>,
    follow: Follow,
  ): Promise<void> {
    const follower = await validateFollowActivity(ctx, follow);
    if (follower?.id == null || await this.shouldSkipFollow(ctx, follower)) {
      return;
    }

    const approved = await this.options.subscriptionHandler(ctx, follower);
    if (approved) {
      await ctx.data.kv.set(
        ["follower", follower.id.href],
        {
          actor: await follower.toJsonLd(),
          state: this.initialFollowerState,
        },
      );
    }

    await sendFollowResponse(ctx, follow, follower, approved);
    if (approved) await this.afterFollowApproved(ctx, follower);
  }

  async #relayActivity(
    ctx: InboxContext<RelayOptions>,
    activity: RelayableActivity,
  ): Promise<void> {
    const sender = await activity.getActor(ctx);
    const excludeBaseUris = sender?.id == null ? [] : [new URL(sender.id)];
    await this.deliverActivity(ctx, activity, excludeBaseUris);
  }

  protected setupInboxListeners(): InboxListenerSetters<RelayOptions> {
    if (this.federation == null) {
      throw new Error("Federation must be initialized before inbox listeners");
    }

    const listeners = this.federation.setInboxListeners(
      "/users/{identifier}/inbox",
      "/inbox",
    );
    listeners
      .on(Follow, async (ctx, follow) => await this.#handleFollow(ctx, follow))
      .on(
        Undo,
        async (ctx, undo) => await handleUndoFollow(ctx, undo, this.logger),
      )
      .on(
        Create,
        async (ctx, create) => await this.#relayActivity(ctx, create),
      )
      .on(
        Delete,
        async (ctx, deleteActivity) =>
          await this.#relayActivity(ctx, deleteActivity),
      )
      .on(
        Move,
        async (ctx, move) => await this.#relayActivity(ctx, move),
      )
      .on(
        Update,
        async (ctx, update) => await this.#relayActivity(ctx, update),
      )
      .on(
        Announce,
        async (ctx, announce) => await this.#relayActivity(ctx, announce),
      );
    return listeners;
  }

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
