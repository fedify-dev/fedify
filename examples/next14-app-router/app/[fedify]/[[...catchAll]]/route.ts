import {
  createFederation,
  generateCryptoKeyPair,
  MemoryKvStore,
} from "@fedify/fedify";
import { Accept, Endpoints, Follow, Person, Undo } from "@fedify/vocab";
import { keyPairsStore, relationStore } from "~/data/store";
import { integrateFederation } from "~/shared/integrate-fedify";

const federation = createFederation<void>({
  kv: new MemoryKvStore(),
});

const requestHanlder = integrateFederation(federation, () => {});

export {
  requestHanlder as DELETE,
  requestHanlder as GET,
  requestHanlder as PATCH,
  requestHanlder as POST,
  requestHanlder as PUT,
};

federation
  .setActorDispatcher("/users/{identifier}", async (context, identifier) => {
    if (identifier != "demo") {
      return null;
    }
    const keyPairs = await context.getActorKeyPairs(identifier);
    return new Person({
      id: context.getActorUri(identifier),
      name: "Fedify Demo",
      summary: "This is a Fedify Demo account.",
      preferredUsername: identifier,
      url: new URL("/", context.url),
      inbox: context.getInboxUri(identifier),
      endpoints: new Endpoints({
        sharedInbox: context.getInboxUri(),
      }),
      publicKey: keyPairs[0].cryptographicKey,
      assertionMethods: keyPairs.map((keyPair) => keyPair.multikey),
    });
  })
  .setKeyPairsDispatcher(async (_, identifier) => {
    if (identifier != "demo") {
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
    if (result?.type !== "actor" || result.identifier !== "demo") {
      return;
    }
    const follower = await follow.getActor(context);
    if (follower?.id == null) {
      throw new Error("follower is null");
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
    relationStore.set(follower.id.href, follow.objectId.href);
  })
  .on(Undo, async (context, undo) => {
    const activity = await undo.getObject(context);
    if (activity instanceof Follow) {
      if (activity.id == null) {
        return;
      }
      if (undo.actorId == null) {
        return;
      }
      relationStore.delete(undo.actorId.href);
    } else {
      console.debug(undo);
    }
  });
