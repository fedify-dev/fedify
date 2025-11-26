import {
  Accept,
  Announce,
  Create,
  Delete,
  type Federation,
  type FederationBuilder,
  Follow,
  isActor,
  Move,
  PUBLIC_COLLECTION,
  Reject,
  Undo,
  Update,
} from "@fedify/fedify";
import {
  RELAY_SERVER_ACTOR,
  type RelayFollower,
  type RelayOptions,
} from "./relay.ts";

/**
 * A LitePub-compatible ActivityPub relay implementation.
 * This relay follows LitePub's relay protocol and extensions for
 * enhanced federation capabilities.
 *
 * @since 2.0.0
 */
export class LitePubRelay {
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

          // Check if this is a follow from a client or if we already have a pending state
          const existingFollow = await ctx.data.kv.get<RelayFollower>([
            "follower",
            follower.id.href,
          ]);

          // "pending" follower means this follower client requested subscription already.
          if (existingFollow?.state === "pending") return;

          let subscriptionApproved = false;

          // Receive follow request from the relay client.
          if (this.#options.subscriptionHandler) {
            subscriptionApproved = await this.#options.subscriptionHandler(
              ctx,
              follower,
            );
          }

          if (subscriptionApproved) {
            await ctx.data.kv.set(
              ["follower", follower.id.href],
              { "actor": await follower.toJsonLd(), "state": "pending" },
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

            // Send reciprocal follow
            await ctx.sendActivity(
              { identifier: RELAY_SERVER_ACTOR },
              follower,
              new Follow({
                actor: relayActorUri,
                object: follower.id,
                to: follower.id,
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
        .on(Accept, async (ctx, accept) => {
          // Validate follow activity from accept activity
          const follow = await accept.getObject({
            crossOrigin: "trust",
            ...ctx,
          });
          if (!(follow instanceof Follow)) return;
          const follower = follow.actorId;
          if (follower == null) return;

          // Validate following - accept activity sender
          const following = await accept.getActor();
          if (!isActor(following) || !following.id) return;
          const parsed = ctx.parseUri(follower);
          if (parsed == null || parsed.type !== "actor") return;

          // Get follower from kv store
          const followerData = await ctx.data.kv.get([
            "follower",
            following.id.href,
          ]);
          if (followerData == null) return;

          // Update follower state
          const updatedFollowerData = { ...followerData, state: "accepted" };
          await ctx.data.kv.set(
            ["follower", following.id.href],
            updatedFollowerData,
          );

          // Update followers list
          const followers = await ctx.data.kv.get<string[]>(["followers"]) ??
            [];
          followers.push(following.id.href);
          await ctx.data.kv.set(["followers"], followers);
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
            ctx.data.kv.delete(["follower", activity.actorId?.href]);
          } else {
            console.warn(
              "Unsupported object type ({type}) for Undo activity: {object}",
              { type: activity?.constructor.name, object: activity },
            );
          }
        })
        .on(Create, async (ctx, create) => {
          const sender = await create.getActor(ctx);
          const excludeBaseUris = sender?.id ? [new URL(sender.id)] : [];

          const announce = new Announce({
            id: new URL(`/announce#${crypto.randomUUID()}`, ctx.origin),
            actor: ctx.getActorUri(RELAY_SERVER_ACTOR),
            object: create.objectId,
            to: PUBLIC_COLLECTION,
            published: Temporal.Now.instant(),
          });

          await ctx.sendActivity(
            { identifier: RELAY_SERVER_ACTOR },
            "followers",
            announce,
            {
              excludeBaseUris,
              preferSharedInbox: true,
            },
          );
        })
        .on(Update, async (ctx, update) => {
          const sender = await update.getActor(ctx);
          const excludeBaseUris = sender?.id ? [new URL(sender.id)] : [];

          const announce = new Announce({
            id: new URL(`/announce#${crypto.randomUUID()}`, ctx.origin),
            actor: ctx.getActorUri(RELAY_SERVER_ACTOR),
            object: update.objectId,
            to: PUBLIC_COLLECTION,
          });

          await ctx.sendActivity(
            { identifier: RELAY_SERVER_ACTOR },
            "followers",
            announce,
            {
              excludeBaseUris,
              preferSharedInbox: true,
            },
          );
        })
        .on(Move, async (ctx, move) => {
          const sender = await move.getActor(ctx);
          const excludeBaseUris = sender?.id ? [new URL(sender.id)] : [];

          const announce = new Announce({
            id: new URL(`/announce#${crypto.randomUUID()}`, ctx.origin),
            actor: ctx.getActorUri(RELAY_SERVER_ACTOR),
            object: move.objectId,
            to: PUBLIC_COLLECTION,
          });

          await ctx.sendActivity(
            { identifier: RELAY_SERVER_ACTOR },
            "followers",
            announce,
            {
              excludeBaseUris,
              preferSharedInbox: true,
            },
          );
        })
        .on(Delete, async (ctx, deleteActivity) => {
          const sender = await deleteActivity.getActor(ctx);
          const excludeBaseUris = sender?.id ? [new URL(sender.id)] : [];

          const announce = new Announce({
            id: new URL(`/announce#${crypto.randomUUID()}`, ctx.origin),
            actor: ctx.getActorUri(RELAY_SERVER_ACTOR),
            object: deleteActivity.objectId,
            to: PUBLIC_COLLECTION,
          });

          await ctx.sendActivity(
            { identifier: RELAY_SERVER_ACTOR },
            "followers",
            announce,
            {
              excludeBaseUris,
              preferSharedInbox: true,
            },
          );
        })
        .on(Announce, async (ctx, announceActivity) => {
          const sender = await announceActivity.getActor(ctx);
          const excludeBaseUris = sender?.id ? [new URL(sender.id)] : [];

          const announce = new Announce({
            id: new URL(`/announce#${crypto.randomUUID()}`, ctx.origin),
            actor: ctx.getActorUri(RELAY_SERVER_ACTOR),
            object: announceActivity.objectId,
            to: PUBLIC_COLLECTION,
          });

          await ctx.sendActivity(
            { identifier: RELAY_SERVER_ACTOR },
            "followers",
            announce,
            {
              excludeBaseUris,
              preferSharedInbox: true,
            },
          );
        });
    }
  }
}
