import {
  createFederationBuilder,
  type KvStore,
} from "@fedify/fedify/federation";
import {
  exportJwk,
  generateCryptoKeyPair,
  importJwk,
} from "@fedify/fedify/sig";
import { Accept, Endpoints, Follow, Person } from "@fedify/vocab";

export interface ContextData {
  readonly kv: KvStore;
  readonly deployId?: string;
}

interface StoredKeyPair {
  readonly privateKey: JsonWebKey;
  readonly publicKey: JsonWebKey;
}

const identifier = "netlify";
const keyPairKey = ["example", "actor", identifier, "key"] as const;

export const builder = createFederationBuilder<ContextData>();

builder
  .setActorDispatcher("/users/{identifier}", async (context, requested) => {
    if (requested !== identifier) return null;
    const keyPairs = await context.getActorKeyPairs(requested);
    return new Person({
      id: context.getActorUri(requested),
      name: "Fedify on Netlify",
      summary: "An Astro actor backed by Netlify Async Workloads.",
      preferredUsername: requested,
      url: new URL("/", context.canonicalOrigin),
      inbox: context.getInboxUri(requested),
      endpoints: new Endpoints({ sharedInbox: context.getInboxUri() }),
      publicKey: keyPairs[0].cryptographicKey,
      assertionMethods: keyPairs.map((keyPair) => keyPair.multikey),
    });
  })
  .setKeyPairsDispatcher(async (context, requested) => {
    if (requested !== identifier) return [];
    let stored = await context.data.kv.get<StoredKeyPair>(keyPairKey);
    if (stored == null) {
      const keyPair = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
      const serialized: StoredKeyPair = {
        privateKey: await exportJwk(keyPair.privateKey),
        publicKey: await exportJwk(keyPair.publicKey),
      };
      const created = context.data.kv.cas == null
        ? (await context.data.kv.set(keyPairKey, serialized), true)
        : await context.data.kv.cas(
          keyPairKey,
          undefined,
          serialized,
        );
      if (created) return [keyPair];
      stored = await context.data.kv.get<StoredKeyPair>(keyPairKey);
      if (stored == null) throw new Error("Failed to persist the actor key.");
    }
    return [{
      privateKey: await importJwk(stored.privateKey, "private"),
      publicKey: await importJwk(stored.publicKey, "public"),
    }];
  });

builder
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
  .on(Follow, async (context, follow) => {
    if (follow.actorId == null || follow.objectId == null) return;
    const actor = context.parseUri(follow.objectId);
    if (actor?.type !== "actor" || actor.identifier !== identifier) return;
    const follower = await follow.getActor(context);
    if (follower == null) return;
    await context.sendActivity(
      { identifier },
      follower,
      new Accept({
        actor: follow.objectId,
        object: follow,
      }),
    );
  });
