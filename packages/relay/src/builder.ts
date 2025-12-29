import {
  type Context,
  createFederationBuilder,
  exportJwk,
  type FederationBuilder,
  generateCryptoKeyPair,
  importJwk,
} from "@fedify/fedify";
import { Application, isActor, Object } from "@fedify/fedify/vocab";
import type { Actor } from "@fedify/fedify/vocab";
import {
  RELAY_SERVER_ACTOR,
  type RelayFollower,
  type RelayOptions,
} from "./types.ts";

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
      inbox: ctx.getInboxUri(), // This should be shared inbox uri
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
  const actors: Actor[] = [];

  for await (const { value } of ctx.data.kv.list(["follower"])) {
    const follower = value as RelayFollower;
    if (!follower) continue;
    const actor = await Object.fromJsonLd(follower.actor);
    if (!isActor(actor)) continue;
    actors.push(actor);
  }

  return actors;
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
