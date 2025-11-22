import {
  Accept,
  Create,
  Delete,
  type Federation,
  Follow,
  Move,
  Reject,
  Undo,
  Update,
} from "@fedify/fedify";
import { RELAY_SERVER_ACTOR, type RelayOptions } from "@fedify/relay";
import type { FederationBuilder } from "@fedify/fedify/federation";

/**
 * A Mastodon-compatible ActivityPub relay implementation.
 * This relay follows Mastodon's relay protocol for maximum compatibility
 * with Mastodon instances.
 *
 * @since 2.0.0
 */
export class MastodonRelay {
  #federationBuilder: FederationBuilder<RelayOptions>;
  #options: RelayOptions;
  #federation?: Federation<RelayOptions>;

  constructor(
    options: RelayOptions,
    relayBuilder: FederationBuilder<RelayOptions>,
  ) {
    this.#options = options;
    this.#federationBuilder = relayBuilder;
  }

  async fetch(request: Request): Promise<Response> {
    if (this.#federation == null) {
      this.#federation = await this.#federationBuilder.build(this.#options);
      this.setupInboxListeners();
    }

    return await this.#federation.fetch(request, {
      contextData: this.#options,
    });
  }

  setupInboxListeners() {
    if (this.#federation != null) {
      this.#federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Follow, async (ctx, follow) => {
          if (follow.id == null || follow.objectId == null) return;
          const parsed = ctx.parseUri(follow.objectId);
          const isPublicFollow = follow.objectId.href ===
            "https://www.w3.org/ns/activitystreams#Public";
          if (!isPublicFollow && parsed?.type !== "actor") return;

          const relayActorUri = ctx.getActorUri(RELAY_SERVER_ACTOR);
          const follower = await follow.getActor(ctx);
          if (
            follower == null || follower.id == null ||
            follower.preferredUsername == null ||
            follower.inboxId == null
          ) return;
          let approved = false;

          if (this.#options.subscriptionHandler) {
            approved = await this.#options.subscriptionHandler(
              ctx,
              follower,
            );
          }

          if (approved) {
            const followers = await ctx.data.kv.get<string[]>(["followers"]) ??
              [];
            followers.push(follow.id.href);
            await ctx.data.kv.set(["followers"], followers);

            await ctx.data.kv.set(
              ["follower", follow.id.href],
              await follower.toJsonLd(),
            );

            await ctx.sendActivity(
              { identifier: RELAY_SERVER_ACTOR },
              follower,
              new Accept({
                id: new URL(`#accepts`, relayActorUri),
                actor: relayActorUri,
                object: follow,
              }),
            );
          } else {
            await ctx.sendActivity(
              { identifier: RELAY_SERVER_ACTOR },
              follower,
              new Reject({
                id: new URL(`#rejects`, relayActorUri),
                actor: relayActorUri,
                object: follow,
              }),
            );
          }
        })
        .on(Undo, async (ctx, undo) => {
          const activity = await undo.getObject({
            crossOrigin: "trust",
            ...ctx,
          });
          if (activity instanceof Follow) {
            if (
              activity.id == null ||
              activity.actorId == null
            ) return;
            const followers = await ctx.data.kv.get<string[]>(["followers"]) ??
              []; // actor ids

            const updatedFollowers = followers.filter((id) =>
              id !== activity.actorId?.href
            );
            await ctx.data.kv.set(["followers"], updatedFollowers);
            await ctx.data.kv.delete(["follower", activity.actorId?.href]);
          } else {
            console.warn(
              "Unsupported object type ({type}) for Undo activity: {object}",
              { type: activity?.constructor.name, object: activity },
            );
          }
        })
        .on(Create, async (ctx, create) => {
          const sender = await create.getActor(ctx);
          // Exclude the sender's origin to prevent forwarding back to them
          const excludeBaseUris = sender?.id ? [new URL(sender.id)] : [];

          await ctx.forwardActivity(
            { identifier: RELAY_SERVER_ACTOR },
            "followers",
            {
              skipIfUnsigned: true,
              excludeBaseUris,
              preferSharedInbox: true,
            },
          );
        })
        .on(Delete, async (ctx, deleteActivity) => {
          const sender = await deleteActivity.getActor(ctx);
          // Exclude the sender's origin to prevent forwarding back to them
          const excludeBaseUris = sender?.id ? [new URL(sender.id)] : [];

          await ctx.forwardActivity(
            { identifier: RELAY_SERVER_ACTOR },
            "followers",
            {
              skipIfUnsigned: true,
              excludeBaseUris,
              preferSharedInbox: true,
            },
          );
        })
        .on(Move, async (ctx, deleteActivity) => {
          const sender = await deleteActivity.getActor(ctx);
          // Exclude the sender's origin to prevent forwarding back to them
          const excludeBaseUris = sender?.id ? [new URL(sender.id)] : [];

          await ctx.forwardActivity(
            { identifier: RELAY_SERVER_ACTOR },
            "followers",
            {
              skipIfUnsigned: true,
              excludeBaseUris,
              preferSharedInbox: true,
            },
          );
        })
        .on(Update, async (ctx, deleteActivity) => {
          const sender = await deleteActivity.getActor(ctx);
          // Exclude the sender's origin to prevent forwarding back to them
          const excludeBaseUris = sender?.id ? [new URL(sender.id)] : [];

          await ctx.forwardActivity(
            { identifier: RELAY_SERVER_ACTOR },
            "followers",
            {
              skipIfUnsigned: true,
              excludeBaseUris,
              preferSharedInbox: true,
            },
          );
        });
    }
  }
}
