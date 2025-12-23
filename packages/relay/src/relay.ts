import {
  Accept,
  type Context,
  createFederationBuilder,
  exportJwk,
  type Federation,
  type FederationBuilder,
  Follow,
  generateCryptoKeyPair,
  importJwk,
  type KvStore,
  type MessageQueue,
  Reject,
  type Undo,
} from "@fedify/fedify";
import { type Actor, Application, isActor, Object } from "@fedify/fedify/vocab";
import type {
  AuthenticatedDocumentLoaderFactory,
  DocumentLoaderFactory,
} from "@fedify/vocab-runtime";
import type { getLogger } from "@logtape/logtape";

export const RELAY_SERVER_ACTOR = "relay";

/**
 * Supported relay types.
 */
export type RelayType = "mastodon" | "litepub";

/**
 * Handler for subscription requests (Follow/Undo activities).
 */
export type SubscriptionRequestHandler = (
  ctx: Context<RelayOptions>,
  clientActor: Actor,
) => Promise<boolean>;

/**
 * Configuration options for the ActivityPub relay.
 */
export interface RelayOptions {
  kv: KvStore;
  domain?: string;
  name?: string;
  documentLoaderFactory?: DocumentLoaderFactory;
  authenticatedDocumentLoaderFactory?: AuthenticatedDocumentLoaderFactory;
  queue?: MessageQueue;
  subscriptionHandler?: SubscriptionRequestHandler;
}

export interface RelayFollower {
  readonly actor: unknown;
  readonly state: "pending" | "accepted";
}

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
   * Set up inbox listeners for handling ActivityPub activities.
   * Each relay type implements this method with protocol-specific logic.
   */
  protected abstract setupInboxListeners(): void;
}

export const relayBuilder: FederationBuilder<RelayOptions> =
  createFederationBuilder<RelayOptions>();

relayBuilder.setActorDispatcher(
  "/users/{identifier}",
  async (ctx, identifier) => {
    if (identifier !== RELAY_SERVER_ACTOR) return null;
    const keys = await ctx.getActorKeyPairs(identifier);
    return new Application({
      id: ctx.getActorUri(identifier),
      preferredUsername: identifier,
      name: ctx.data.name ?? "ActivityPub Relay",
      inbox: ctx.getInboxUri(), // This should be sharedInboxUri
      followers: ctx.getFollowersUri(identifier),
      following: ctx.getFollowingUri(identifier),
      url: ctx.getActorUri(identifier),
      publicKey: keys[0].cryptographicKey,

      assertionMethods: keys.map((k) => k.multikey),
    });
  },
)
  .setKeyPairsDispatcher(
    async (ctx, identifier) => {
      if (identifier !== RELAY_SERVER_ACTOR) return [];

      const rsaPairJson = await ctx.data.kv.get<
        { privateKey: JsonWebKey; publicKey: JsonWebKey }
      >(["keypair", "rsa", identifier]);
      const ed25519PairJson = await ctx.data.kv.get<
        { privateKey: JsonWebKey; publicKey: JsonWebKey }
      >(["keypair", "ed25519", identifier]);
      if (rsaPairJson == null || ed25519PairJson == null) {
        const rsaPair = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
        const ed25519Pair = await generateCryptoKeyPair("Ed25519");
        await ctx.data.kv.set(["keypair", "rsa", identifier], {
          privateKey: await exportJwk(rsaPair.privateKey),
          publicKey: await exportJwk(rsaPair.publicKey),
        });
        await ctx.data.kv.set(["keypair", "ed25519", identifier], {
          privateKey: await exportJwk(ed25519Pair.privateKey),
          publicKey: await exportJwk(ed25519Pair.publicKey),
        });

        return [rsaPair, ed25519Pair];
      }

      const rsaPair: CryptoKeyPair = {
        privateKey: await importJwk(rsaPairJson.privateKey, "private"),
        publicKey: await importJwk(rsaPairJson.publicKey, "public"),
      };
      const ed25519Pair: CryptoKeyPair = {
        privateKey: await importJwk(ed25519PairJson.privateKey, "private"),
        publicKey: await importJwk(ed25519PairJson.publicKey, "public"),
      };
      return [rsaPair, ed25519Pair];
    },
  );

async function getFollowerActors(
  ctx: Context<RelayOptions>,
): Promise<Actor[]> {
  const followers = await ctx.data.kv.get<string[]>(["followers"]) ?? [];

  const actors: Actor[] = [];
  for (const followerId of followers) {
    const follower = await ctx.data.kv.get<RelayFollower>([
      "follower",
      followerId,
    ]);
    if (!follower) continue;
    const actor = await Object.fromJsonLd(follower.actor);
    if (!isActor(actor)) continue;
    actors.push(actor);
  }
  return actors;
}

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

    const followers = await ctx.data.kv.get<string[]>(["followers"]) ?? [];
    const updatedFollowers = followers.filter((id) =>
      id !== activity.actorId?.href
    );

    await ctx.data.kv.set(["followers"], updatedFollowers);
    await ctx.data.kv.delete(["follower", activity.actorId?.href]);
  } else {
    logger.warn(
      "Unsupported object type ({type}) for Undo activity: {object}",
      { type: activity?.constructor.name, object: activity },
    );
  }
}

async function dispatchRelayActors(
  ctx: Context<RelayOptions>,
  identifier: string,
) {
  if (identifier !== RELAY_SERVER_ACTOR) return null;
  const actors = await getFollowerActors(ctx);
  return { items: actors };
}

relayBuilder.setFollowersDispatcher(
  "/users/{identifier}/followers",
  dispatchRelayActors,
);

relayBuilder.setFollowingDispatcher(
  "/users/{identifier}/following",
  dispatchRelayActors,
);
