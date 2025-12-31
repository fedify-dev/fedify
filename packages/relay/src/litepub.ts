import {
  Accept,
  Announce,
  Create,
  Delete,
  Follow,
  type InboxContext,
  isActor,
  Move,
  PUBLIC_COLLECTION,
  Undo,
  Update,
} from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import { BaseRelay } from "./base.ts";
import {
  handleUndoFollow,
  sendFollowResponse,
  validateFollowActivity,
} from "./follow.ts";
import {
  RELAY_SERVER_ACTOR,
  type RelayFollowerData,
  type RelayOptions,
} from "./types.ts";

const logger = getLogger(["fedify", "relay", "litepub"]);

/**
 * A LitePub-compatible ActivityPub relay implementation.
 * This relay follows LitePub's relay protocol and extensions for
 * enhanced federation capabilities.
 *
 * @since 2.0.0
 */
export class LitePubRelay extends BaseRelay {
  async #announceToFollowers(
    ctx: InboxContext<RelayOptions>,
    activity: Create | Delete | Move | Update | Announce,
  ): Promise<void> {
    const sender = await activity.getActor(ctx);
    const excludeBaseUris = sender?.id ? [new URL(sender.id)] : [];

    const announce = new Announce({
      id: new URL(`/announce#${crypto.randomUUID()}`, ctx.origin),
      actor: ctx.getActorUri(RELAY_SERVER_ACTOR),
      object: activity.objectId,
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
  }

  protected setupInboxListeners(): void {
    if (this.federation != null) {
      this.federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Follow, async (ctx, follow) => {
          const follower = await validateFollowActivity(ctx, follow);
          if (!follower || !follower.id) return;

          // Litepub-specific: check if already in pending state
          const existingFollow = await ctx.data.kv.get<RelayFollowerData>([
            "follower",
            follower.id.href,
          ]);
          if (existingFollow?.state === "pending") return;

          const approved = await this.options.subscriptionHandler(
            ctx,
            follower,
          );

          if (approved) {
            // Litepub-specific: save with "pending" state
            await ctx.data.kv.set(
              ["follower", follower.id.href],
              { actor: await follower.toJsonLd(), state: "pending" },
            );

            await sendFollowResponse(ctx, follow, follower, approved);

            // Litepub-specific: send reciprocal follow
            const relayActorUri = ctx.getActorUri(RELAY_SERVER_ACTOR);
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
            await sendFollowResponse(ctx, follow, follower, approved);
          }
        })
        .on(Accept, async (ctx, accept) => {
          // Validate follow activity from accept activity
          const follow = await accept.getObject({
            crossOrigin: "trust",
            ...ctx,
          });
          if (!(follow instanceof Follow)) return;
          const relayActorId = follow.actorId;
          if (relayActorId == null) return;

          // Validate follower actor - accept activity sender
          const followerActor = await accept.getActor();
          if (!isActor(followerActor) || !followerActor.id) return;
          const parsed = ctx.parseUri(relayActorId);
          if (parsed == null || parsed.type !== "actor") return;

          // Get follower from kv store
          const followerData = await ctx.data.kv.get([
            "follower",
            followerActor.id.href,
          ]);
          if (followerData == null) return;

          // Update follower state to accepted
          const updatedFollowerData = { ...followerData, state: "accepted" };
          await ctx.data.kv.set(
            ["follower", followerActor.id.href],
            updatedFollowerData,
          );
        })
        .on(
          Undo,
          async (ctx, undo) => await handleUndoFollow(ctx, undo, logger),
        )
        .on(
          Create,
          async (ctx, create) => await this.#announceToFollowers(ctx, create),
        )
        .on(
          Update,
          async (ctx, update) => await this.#announceToFollowers(ctx, update),
        )
        .on(
          Move,
          async (ctx, move) => await this.#announceToFollowers(ctx, move),
        )
        .on(
          Delete,
          async (ctx, deleteActivity) =>
            await this.#announceToFollowers(ctx, deleteActivity),
        )
        .on(
          Announce,
          async (ctx, announce) =>
            await this.#announceToFollowers(ctx, announce),
        );
    }
  }
}
