import {
  createFederation,
  generateCryptoKeyPair,
  InProcessMessageQueue,
  MemoryKvStore,
} from "@fedify/fedify";
import {
  Accept,
  Endpoints,
  Follow,
  Image,
  Note,
  Person,
  PUBLIC_COLLECTION,
  type Recipient,
  Undo,
} from "@fedify/vocab";
import { broadcastEvent } from "./sse.ts";
import { keyPairsStore, postStore, relationStore } from "./store.ts";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]!);
}

const federation = createFederation<void>({
  kv: new MemoryKvStore(),
  queue: new InProcessMessageQueue(),
});

const IDENTIFIER = "demo";

federation
  .setActorDispatcher(
    "/users/{identifier}",
    async (context, identifier) => {
      if (identifier != IDENTIFIER) {
        return null;
      }
      const keyPairs = await context.getActorKeyPairs(identifier);
      return new Person({
        id: context.getActorUri(identifier),
        name: "Fedify Demo",
        summary: "This is a Fedify Demo account.",
        preferredUsername: identifier,
        icon: new Image({ url: new URL("/demo-profile.png", context.url) }),
        url: new URL("/", context.url),
        inbox: context.getInboxUri(identifier),
        followers: context.getFollowersUri(identifier),
        endpoints: new Endpoints({ sharedInbox: context.getInboxUri() }),
        publicKey: keyPairs[0].cryptographicKey,
        assertionMethods: keyPairs.map((keyPair) => keyPair.multikey),
      });
    },
  )
  .setKeyPairsDispatcher(async (_, identifier) => {
    if (identifier != IDENTIFIER) {
      return [];
    }
    const keyPairs = keyPairsStore.get(identifier);
    if (keyPairs) {
      return keyPairs;
    }
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
    if (result?.type !== "actor" || result.identifier !== IDENTIFIER) {
      return;
    }
    const follower = await follow.getActor(context);
    if (!(follower instanceof Person) || follower.id == null) {
      throw new Error("follower is not a Person");
    }
    await context.sendActivity(
      { identifier: result.identifier },
      follower,
      new Accept({
        id: new URL(
          `#accepts/${encodeURIComponent(follow.id.href)}`,
          context.getActorUri(IDENTIFIER),
        ),
        actor: follow.objectId,
        object: follow,
      }),
    );
    relationStore.set(follower.id.href, follower);
    broadcastEvent();
  })
  .on(Undo, async (context, undo) => {
    const activity = await undo.getObject(context);
    if (!(activity instanceof Follow)) {
      console.debug(undo);
      return;
    }
    if (activity.id == null || undo.actorId == null) return;
    const demoActorUri = context.getActorUri(IDENTIFIER);
    if (activity.objectId?.href !== demoActorUri.href) return;
    relationStore.delete(undo.actorId.href);
    broadcastEvent();
  });

federation.setObjectDispatcher(
  Note,
  "/users/{identifier}/posts/{id}",
  (ctx, values) => {
    const id = ctx.getObjectUri(Note, values);
    const post = postStore.get(id);
    if (post == null) return null;
    return new Note({
      id,
      attribution: ctx.getActorUri(values.identifier),
      to: PUBLIC_COLLECTION,
      cc: ctx.getFollowersUri(values.identifier),
      content: escapeHtml(post.content),
      mediaType: "text/html",
      published: post.published,
      url: id,
    });
  },
);

federation
  .setFollowersDispatcher(
    "/users/{identifier}/followers",
    () => {
      const followers = Array.from(relationStore.values());
      const items: Recipient[] = followers.map((f) => ({
        id: f.id,
        inboxId: f.inboxId,
        endpoints: f.endpoints,
      }));
      return { items };
    },
  );

federation.setNodeInfoDispatcher("/nodeinfo/2.1", (ctx) => {
  return {
    software: {
      name: "fedify-nuxt",
      version: "0.0.1",
      homepage: new URL(ctx.canonicalOrigin),
    },
    protocols: ["activitypub"],
    usage: {
      users: { total: 1, activeHalfyear: 1, activeMonth: 1 },
      localPosts: postStore.getAll().length,
      localComments: 0,
    },
  };
});

export default federation;
