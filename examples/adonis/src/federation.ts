import {
  createFederation,
  generateCryptoKeyPair,
  MemoryKvStore,
} from "@fedify/fedify";
import { Accept, Endpoints, Follow, Person, Undo } from "@fedify/vocab";

export const keyPairsStore = new Map<string, Array<CryptoKeyPair>>();
export const relationStore = new Map<string, string>();

const federation = createFederation<void>({
  kv: new MemoryKvStore(),
});

federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    if (identifier !== "demo") return null;
    const keyPairs = await ctx.getActorKeyPairs(identifier);
    return new Person({
      id: ctx.getActorUri(identifier),
      name: "Fedify Demo",
      summary: "This is a Fedify Demo account.",
      preferredUsername: identifier,
      url: new URL("/", ctx.url),
      inbox: ctx.getInboxUri(identifier),
      endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
      publicKey: keyPairs[0].cryptographicKey,
      assertionMethods: keyPairs.map((kp) => kp.multikey),
    });
  })
  .setKeyPairsDispatcher(async (_, identifier) => {
    if (identifier !== "demo") return [];
    const existing = keyPairsStore.get(identifier);
    if (existing) return existing;
    const { privateKey, publicKey } = await generateCryptoKeyPair();
    keyPairsStore.set(identifier, [{ privateKey, publicKey }]);
    return [{ privateKey, publicKey }];
  });

federation
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
  .on(Follow, async (context, follow) => {
    if (
      follow.id == null ||
      follow.actorId == null ||
      follow.objectId == null
    ) {
      return;
    }
    const result = context.parseUri(follow.objectId);
    if (result?.type !== "actor" || result.identifier !== "demo") return;
    const follower = await follow.getActor(context);
    if (follower?.id == null) throw new Error("follower is null");
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
    relationStore.set(follower.id.href, follow.objectId.href);
  })
  .on(Undo, async (context, undo) => {
    const activity = await undo.getObject(context);
    if (activity instanceof Follow) {
      if (activity.id == null || undo.actorId == null) return;
      relationStore.delete(undo.actorId.href);
    } else {
      console.debug(undo);
    }
  });

export default federation;
