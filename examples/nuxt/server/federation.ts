import {
  createFederation,
  generateCryptoKeyPair,
  MemoryKvStore,
} from "@fedify/fedify";
import {
  Accept,
  Endpoints,
  Follow,
  Note,
  Person,
  type Recipient,
  Undo,
} from "@fedify/vocab";
import { keyPairsStore, relationStore } from "./store";

const federation = createFederation<void>({
  kv: new MemoryKvStore(),
});

const IDENTIFIER = "demo";

federation.setNodeInfoDispatcher("/nodeinfo/2.1", (_ctx) => ({
  software: {
    name: "fedify-nuxt",
    version: "0.0.1",
  },
  protocols: ["activitypub"],
  usage: {
    users: { total: 1, activeHalfyear: 1, activeMonth: 1 },
    localPosts: 0,
    localComments: 0,
  },
}));

federation
  .setActorDispatcher("/users/{identifier}", async (context, identifier) => {
    if (identifier !== IDENTIFIER) {
      return null;
    }
    const keyPairs = await context.getActorKeyPairs(identifier);
    return new Person({
      id: context.getActorUri(identifier),
      name: "Fedify Demo",
      summary: "This is a Fedify demo account on Nuxt.",
      preferredUsername: identifier,
      url: new URL(`/users/${identifier}`, context.url),
      inbox: context.getInboxUri(identifier),
      endpoints: new Endpoints({ sharedInbox: context.getInboxUri() }),
      publicKey: keyPairs[0].cryptographicKey,
      assertionMethods: keyPairs.map((keyPair) => keyPair.multikey),
    });
  })
  .setKeyPairsDispatcher(async (_, identifier) => {
    if (identifier !== IDENTIFIER) {
      return [];
    }
    const keyPairs = keyPairsStore.get(identifier);
    if (keyPairs != null) {
      return keyPairs.map(({ privateKey, publicKey }) => ({
        privateKey,
        publicKey,
      }));
    }
    const { privateKey, publicKey } = await generateCryptoKeyPair();
    const generated = [{ privateKey, publicKey }];
    keyPairsStore.set(identifier, generated);
    return generated;
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
    if (result?.type !== "actor" || result.identifier !== IDENTIFIER) {
      return;
    }
    const follower = await follow.getActor(context);
    if (!(follower instanceof Person) || follower.id == null) {
      throw new Error("follower is null");
    }
    await context.sendActivity(
      { identifier: result.identifier },
      follower,
      new Accept({
        id: new URL(
          `#accepts/${follower.id.href}`,
          context.getActorUri(IDENTIFIER),
        ),
        actor: follow.objectId,
        object: follow,
      }),
    );
    relationStore.set(follower.id.href, follower);
  })
  .on(Undo, async (_context, undo) => {
    const activity = await undo.getObject();
    if (!(activity instanceof Follow) || undo.actorId == null) {
      return;
    }
    relationStore.delete(undo.actorId.href);
  });

federation.setObjectDispatcher(
  Note,
  "/users/{identifier}/posts/{id}",
  (context, values) =>
    new Note({
      id: context.getObjectUri(Note, values),
      attribution: context.getActorUri(values.identifier),
      name: values.id,
    }),
);

federation.setFollowersDispatcher("/users/{identifier}/followers", () => {
  const followers = Array.from(relationStore.values());
  const items: Recipient[] = followers.map((follower) => ({
    id: follower.id,
    inboxId: follower.inboxId,
    endpoints: follower.endpoints,
  }));
  return { items };
});

export default federation;
