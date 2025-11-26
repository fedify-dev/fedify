import {
  type Context,
  createFederationBuilder,
  exportJwk,
  generateCryptoKeyPair,
  importJwk,
  type KvStore,
  type MessageQueue,
} from "@fedify/fedify";
import { type Actor, Application, isActor, Object } from "@fedify/fedify/vocab";
import type {
  AuthenticatedDocumentLoaderFactory,
  DocumentLoaderFactory,
} from "@fedify/vocab-runtime";
import { LitePubRelay } from "./litepub.ts";
import { MastodonRelay } from "./mastodon.ts";

export const RELAY_SERVER_ACTOR = "relay";

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
  documentLoaderFactory?: DocumentLoaderFactory;
  authenticatedDocumentLoaderFactory?: AuthenticatedDocumentLoaderFactory;
  queue?: MessageQueue;
  subscriptionHandler?: SubscriptionRequestHandler;
}

export interface RelayFollower {
  readonly actor: unknown;
  readonly state: string;
}

export const relayBuilder = createFederationBuilder<RelayOptions>();

relayBuilder.setActorDispatcher(
  "/users/{identifier}",
  async (ctx, identifier) => {
    if (identifier !== RELAY_SERVER_ACTOR) return null;
    const keys = await ctx.getActorKeyPairs(identifier);
    return new Application({
      id: ctx.getActorUri(identifier),
      preferredUsername: identifier,
      name: "ActivityPub Relay",
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

relayBuilder.setFollowersDispatcher(
  "/users/{identifier}/followers",
  async (ctx, identifier) => {
    if (identifier !== RELAY_SERVER_ACTOR) return null;

    const followers = await ctx.data.kv.get<string[]>(["followers"]) ??
      [];

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
    return { items: actors };
  },
);

relayBuilder.setFollowingDispatcher(
  "/users/{identifier}/following",
  async (ctx, identifier) => {
    if (identifier !== RELAY_SERVER_ACTOR) return null;

    const followers = await ctx.data.kv.get<string[]>(["followers"]) ??
      [];

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
    return { items: actors };
  },
);

export function createRelay(
  type: string,
  options: RelayOptions,
): MastodonRelay | LitePubRelay {
  switch (type) {
    case "mastodon":
      return new MastodonRelay(options, relayBuilder);
    case "litepub":
      return new LitePubRelay(options, relayBuilder);
    default:
      throw new Error(`Unsupported relay type: ${type}`);
  }
}
