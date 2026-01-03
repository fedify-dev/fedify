import type { Context } from "@fedify/fedify";
import { Accept, type Actor, Follow, Reject, type Undo } from "@fedify/vocab";
import type { getLogger } from "@logtape/logtape";
import { RELAY_SERVER_ACTOR, type RelayOptions } from "./types.ts";

/**
 * Validate Follow activity and return follower actor if valid.
 * This validation is common to both Mastodon and LitePub relay protocols.
 *
 * @param ctx The federation context
 * @param follow The Follow activity to validate
 * @returns The follower Actor if valid, null otherwise
 */
export async function validateFollowActivity(
  ctx: Context<RelayOptions>,
  follow: Follow,
): Promise<Actor | null> {
  if (follow.id == null || follow.objectId == null) return null;

  const parsed = ctx.parseUri(follow.objectId);
  const isPublicFollow = follow.objectId.href ===
    "https://www.w3.org/ns/activitystreams#Public";
  if (!isPublicFollow && parsed?.type !== "actor") return null;

  const follower = await follow.getActor(ctx);
  if (
    follower == null || follower.id == null ||
    follower.preferredUsername == null ||
    follower.inboxId == null
  ) return null;

  return follower;
}

/**
 * Send Accept or Reject response for a Follow activity.
 * This is common to both Mastodon and LitePub relay protocols.
 *
 * @param ctx The federation context
 * @param follow The Follow activity being responded to
 * @param follower The actor who sent the Follow
 * @param approved Whether the follow was approved
 */
export async function sendFollowResponse(
  ctx: Context<RelayOptions>,
  follow: Follow,
  follower: Actor,
  approved: boolean,
): Promise<void> {
  const relayActorUri = ctx.getActorUri(RELAY_SERVER_ACTOR);
  const Activity = approved ? Accept : Reject;
  const action = approved ? "accepts" : "rejects";

  await ctx.sendActivity(
    { identifier: RELAY_SERVER_ACTOR },
    follower,
    new Activity({
      id: new URL(`#${action}`, relayActorUri),
      actor: relayActorUri,
      object: follow,
    }),
  );
}

/**
 * Handle Undo activity for Follow.
 * This logic is identical for both Mastodon and LitePub relay protocols.
 *
 * @param ctx The federation context
 * @param undo The Undo activity to handle
 * @param logger The logger instance to use for warnings
 */
export async function handleUndoFollow(
  ctx: Context<RelayOptions>,
  undo: Undo,
  logger: ReturnType<typeof getLogger>,
): Promise<void> {
  const activity = await undo.getObject({
    crossOrigin: "trust",
    ...ctx,
  });

  if (activity instanceof Follow) {
    if (activity.id == null || activity.actorId == null) return;

    await ctx.data.kv.delete(["follower", activity.actorId.href]);
  } else {
    logger.warn(
      "Unsupported object type ({type}) for Undo activity: {object}",
      { type: activity?.constructor.name, object: activity },
    );
  }
}
