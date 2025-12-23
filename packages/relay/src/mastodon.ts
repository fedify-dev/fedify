import {
  Announce,
  Create,
  Delete,
  Follow,
  type InboxContext,
  Move,
  Undo,
  Update,
} from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import {
  BaseRelay,
  handleUndoFollow,
  RELAY_SERVER_ACTOR,
  type RelayOptions,
  sendFollowResponse,
  validateFollowActivity,
} from "./relay.ts";

const logger = getLogger(["fedify", "relay", "mastodon"]);

/**
 * A Mastodon-compatible ActivityPub relay implementation.
 * This relay follows Mastodon's relay protocol for maximum compatibility
 * with Mastodon instances.
 *
 * @since 2.0.0
 */
export class MastodonRelay extends BaseRelay {
  /**
   * Forward activity to all followers (mastodon-specific pattern).
   * Used for Create, Delete, Move, and Update activities.
   */
  async #forwardToFollowers(
    ctx: InboxContext<RelayOptions>,
    activity: Create | Delete | Move | Update | Announce,
  ): Promise<void> {
    const sender = await activity.getActor(ctx);
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
  }

  protected setupInboxListeners(): void {
    if (this.federation != null) {
      this.federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Follow, async (ctx, follow) => {
          const follower = await validateFollowActivity(ctx, follow);
          if (!follower || !follower.id) return;

          let approved = false;
          if (this.options.subscriptionHandler) {
            approved = await this.options.subscriptionHandler(ctx, follower);
          }

          if (approved) {
            // mastodon-specific: immediately add to followers list
            const followers = await ctx.data.kv.get<string[]>(["followers"]) ??
              [];
            followers.push(follower.id.href);
            await ctx.data.kv.set(["followers"], followers);

            await ctx.data.kv.set(
              ["follower", follower.id.href],
              { actor: await follower.toJsonLd(), state: "accepted" },
            );
          }

          await sendFollowResponse(ctx, follow, follower, approved);
        })
        .on(
          Undo,
          async (ctx, undo) => await handleUndoFollow(ctx, undo, logger),
        )
        .on(
          Create,
          async (ctx, create) => await this.#forwardToFollowers(ctx, create),
        )
        .on(
          Delete,
          async (ctx, deleteActivity) =>
            await this.#forwardToFollowers(ctx, deleteActivity),
        )
        .on(
          Move,
          async (ctx, move) => await this.#forwardToFollowers(ctx, move),
        )
        .on(
          Update,
          async (ctx, update) => await this.#forwardToFollowers(ctx, update),
        )
        .on(
          Announce,
          async (ctx, announce) =>
            await this.#forwardToFollowers(ctx, announce),
        );
    }
  }
}
