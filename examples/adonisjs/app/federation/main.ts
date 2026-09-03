/*
|--------------------------------------------------------------------------
| Federation dispatchers
|--------------------------------------------------------------------------
|
| Registered on the Fedify builder while the application boots, from the
| "start/federation.ts" preload file. This is the AdonisJS counterpart of
| the "federation.ts" module in the other Fedify example applications.
|
*/

import logger from "@adonisjs/core/services/logger";
import federation from "@fedify/adonisjs/services/builder";
import { generateCryptoKeyPair } from "@fedify/fedify";
import { Accept, Endpoints, Follow, Person, Undo } from "@fedify/vocab";

/**
 * Fedify's key pair type, derived from `generateCryptoKeyPair()` rather than
 * written as the global `CryptoKeyPair`.  The AdonisJS TypeScript preset sets
 * `lib: ["ESNext"]` without `DOM`, so that global does not exist here, and
 * deriving it keeps the store in step with whatever Fedify actually returns.
 */
type FedifyCryptoKeyPair = Awaited<ReturnType<typeof generateCryptoKeyPair>>;

/**
 * Both stores live in memory, which keeps the example to one file and no
 * database.  The trade-off is that restarting the process mints a fresh
 * signing key and forgets every follower, so servers that already cached the
 * old key will fail to verify this actor until they re-fetch it.  A real
 * application persists both.
 */
const keyPairsStore = new Map<string, Array<FedifyCryptoKeyPair>>();
export const followers = new Map<string, string>();

federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    if (identifier !== "demo") return null;
    const keyPairs = await ctx.getActorKeyPairs(identifier);
    return new Person({
      id: ctx.getActorUri(identifier),
      name: "Fedify Demo",
      summary:
        "This is a Fedify Demo account. This is an AdonisJS example app.",
      preferredUsername: identifier,
      url: new URL("/", ctx.url),
      inbox: ctx.getInboxUri(identifier),
      endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
      publicKey: keyPairs[0]?.cryptographicKey,
      assertionMethods: keyPairs.map((keyPair) => keyPair.multikey),
    });
  })
  /**
   * Maps the WebFinger username onto the identifier the dispatcher above
   * expects.  They are the same string here, which is also what Fedify falls
   * back to — but only after complaining about the missing mapper on every
   * lookup.
   */
  .mapHandle((_ctx, username) => username === "demo" ? "demo" : null)
  .setKeyPairsDispatcher(async (_, identifier) => {
    if (identifier !== "demo") return [];
    const keyPairs = keyPairsStore.get(identifier);
    if (keyPairs) return keyPairs;

    /**
     * Two keys, not one.  The RSA key signs HTTP Signatures, which every
     * implementation still relies on; the Ed25519 key is what Fedify needs to
     * attach an Object Integrity Proof (FEP-8b32) to outgoing activities.
     * Without it Fedify warns and sends everything unproven.
     */
    const rsa = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
    const ed25519 = await generateCryptoKeyPair("Ed25519");
    keyPairsStore.set(identifier, [rsa, ed25519]);
    return [rsa, ed25519];
  });

federation
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
  .on(Follow, async (context, follow) => {
    if (
      follow.id == null || follow.actorId == null || follow.objectId == null
    ) {
      return;
    }
    const result = context.parseUri(follow.objectId);
    if (result?.type !== "actor" || result.identifier !== "demo") return;
    const follower = await follow.getActor(context);
    if (follower?.id == null) {
      /**
       * Throwing here would answer the delivery with a 500, and the sending
       * server would keep retrying an activity that can never succeed.  Log it
       * and let Fedify report the delivery as handled.
       */
      logger.warn(
        { actor: follow.actorId.href },
        "Could not dereference the following actor",
      );
      return;
    }
    await context.sendActivity(
      { identifier: result.identifier },
      follower,
      new Accept({
        id: new URL(
          `#accepts/${follower.id.href}`,
          context.getActorUri("demo"),
        ),
        actor: follow.objectId,
        object: follow,
      }),
    );
    followers.set(follower.id.href, follow.objectId.href);
  })
  .on(Undo, async (context, undo) => {
    const activity = await undo.getObject(context);
    if (activity instanceof Follow) {
      if (activity.id == null) return;
      if (undo.actorId == null) return;
      followers.delete(undo.actorId.href);
    } else {
      logger.debug(
        { type: activity?.constructor.name },
        "Received an Undo wrapping something other than a Follow",
      );
    }
  })
  /**
   * Without this, a failing listener is only visible in Fedify's own logs.
   */
  .onError((_context, error) => {
    logger.error({ err: error }, "An inbox listener failed");
  });
