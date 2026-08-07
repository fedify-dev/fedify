import type { InboxContext, InboxListenerSetters } from "@fedify/fedify";
import {
  Accept,
  type Actor,
  Announce,
  Follow,
  isActor,
  PUBLIC_COLLECTION,
} from "@fedify/vocab";
import { getLogger } from "@logtape/logtape";
import { BaseRelay, type RelayableActivity } from "./base.ts";
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
  protected readonly initialFollowerState = "pending";
  protected readonly logger = logger;

  protected override async shouldSkipFollow(
    ctx: InboxContext<RelayOptions>,
    follower: Actor,
  ): Promise<boolean> {
    if (follower.id == null) return true;
    const existingFollow = await ctx.data.kv.get<RelayFollowerData>([
      "follower",
      follower.id.href,
    ]);
    return existingFollow?.state === "pending";
  }

  protected override async afterFollowApproved(
    ctx: InboxContext<RelayOptions>,
    follower: Actor,
  ): Promise<void> {
    if (follower.id == null) return;
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
  }

  protected async deliverActivity(
    ctx: InboxContext<RelayOptions>,
    activity: RelayableActivity,
    excludeBaseUris: URL[],
  ): Promise<void> {
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

  protected override setupInboxListeners(): InboxListenerSetters<RelayOptions> {
    return super.setupInboxListeners().on(Accept, async (ctx, accept) => {
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
    });
  }
}
