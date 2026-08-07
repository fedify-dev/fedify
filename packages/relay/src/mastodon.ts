import type { InboxContext } from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import { BaseRelay, type RelayableActivity } from "./base.ts";
import { RELAY_SERVER_ACTOR, type RelayOptions } from "./types.ts";

const logger = getLogger(["fedify", "relay", "mastodon"]);

/**
 * A Mastodon-compatible ActivityPub relay implementation.
 * This relay follows Mastodon's relay protocol for compatibility
 * with Mastodon instances.
 *
 * @since 2.0.0
 */
export class MastodonRelay extends BaseRelay {
  protected readonly initialFollowerState = "accepted";
  protected readonly logger = logger;

  protected async deliverActivity(
    ctx: InboxContext<RelayOptions>,
    _activity: RelayableActivity,
    excludeBaseUris: URL[],
  ): Promise<void> {
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
}
