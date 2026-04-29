import { createFederation, MemoryKvStore } from "@fedify/fedify/federation";
import { generateCryptoKeyPair } from "@fedify/fedify/sig";
import { Accept, Activity, Create, Follow, Note, Person } from "@fedify/vocab";
import { store } from "./store.ts";

const ORIGIN = Deno.env.get("HARNESS_ORIGIN") ??
  "http://fedify-harness:3001";

const rsaKeyPair = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
const kv = new MemoryKvStore();

const federation = createFederation<void>({
  kv,
  origin: ORIGIN,
  allowPrivateAddress: true,
  skipSignatureVerification: !Deno.env.get("STRICT_MODE"),
});

export async function resetFederationTestState(): Promise<void> {
  const keys = [];
  for await (const entry of kv.list(["_fedify", "activityIdempotence"])) {
    keys.push(entry.key);
  }
  await Promise.all(keys.map((key) => kv.delete(key)));
}

federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    if (identifier !== "testuser") return null;
    const keys = await ctx.getActorKeyPairs(identifier);
    return new Person({
      id: ctx.getActorUri(identifier),
      preferredUsername: identifier,
      name: "Fedify Smoke Test User",
      inbox: ctx.getInboxUri(identifier),
      outbox: ctx.getOutboxUri(identifier),
      followers: ctx.getFollowersUri(identifier),
      url: ctx.getActorUri(identifier),
      publicKey: keys[0].cryptographicKey,
      assertionMethods: keys.map((k) => k.multikey),
    });
  })
  .setKeyPairsDispatcher((_ctx, identifier) => {
    if (identifier !== "testuser") return [];
    return [rsaKeyPair];
  });

federation
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
  .on(Follow, async (ctx, follow) => {
    const followerUri = follow.actorId;
    store.push({
      id: follow.id?.href ?? crypto.randomUUID(),
      type: "Follow",
      receivedAt: new Date().toISOString(),
    });
    if (!ctx.recipient || !followerUri) return;

    // Build the recipient manually instead of calling getActor(), because
    // in non-strict mode Mastodon generates https:// actor URIs but only
    // serves HTTP.  In strict mode the Caddy proxy handles TLS, so we
    // keep the original https:// scheme.
    const actorUri = Deno.env.get("STRICT_MODE")
      ? followerUri.href
      : followerUri.href.replace(/^https:\/\//, "http://");
    const recipient = {
      id: followerUri,
      inboxId: new URL(`${actorUri}/inbox`),
    };

    const accept = new Accept({
      actor: ctx.getActorUri(ctx.recipient),
      object: follow,
    });
    await ctx.sendActivity(
      { identifier: ctx.recipient },
      recipient,
      accept,
      { immediate: true },
    );
  })
  .on(Create, async (_ctx, create) => {
    const object = await create.getObject();
    store.push({
      id: create.id?.href ?? crypto.randomUUID(),
      type: "Create",
      receivedAt: new Date().toISOString(),
      inReplyTo: object instanceof Note
        ? object.replyTargetId?.href
        : undefined,
      content: object instanceof Note ? object.content?.toString() : undefined,
    });
  })
  .on(Activity, (_ctx, activity) => {
    // Don't double-store Create or Follow activities (already handled above)
    if (!(activity instanceof Create) && !(activity instanceof Follow)) {
      store.push({
        id: activity.id?.href ?? crypto.randomUUID(),
        type: activity.constructor.name,
        receivedAt: new Date().toISOString(),
      });
    }
  });

federation.setOutboxDispatcher(
  "/users/{identifier}/outbox",
  (_ctx, _identifier, _cursor) => ({ items: [] }),
);

federation.setFollowersDispatcher(
  "/users/{identifier}/followers",
  (_ctx, _identifier, _cursor) => ({ items: [] }),
);

export { federation };
