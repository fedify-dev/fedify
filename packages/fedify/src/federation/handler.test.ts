import { assert, assertEquals, assertFalse, assertRejects } from "@std/assert";
import { signRequest } from "../sig/http.ts";
import { compactJsonLd, signJsonLd } from "../sig/ld.ts";
import {
  createInboxContext,
  createRequestContext,
} from "../testing/context.ts";
import { mockDocumentLoader } from "../testing/docloader.ts";
import {
  rsaPrivateKey3,
  rsaPublicKey2,
  rsaPublicKey3,
} from "../testing/keys.ts";
import { test } from "../testing/mod.ts";
import {
  type Activity,
  Create,
  Note,
  type Object,
  Person,
} from "../vocab/vocab.ts";
import type {
  ActorDispatcher,
  CollectionCounter,
  CollectionCursor,
  CollectionDispatcher,
  CustomCollectionCounter,
  CustomCollectionCursor,
  CustomCollectionDispatcher,
  ObjectDispatcher,
} from "./callback.ts";
import type { RequestContext } from "./context.ts";
import type { ConstructorWithTypeId } from "./federation.ts";
import {
  acceptsJsonLd,
  type CustomCollectionCallbacks,
  handleActor,
  handleCollection,
  handleCustomCollection,
  handleInbox,
  handleObject,
  respondWithObject,
  respondWithObjectIfAcceptable,
} from "./handler.ts";
import { InboxListenerSet } from "./inbox.ts";
import { MemoryKvStore } from "./kv.ts";
import { createFederation } from "./middleware.ts";
import type { MessageQueue } from "./mq.ts";
import type { InboxMessage } from "./queue.ts";

test("acceptsJsonLd()", () => {
  assert(acceptsJsonLd(
    new Request("https://example.com/", {
      headers: { Accept: "application/activity+json" },
    }),
  ));
  assert(acceptsJsonLd(
    new Request("https://example.com/", {
      headers: { Accept: "application/ld+json" },
    }),
  ));
  assert(acceptsJsonLd(
    new Request("https://example.com/", {
      headers: { Accept: "application/json" },
    }),
  ));
  assertFalse(acceptsJsonLd(
    new Request("https://example.com/", {
      headers: { Accept: "application/ld+json; q=0.5, text/html; q=0.8" },
    }),
  ));
  assertFalse(acceptsJsonLd(
    new Request("https://example.com/", {
      headers: {
        Accept: "application/ld+json; q=0.4, application/xhtml+xml; q=0.9",
      },
    }),
  ));
});

test("handleActor()", async () => {
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  let context = createRequestContext<void>({
    federation,
    data: undefined,
    url: new URL("https://example.com/"),
    getActorUri(identifier: string) {
      return new URL(`https://example.com/users/${identifier}`);
    },
  });
  const actorDispatcher: ActorDispatcher<void> = (ctx, handle) => {
    if (handle !== "someone") return null;
    return new Person({
      id: ctx.getActorUri(handle),
      name: "Someone",
    });
  };
  let onNotFoundCalled: Request | null = null;
  const onNotFound = (request: Request) => {
    onNotFoundCalled = request;
    return new Response("Not found", { status: 404 });
  };
  let onNotAcceptableCalled: Request | null = null;
  const onNotAcceptable = (request: Request) => {
    onNotAcceptableCalled = request;
    return new Response("Not acceptable", { status: 406 });
  };
  let onUnauthorizedCalled: Request | null = null;
  const onUnauthorized = (request: Request) => {
    onUnauthorizedCalled = request;
    return new Response("Unauthorized", { status: 401 });
  };
  let response = await handleActor(
    context.request,
    {
      context,
      identifier: "someone",
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(onNotFoundCalled, context.request);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);

  onNotFoundCalled = null;
  context = createRequestContext<void>({
    ...context,
    getActor(handle: string) {
      return Promise.resolve(actorDispatcher(context, handle));
    },
  });
  response = await handleActor(
    context.request,
    {
      context,
      identifier: "someone",
      actorDispatcher,
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 406);
  assertEquals(onNotFoundCalled, null);
  assertEquals(onNotAcceptableCalled, context.request);
  assertEquals(onUnauthorizedCalled, null);

  onNotAcceptableCalled = null;
  response = await handleActor(
    context.request,
    {
      context,
      identifier: "no-one",
      actorDispatcher,
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(onNotFoundCalled, context.request);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);

  onNotFoundCalled = null;
  context = createRequestContext<void>({
    ...context,
    request: new Request(context.url, {
      headers: {
        Accept: "application/activity+json",
      },
    }),
  });
  response = await handleActor(
    context.request,
    {
      context,
      identifier: "someone",
      actorDispatcher,
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("Content-Type"),
    "application/activity+json",
  );
  assertEquals(await response.json(), {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
      "https://w3id.org/security/data-integrity/v1",
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/multikey/v1",
      {
        alsoKnownAs: {
          "@id": "as:alsoKnownAs",
          "@type": "@id",
        },
        manuallyApprovesFollowers: "as:manuallyApprovesFollowers",
        movedTo: {
          "@id": "as:movedTo",
          "@type": "@id",
        },
        featured: {
          "@id": "toot:featured",
          "@type": "@id",
        },
        featuredTags: {
          "@id": "toot:featuredTags",
          "@type": "@id",
        },
        discoverable: "toot:discoverable",
        indexable: "toot:indexable",
        memorial: "toot:memorial",
        suspended: "toot:suspended",
        toot: "http://joinmastodon.org/ns#",
        schema: "http://schema.org#",
        PropertyValue: "schema:PropertyValue",
        value: "schema:value",
        misskey: "https://misskey-hub.net/ns#",
        _misskey_followedMessage: "misskey:_misskey_followedMessage",
        isCat: "misskey:isCat",
        Emoji: "toot:Emoji",
      },
    ],
    id: "https://example.com/users/someone",
    type: "Person",
    name: "Someone",
  });
  assertEquals(onNotFoundCalled, null);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);

  response = await handleActor(
    context.request,
    {
      context,
      identifier: "no-one",
      actorDispatcher,
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(onNotFoundCalled, context.request);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);

  onNotFoundCalled = null;
  response = await handleActor(
    context.request,
    {
      context,
      identifier: "someone",
      actorDispatcher,
      authorizePredicate: (_ctx, _handle, signedKey, signedKeyOwner) =>
        signedKey != null && signedKeyOwner != null,
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 401);
  assertEquals(onNotFoundCalled, null);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, context.request);

  onUnauthorizedCalled = null;
  context = createRequestContext<void>({
    ...context,
    getSignedKey: () => Promise.resolve(rsaPublicKey2),
    getSignedKeyOwner: () => Promise.resolve(new Person({})),
  });
  response = await handleActor(
    context.request,
    {
      context,
      identifier: "someone",
      actorDispatcher,
      authorizePredicate: (_ctx, _handle, signedKey, signedKeyOwner) =>
        signedKey != null && signedKeyOwner != null,
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("Content-Type"),
    "application/activity+json",
  );
  assertEquals(await response.json(), {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
      "https://w3id.org/security/data-integrity/v1",
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/multikey/v1",
      {
        alsoKnownAs: {
          "@id": "as:alsoKnownAs",
          "@type": "@id",
        },
        manuallyApprovesFollowers: "as:manuallyApprovesFollowers",
        movedTo: {
          "@id": "as:movedTo",
          "@type": "@id",
        },
        featured: {
          "@id": "toot:featured",
          "@type": "@id",
        },
        featuredTags: {
          "@id": "toot:featuredTags",
          "@type": "@id",
        },
        discoverable: "toot:discoverable",
        indexable: "toot:indexable",
        memorial: "toot:memorial",
        suspended: "toot:suspended",
        toot: "http://joinmastodon.org/ns#",
        schema: "http://schema.org#",
        PropertyValue: "schema:PropertyValue",
        value: "schema:value",
        misskey: "https://misskey-hub.net/ns#",
        _misskey_followedMessage: "misskey:_misskey_followedMessage",
        isCat: "misskey:isCat",
        Emoji: "toot:Emoji",
      },
    ],
    id: "https://example.com/users/someone",
    type: "Person",
    name: "Someone",
  });
  assertEquals(onNotFoundCalled, null);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);
});

test("handleObject()", async () => {
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  let context = createRequestContext<void>({
    federation,
    data: undefined,
    url: new URL("https://example.com/"),
    getObjectUri(
      _cls: ConstructorWithTypeId<Object>,
      values: Record<string, string>,
    ) {
      return new URL(
        `https://example.com/users/${values.handle}/notes/${values.id}`,
      );
    },
  });
  const objectDispatcher: ObjectDispatcher<void, Object, string> = (
    ctx,
    values,
  ) => {
    if (values.handle !== "someone" || values.id !== "123") return null;
    return new Note({
      id: ctx.getObjectUri(Note, values),
      summary: "Hello, world!",
    });
  };
  let onNotFoundCalled: Request | null = null;
  const onNotFound = (request: Request) => {
    onNotFoundCalled = request;
    return new Response("Not found", { status: 404 });
  };
  let onNotAcceptableCalled: Request | null = null;
  const onNotAcceptable = (request: Request) => {
    onNotAcceptableCalled = request;
    return new Response("Not acceptable", { status: 406 });
  };
  let onUnauthorizedCalled: Request | null = null;
  const onUnauthorized = (request: Request) => {
    onUnauthorizedCalled = request;
    return new Response("Unauthorized", { status: 401 });
  };
  let response = await handleObject(
    context.request,
    {
      context,
      values: { handle: "someone", id: "123" },
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(onNotFoundCalled, context.request);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);

  onNotFoundCalled = null;
  response = await handleObject(
    context.request,
    {
      context,
      values: { handle: "someone", id: "123" },
      objectDispatcher,
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 406);
  assertEquals(onNotFoundCalled, null);
  assertEquals(onNotAcceptableCalled, context.request);
  assertEquals(onUnauthorizedCalled, null);

  onNotAcceptableCalled = null;
  response = await handleObject(
    context.request,
    {
      context,
      values: { handle: "no-one", id: "123" },
      objectDispatcher,
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(onNotFoundCalled, context.request);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);

  onNotFoundCalled = null;
  response = await handleObject(
    context.request,
    {
      context,
      values: { handle: "someone", id: "not-exist" },
      objectDispatcher,
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(onNotFoundCalled, context.request);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);

  onNotFoundCalled = null;
  context = createRequestContext<void>({
    ...context,
    request: new Request(context.url, {
      headers: {
        Accept: "application/activity+json",
      },
    }),
  });
  response = await handleObject(
    context.request,
    {
      context,
      values: { handle: "someone", id: "123" },
      objectDispatcher,
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("Content-Type"),
    "application/activity+json",
  );
  assertEquals(await response.json(), {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
      {
        Emoji: "toot:Emoji",
        Hashtag: "as:Hashtag",
        sensitive: "as:sensitive",
        toot: "http://joinmastodon.org/ns#",
        _misskey_quote: "misskey:_misskey_quote",
        fedibird: "http://fedibird.com/ns#",
        misskey: "https://misskey-hub.net/ns#",
        quoteUri: "fedibird:quoteUri",
        quoteUrl: "as:quoteUrl",
        emojiReactions: {
          "@id": "fedibird:emojiReactions",
          "@type": "@id",
        },
      },
    ],
    id: "https://example.com/users/someone/notes/123",
    summary: "Hello, world!",
    type: "Note",
  });
  assertEquals(onNotFoundCalled, null);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);

  response = await handleObject(
    context.request,
    {
      context,
      values: { handle: "no-one", id: "123" },
      objectDispatcher,
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(onNotFoundCalled, context.request);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);

  onNotFoundCalled = null;
  response = await handleObject(
    context.request,
    {
      context,
      values: { handle: "someone", id: "not-exist" },
      objectDispatcher,
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(onNotFoundCalled, context.request);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);

  onNotFoundCalled = null;
  response = await handleObject(
    context.request,
    {
      context,
      values: { handle: "someone", id: "123" },
      objectDispatcher,
      authorizePredicate: (_ctx, _values, signedKey, signedKeyOwner) =>
        signedKey != null && signedKeyOwner != null,
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 401);
  assertEquals(onNotFoundCalled, null);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, context.request);

  onUnauthorizedCalled = null;
  context = createRequestContext<void>({
    ...context,
    getSignedKey: () => Promise.resolve(rsaPublicKey2),
    getSignedKeyOwner: () => Promise.resolve(new Person({})),
  });
  response = await handleObject(
    context.request,
    {
      context,
      values: { handle: "someone", id: "123" },
      objectDispatcher,
      authorizePredicate: (_ctx, _values, signedKey, signedKeyOwner) =>
        signedKey != null && signedKeyOwner != null,
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("Content-Type"),
    "application/activity+json",
  );
  assertEquals(await response.json(), {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
      {
        Emoji: "toot:Emoji",
        Hashtag: "as:Hashtag",
        sensitive: "as:sensitive",
        toot: "http://joinmastodon.org/ns#",
        _misskey_quote: "misskey:_misskey_quote",
        fedibird: "http://fedibird.com/ns#",
        misskey: "https://misskey-hub.net/ns#",
        quoteUri: "fedibird:quoteUri",
        quoteUrl: "as:quoteUrl",
        emojiReactions: {
          "@id": "fedibird:emojiReactions",
          "@type": "@id",
        },
      },
    ],
    id: "https://example.com/users/someone/notes/123",
    summary: "Hello, world!",
    type: "Note",
  });
  assertEquals(onNotFoundCalled, null);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);
});

test("handleCollection()", async () => {
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  let context = createRequestContext<void>({
    federation,
    data: undefined,
    url: new URL("https://example.com/"),
    getActorUri(identifier: string) {
      return new URL(`https://example.com/users/${identifier}`);
    },
  });
  const dispatcher: CollectionDispatcher<
    Activity,
    RequestContext<void>,
    void,
    void
  > = (
    _ctx,
    handle,
    cursor,
  ) => {
    if (handle !== "someone") return null;
    const items = [
      new Create({ id: new URL("https://example.com/activities/1") }),
      new Create({ id: new URL("https://example.com/activities/2") }),
      new Create({ id: new URL("https://example.com/activities/3") }),
    ];
    if (cursor != null) {
      const idx = parseInt(cursor);
      return {
        items: [items[idx]],
        nextCursor: idx < items.length - 1 ? (idx + 1).toString() : null,
        prevCursor: idx > 0 ? (idx - 1).toString() : null,
      };
    }
    return { items };
  };
  const counter: CollectionCounter<void, void> = (_ctx, handle) =>
    handle === "someone" ? 3 : null;
  const firstCursor: CollectionCursor<RequestContext<void>, void, void> = (
    _ctx,
    handle,
  ) => handle === "someone" ? "0" : null;
  const lastCursor: CollectionCursor<RequestContext<void>, void, void> = (
    _ctx,
    handle,
  ) => handle === "someone" ? "2" : null;
  let onNotFoundCalled: Request | null = null;
  const onNotFound = (request: Request) => {
    onNotFoundCalled = request;
    return new Response("Not found", { status: 404 });
  };
  let onNotAcceptableCalled: Request | null = null;
  const onNotAcceptable = (request: Request) => {
    onNotAcceptableCalled = request;
    return new Response("Not acceptable", { status: 406 });
  };
  let onUnauthorizedCalled: Request | null = null;
  const onUnauthorized = (request: Request) => {
    onUnauthorizedCalled = request;
    return new Response("Unauthorized", { status: 401 });
  };
  let response = await handleCollection(
    context.request,
    {
      context,
      name: "collection",
      identifier: "someone",
      uriGetter(identifier) {
        return new URL(`https://example.com/users/${identifier}`);
      },
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(onNotFoundCalled, context.request);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);

  onNotFoundCalled = null;
  response = await handleCollection(
    context.request,
    {
      context,
      name: "collection",
      identifier: "someone",
      uriGetter(identifier) {
        return new URL(`https://example.com/users/${identifier}`);
      },
      collectionCallbacks: { dispatcher },
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 406);
  assertEquals(onNotFoundCalled, null);
  assertEquals(onNotAcceptableCalled, context.request);
  assertEquals(onUnauthorizedCalled, null);

  onNotAcceptableCalled = null;
  response = await handleCollection(
    context.request,
    {
      context,
      name: "collection",
      identifier: "no-one",
      uriGetter(identifier) {
        return new URL(`https://example.com/users/${identifier}`);
      },
      collectionCallbacks: { dispatcher },
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(onNotFoundCalled, context.request);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);

  onNotFoundCalled = null;
  context = createRequestContext<void>({
    ...context,
    request: new Request(context.url, {
      headers: {
        Accept: "application/activity+json",
      },
    }),
  });
  response = await handleCollection(
    context.request,
    {
      context,
      name: "collection",
      identifier: "no-one",
      uriGetter(identifier) {
        return new URL(`https://example.com/users/${identifier}`);
      },
      collectionCallbacks: { dispatcher },
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(onNotFoundCalled, context.request);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);

  onNotFoundCalled = null;
  response = await handleCollection(
    context.request,
    {
      context,
      name: "collection",
      identifier: "someone",
      uriGetter(identifier) {
        return new URL(`https://example.com/users/${identifier}`);
      },
      collectionCallbacks: { dispatcher },
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("Content-Type"),
    "application/activity+json",
  );
  const createCtx = [
    "https://w3id.org/identity/v1",
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/data-integrity/v1",
    {
      toot: "http://joinmastodon.org/ns#",
      misskey: "https://misskey-hub.net/ns#",
      fedibird: "http://fedibird.com/ns#",
      ChatMessage: "http://litepub.social/ns#ChatMessage",
      Emoji: "toot:Emoji",
      Hashtag: "as:Hashtag",
      sensitive: "as:sensitive",
      votersCount: {
        "@id": "toot:votersCount",
        "@type": "http://www.w3.org/2001/XMLSchema#nonNegativeInteger",
      },
      _misskey_quote: "misskey:_misskey_quote",
      quoteUri: "fedibird:quoteUri",
      quoteUrl: "as:quoteUrl",
      emojiReactions: {
        "@id": "fedibird:emojiReactions",
        "@type": "@id",
      },
    },
  ];
  assertEquals(await response.json(), {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
      {
        toot: "http://joinmastodon.org/ns#",
        misskey: "https://misskey-hub.net/ns#",
        fedibird: "http://fedibird.com/ns#",
        ChatMessage: "http://litepub.social/ns#ChatMessage",
        Emoji: "toot:Emoji",
        Hashtag: "as:Hashtag",
        sensitive: "as:sensitive",
        votersCount: "toot:votersCount",
        _misskey_quote: "misskey:_misskey_quote",
        quoteUri: "fedibird:quoteUri",
        quoteUrl: "as:quoteUrl",
        emojiReactions: {
          "@id": "fedibird:emojiReactions",
          "@type": "@id",
        },
      },
    ],
    id: "https://example.com/users/someone",
    type: "OrderedCollection",
    orderedItems: [
      {
        "@context": createCtx,
        type: "Create",
        id: "https://example.com/activities/1",
      },
      {
        "@context": createCtx,
        type: "Create",
        id: "https://example.com/activities/2",
      },
      {
        "@context": createCtx,
        type: "Create",
        id: "https://example.com/activities/3",
      },
    ],
  });
  assertEquals(onNotFoundCalled, null);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);

  response = await handleCollection(
    context.request,
    {
      context,
      name: "collection",
      identifier: "someone",
      uriGetter(identifier) {
        return new URL(`https://example.com/users/${identifier}`);
      },
      collectionCallbacks: {
        dispatcher,
        authorizePredicate: (_ctx, _handle, key, keyOwner) =>
          key != null && keyOwner != null,
      },
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 401);
  assertEquals(onNotFoundCalled, null);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, context.request);

  onUnauthorizedCalled = null;
  context = createRequestContext<void>({
    ...context,
    getSignedKey: () => Promise.resolve(rsaPublicKey2),
    getSignedKeyOwner: () => Promise.resolve(new Person({})),
  });
  response = await handleCollection(
    context.request,
    {
      context,
      name: "collection",
      identifier: "someone",
      uriGetter(identifier) {
        return new URL(`https://example.com/users/${identifier}`);
      },
      collectionCallbacks: {
        dispatcher,
        authorizePredicate: (_ctx, _handle, key, keyOwner) =>
          key != null && keyOwner != null,
      },
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("Content-Type"),
    "application/activity+json",
  );
  assertEquals(await response.json(), {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
      {
        toot: "http://joinmastodon.org/ns#",
        misskey: "https://misskey-hub.net/ns#",
        fedibird: "http://fedibird.com/ns#",
        ChatMessage: "http://litepub.social/ns#ChatMessage",
        Emoji: "toot:Emoji",
        Hashtag: "as:Hashtag",
        sensitive: "as:sensitive",
        votersCount: "toot:votersCount",
        _misskey_quote: "misskey:_misskey_quote",
        quoteUri: "fedibird:quoteUri",
        quoteUrl: "as:quoteUrl",
        emojiReactions: {
          "@id": "fedibird:emojiReactions",
          "@type": "@id",
        },
      },
    ],
    id: "https://example.com/users/someone",
    type: "OrderedCollection",
    orderedItems: [
      {
        "@context": createCtx,
        type: "Create",
        id: "https://example.com/activities/1",
      },
      {
        "@context": createCtx,
        type: "Create",
        id: "https://example.com/activities/2",
      },
      {
        "@context": createCtx,
        type: "Create",
        id: "https://example.com/activities/3",
      },
    ],
  });
  assertEquals(onNotFoundCalled, null);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);

  response = await handleCollection(
    context.request,
    {
      context,
      name: "collection",
      identifier: "someone",
      uriGetter(identifier) {
        return new URL(`https://example.com/users/${identifier}`);
      },
      collectionCallbacks: {
        dispatcher,
        counter,
        firstCursor,
        lastCursor,
      },
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("Content-Type"),
    "application/activity+json",
  );
  assertEquals(await response.json(), {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
      {
        toot: "http://joinmastodon.org/ns#",
        misskey: "https://misskey-hub.net/ns#",
        fedibird: "http://fedibird.com/ns#",
        ChatMessage: "http://litepub.social/ns#ChatMessage",
        Emoji: "toot:Emoji",
        Hashtag: "as:Hashtag",
        sensitive: "as:sensitive",
        votersCount: "toot:votersCount",
        _misskey_quote: "misskey:_misskey_quote",
        quoteUri: "fedibird:quoteUri",
        quoteUrl: "as:quoteUrl",
        emojiReactions: {
          "@id": "fedibird:emojiReactions",
          "@type": "@id",
        },
      },
    ],
    id: "https://example.com/users/someone",
    type: "OrderedCollection",
    totalItems: 3,
    first: "https://example.com/?cursor=0",
    last: "https://example.com/?cursor=2",
  });
  assertEquals(onNotFoundCalled, null);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);

  let url = new URL("https://example.com/?cursor=0");
  context = createRequestContext({
    ...context,
    url,
    request: new Request(url, {
      headers: {
        Accept: "application/activity+json",
      },
    }),
  });
  response = await handleCollection(
    context.request,
    {
      context,
      name: "collection",
      identifier: "someone",
      uriGetter(identifier) {
        return new URL(`https://example.com/users/${identifier}`);
      },
      collectionCallbacks: {
        dispatcher,
        counter,
        firstCursor,
        lastCursor,
      },
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("Content-Type"),
    "application/activity+json",
  );
  assertEquals(await response.json(), {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
      {
        toot: "http://joinmastodon.org/ns#",
        misskey: "https://misskey-hub.net/ns#",
        fedibird: "http://fedibird.com/ns#",
        ChatMessage: "http://litepub.social/ns#ChatMessage",
        Emoji: "toot:Emoji",
        Hashtag: "as:Hashtag",
        sensitive: "as:sensitive",
        votersCount: "toot:votersCount",
        _misskey_quote: "misskey:_misskey_quote",
        quoteUri: "fedibird:quoteUri",
        quoteUrl: "as:quoteUrl",
        emojiReactions: {
          "@id": "fedibird:emojiReactions",
          "@type": "@id",
        },
      },
    ],
    id: "https://example.com/users/someone?cursor=0",
    type: "OrderedCollectionPage",
    partOf: "https://example.com/",
    next: "https://example.com/?cursor=1",
    orderedItems: [{
      "@context": createCtx,
      id: "https://example.com/activities/1",
      type: "Create",
    }],
  });
  assertEquals(onNotFoundCalled, null);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);

  url = new URL("https://example.com/?cursor=2");
  context = createRequestContext({
    ...context,
    url,
    request: new Request(url, {
      headers: {
        Accept: "application/activity+json",
      },
    }),
  });
  response = await handleCollection(
    context.request,
    {
      context,
      name: "collection",
      identifier: "someone",
      uriGetter(identifier) {
        return new URL(`https://example.com/users/${identifier}`);
      },
      collectionCallbacks: {
        dispatcher,
        counter,
        firstCursor,
        lastCursor,
      },
      onNotFound,
      onNotAcceptable,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("Content-Type"),
    "application/activity+json",
  );
  assertEquals(await response.json(), {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
      {
        toot: "http://joinmastodon.org/ns#",
        misskey: "https://misskey-hub.net/ns#",
        fedibird: "http://fedibird.com/ns#",
        ChatMessage: "http://litepub.social/ns#ChatMessage",
        Emoji: "toot:Emoji",
        Hashtag: "as:Hashtag",
        sensitive: "as:sensitive",
        votersCount: "toot:votersCount",
        _misskey_quote: "misskey:_misskey_quote",
        quoteUri: "fedibird:quoteUri",
        quoteUrl: "as:quoteUrl",
        emojiReactions: {
          "@id": "fedibird:emojiReactions",
          "@type": "@id",
        },
      },
    ],
    id: "https://example.com/users/someone?cursor=2",
    type: "OrderedCollectionPage",
    partOf: "https://example.com/",
    prev: "https://example.com/?cursor=1",
    orderedItems: [{
      "@context": createCtx,
      id: "https://example.com/activities/3",
      type: "Create",
    }],
  });
  assertEquals(onNotFoundCalled, null);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);
});

test("handleInbox()", async () => {
  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/person2"),
    object: new Note({
      id: new URL("https://example.com/notes/1"),
      attribution: new URL("https://example.com/person2"),
      content: "Hello, world!",
    }),
  });
  const unsignedRequest = new Request("https://example.com/", {
    method: "POST",
    body: JSON.stringify(await activity.toJsonLd()),
  });
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  const unsignedContext = createRequestContext({
    federation,
    request: unsignedRequest,
    url: new URL(unsignedRequest.url),
    data: undefined,
  });
  let onNotFoundCalled: Request | null = null;
  const onNotFound = (request: Request) => {
    onNotFoundCalled = request;
    return new Response("Not found", { status: 404 });
  };
  const actorDispatcher: ActorDispatcher<void> = (_ctx, identifier) => {
    if (identifier !== "someone") return null;
    return new Person({ name: "Someone" });
  };
  const restrictiveContextLoader = async (resource: string) => {
    const url = new URL(resource).href;
    if (
      url === "https://www.w3.org/ns/activitystreams" ||
      url === "https://w3id.org/identity/v1"
    ) {
      return await mockDocumentLoader(url);
    }
    throw new Error(`Unexpected context: ${url}`);
  };
  const inboxOptions = {
    kv: new MemoryKvStore(),
    kvPrefixes: {
      activityIdempotence: ["_fedify", "activityIdempotence"],
      publicKey: ["_fedify", "publicKey"],
    },
    actorDispatcher,
    onNotFound,
    signatureTimeWindow: { minutes: 5 },
    skipSignatureVerification: false,
  } as const;
  let response = await handleInbox(unsignedRequest, {
    recipient: null,
    context: unsignedContext,
    inboxContextFactory(_activity) {
      return createInboxContext({ ...unsignedContext, clone: undefined });
    },
    ...inboxOptions,
    actorDispatcher: undefined,
  });
  assertEquals(onNotFoundCalled, unsignedRequest);
  assertEquals(response.status, 404);

  onNotFoundCalled = null;
  response = await handleInbox(unsignedRequest, {
    recipient: "nobody",
    context: unsignedContext,
    inboxContextFactory(_activity) {
      return createInboxContext({
        ...unsignedContext,
        clone: undefined,
        recipient: "nobody",
      });
    },
    ...inboxOptions,
  });
  assertEquals(onNotFoundCalled, unsignedRequest);
  assertEquals(response.status, 404);

  onNotFoundCalled = null;
  response = await handleInbox(unsignedRequest, {
    recipient: null,
    context: unsignedContext,
    inboxContextFactory(_activity) {
      return createInboxContext({ ...unsignedContext, clone: undefined });
    },
    ...inboxOptions,
  });
  assertEquals(onNotFoundCalled, null);
  assertEquals(response.status, 401);

  response = await handleInbox(unsignedRequest, {
    recipient: "someone",
    context: unsignedContext,
    inboxContextFactory(_activity) {
      return createInboxContext({
        ...unsignedContext,
        clone: undefined,
        recipient: "someone",
      });
    },
    ...inboxOptions,
  });
  assertEquals(onNotFoundCalled, null);
  assertEquals(response.status, 401);

  const malformedProofCreatedRequest = new Request("https://example.com/", {
    method: "POST",
    body: JSON.stringify({
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/data-integrity/v1",
      ],
      id: "https://example.com/activities/invalid-proof-created",
      type: "Create",
      actor: "https://example.com/person2",
      object: {
        id: "https://example.com/notes/invalid-proof-created",
        type: "Note",
        attributedTo: "https://example.com/person2",
        content: "Hello, world!",
      },
      proof: {
        type: "DataIntegrityProof",
        cryptosuite: "eddsa-jcs-2022",
        verificationMethod: "https://example.com/person2#main-key",
        proofPurpose: "assertionMethod",
        created: { "@value": "not-a-date" },
        proofValue:
          "zLaewdp4H9kqtwyrLatK4cjY5oRHwVcw4gibPSUDYDMhi4M49v8pcYk3ZB6D69dNpAPbUmY8ocuJ3m9KhKJEEg7z",
      },
    }),
  });
  const malformedProofCreatedContext = createRequestContext({
    federation,
    request: malformedProofCreatedRequest,
    url: new URL(malformedProofCreatedRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  response = await handleInbox(malformedProofCreatedRequest, {
    recipient: null,
    context: malformedProofCreatedContext,
    inboxContextFactory(_activity) {
      return createInboxContext({
        ...malformedProofCreatedContext,
        clone: undefined,
      });
    },
    ...inboxOptions,
  });
  assertEquals([response.status, await response.text()], [
    400,
    "Invalid activity.",
  ]);

  onNotFoundCalled = null;
  const signedRequest = await signRequest(
    unsignedRequest.clone() as Request,
    rsaPrivateKey3,
    rsaPublicKey3.id!,
  );
  const signedContext = createRequestContext({
    federation,
    request: signedRequest,
    url: new URL(signedRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
  });
  response = await handleInbox(signedRequest, {
    recipient: null,
    context: signedContext,
    inboxContextFactory(_activity) {
      return createInboxContext({ ...unsignedContext, clone: undefined });
    },
    ...inboxOptions,
  });
  assertEquals(onNotFoundCalled, null);
  assertEquals([response.status, await response.text()], [202, ""]);

  const ldSignedRequest = new Request("https://example.com/", {
    method: "POST",
    body: JSON.stringify(
      await signJsonLd(
        {
          "@context": [
            "https://www.w3.org/ns/activitystreams",
            "https://w3id.org/identity/v1",
            "https://w3id.org/security/v1",
            "https://w3id.org/security/data-integrity/v1",
          ],
          id: "https://example.com/activities/ld-signed",
          type: "Create",
          actor: "https://example.com/person2",
          object: {
            id: "https://example.com/notes/ld-signed",
            type: "Note",
            attributedTo: "https://example.com/person2",
            content: "Hello, world!",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        { contextLoader: mockDocumentLoader },
      ),
    ),
  });
  const ldSignedContext = createRequestContext({
    federation,
    request: ldSignedRequest,
    url: new URL(ldSignedRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: restrictiveContextLoader,
  });
  response = await handleInbox(ldSignedRequest, {
    recipient: null,
    context: ldSignedContext,
    inboxContextFactory(_activity) {
      return createInboxContext({ ...ldSignedContext, clone: undefined });
    },
    ...inboxOptions,
  });
  assertEquals(onNotFoundCalled, null);
  assertEquals([response.status, await response.text()], [202, ""]);

  const remoteContextUrl = "https://remote.example/contexts/ext";
  let failRemoteContextOnce = true;
  const flakyContextLoader = async (resource: string) => {
    const url = new URL(resource).href;
    if (url === remoteContextUrl) {
      if (failRemoteContextOnce) {
        failRemoteContextOnce = false;
        throw new Error(`Unexpected context: ${url}`);
      }
      return {
        contextUrl: null,
        documentUrl: url,
        document: {
          "@context": {
            ext: "https://example.com/ext",
          },
        },
      };
    }
    return await mockDocumentLoader(url);
  };
  const httpSignedLdBody = {
    "@context": [
      remoteContextUrl,
      "https://www.w3.org/ns/activitystreams",
    ],
    id: "https://example.com/activities/http-signed-ld",
    type: "Create",
    actor: "https://example.com/person2",
    ext: "preserve-me",
    object: {
      id: "https://example.com/notes/http-signed-ld",
      type: "Note",
      attributedTo: "https://example.com/person2",
      content: "Hello, world!",
    },
    signature: {
      type: "RsaSignature2017",
      creator: rsaPublicKey3.id!.href,
      created: "2024-01-01T00:00:00Z",
      signatureValue: "bogus",
    },
  };
  const httpSignedLdRequest = await signRequest(
    new Request("https://example.com/", {
      method: "POST",
      body: JSON.stringify(httpSignedLdBody),
    }),
    rsaPrivateKey3,
    rsaPublicKey3.id!,
  );
  const httpSignedLdContext = createRequestContext({
    federation,
    request: httpSignedLdRequest,
    url: new URL(httpSignedLdRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: flakyContextLoader,
  });
  response = await handleInbox(httpSignedLdRequest, {
    recipient: null,
    context: httpSignedLdContext,
    inboxContextFactory(_activity) {
      return createInboxContext({ ...httpSignedLdContext, clone: undefined });
    },
    ...inboxOptions,
  });
  assertEquals(onNotFoundCalled, null);
  assertEquals([response.status, await response.text()], [202, ""]);

  const ldSignedOnlyBody = await signJsonLd(
    {
      "@context": [
        remoteContextUrl,
        "https://www.w3.org/ns/activitystreams",
      ],
      id: "https://example.com/activities/ld-only-transient",
      type: "Create",
      actor: "https://example.com/person2",
      ext: "preserve-me",
      object: {
        id: "https://example.com/notes/ld-only-transient",
        type: "Note",
        attributedTo: "https://example.com/person2",
        content: "Hello, world!",
      },
    },
    rsaPrivateKey3,
    rsaPublicKey3.id!,
    {
      contextLoader: async (resource: string) => {
        const url = new URL(resource).href;
        if (url === remoteContextUrl) {
          return {
            contextUrl: null,
            documentUrl: url,
            document: {
              "@context": {
                ext: "https://example.com/ext",
              },
            },
          };
        }
        return await mockDocumentLoader(url);
      },
    },
  );
  const malformedTemporalLdSignedBody = await signJsonLd(
    {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://example.com/activities/ld-only-invalid-published",
      type: "Create",
      actor: "https://example.com/person2",
      published: { "@value": "not-a-date" },
      object: {
        id: "https://example.com/notes/ld-only-invalid-published",
        type: "Note",
        attributedTo: "https://example.com/person2",
        content: "Hello, world!",
      },
    },
    rsaPrivateKey3,
    rsaPublicKey3.id!,
    {
      contextLoader: mockDocumentLoader,
    },
  );
  const malformedTemporalLdSignedRequest = new Request("https://example.com/", {
    method: "POST",
    body: JSON.stringify(malformedTemporalLdSignedBody),
  });
  const malformedTemporalLdSignedContext = createRequestContext({
    federation,
    request: malformedTemporalLdSignedRequest,
    url: new URL(malformedTemporalLdSignedRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  response = await handleInbox(malformedTemporalLdSignedRequest, {
    recipient: null,
    context: malformedTemporalLdSignedContext,
    inboxContextFactory(_activity) {
      return createInboxContext({
        ...malformedTemporalLdSignedContext,
        clone: undefined,
      });
    },
    ...inboxOptions,
  });
  assertEquals([response.status, await response.text()], [
    400,
    "Invalid activity.",
  ]);
  const malformedClosedLdSignedBody = await signJsonLd(
    {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://example.com/questions/ld-only-invalid-closed",
      type: "Question",
      closed: "2024-02-31T00:00:00Z",
    },
    rsaPrivateKey3,
    rsaPublicKey3.id!,
    {
      contextLoader: mockDocumentLoader,
    },
  );
  const malformedClosedLdSignedRequest = new Request("https://example.com/", {
    method: "POST",
    body: JSON.stringify(malformedClosedLdSignedBody),
  });
  const malformedClosedLdSignedContext = createRequestContext({
    federation,
    request: malformedClosedLdSignedRequest,
    url: new URL(malformedClosedLdSignedRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  response = await handleInbox(malformedClosedLdSignedRequest, {
    recipient: null,
    context: malformedClosedLdSignedContext,
    inboxContextFactory(_activity) {
      return createInboxContext({
        ...malformedClosedLdSignedContext,
        clone: undefined,
      });
    },
    ...inboxOptions,
  });
  assertEquals([response.status, await response.text()], [
    400,
    "Invalid activity.",
  ]);

  const malformedIriHttpSignedRequest = await signRequest(
    new Request("https://example.com/", {
      method: "POST",
      body: JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        id: "http://[",
        type: "Create",
        actor: "https://example.com/person2",
        object: {
          id: "https://example.com/notes/http-signed-invalid-iri",
          type: "Note",
          attributedTo: "https://example.com/person2",
          content: "Hello, world!",
        },
      }),
    }),
    rsaPrivateKey3,
    rsaPublicKey3.id!,
  );
  const malformedIriHttpSignedContext = createRequestContext({
    federation,
    request: malformedIriHttpSignedRequest,
    url: new URL(malformedIriHttpSignedRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  response = await handleInbox(malformedIriHttpSignedRequest, {
    recipient: null,
    context: malformedIriHttpSignedContext,
    inboxContextFactory(_activity) {
      return createInboxContext({
        ...malformedIriHttpSignedContext,
        clone: undefined,
      });
    },
    ...inboxOptions,
  });
  assertEquals([response.status, await response.text()], [
    400,
    "Invalid activity.",
  ]);

  const ldSignedOnlyRequest = new Request("https://example.com/", {
    method: "POST",
    body: JSON.stringify(ldSignedOnlyBody),
  });
  const ldSignedOnlyContext = createRequestContext({
    federation,
    request: ldSignedOnlyRequest,
    url: new URL(ldSignedOnlyRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: async (resource: string) => {
      const url = new URL(resource).href;
      if (url === remoteContextUrl) {
        throw new Error(`Unexpected context: ${url}`);
      }
      return await mockDocumentLoader(url);
    },
  });
  await assertRejects(
    () =>
      handleInbox(ldSignedOnlyRequest, {
        recipient: null,
        context: ldSignedOnlyContext,
        inboxContextFactory(_activity) {
          return createInboxContext({
            ...ldSignedOnlyContext,
            clone: undefined,
          });
        },
        ...inboxOptions,
      }),
    Error,
  );

  failRemoteContextOnce = true;
  const invalidHttpFallbackRequest = new Request("https://example.com/", {
    method: "POST",
    body: JSON.stringify(ldSignedOnlyBody),
    headers: { Signature: "bogus" },
  });
  const invalidHttpFallbackContext = createRequestContext({
    federation,
    request: invalidHttpFallbackRequest,
    url: new URL(invalidHttpFallbackRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: flakyContextLoader,
  });
  await assertRejects(
    () =>
      handleInbox(invalidHttpFallbackRequest, {
        recipient: null,
        context: invalidHttpFallbackContext,
        inboxContextFactory(_activity) {
          return createInboxContext({
            ...invalidHttpFallbackContext,
            clone: undefined,
          });
        },
        ...inboxOptions,
      }),
    Error,
  );

  const transientKeyContextUrl = "https://remote.example/contexts/key";
  const transientCreatorUrl = "https://remote.example/keys/transient#main-key";
  const verificationFailureLdSignedBody = await signJsonLd(
    {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://example.com/activities/ld-key-fetch-transient",
      type: "Create",
      actor: "https://example.com/person2",
      object: {
        id: "https://example.com/notes/ld-key-fetch-transient",
        type: "Note",
        attributedTo: "https://example.com/person2",
        content: "Hello, world!",
      },
    },
    rsaPrivateKey3,
    new URL(transientCreatorUrl),
    {
      contextLoader: mockDocumentLoader,
    },
  );
  const verificationFailureLdSignedRequest = new Request(
    "https://example.com/",
    {
      method: "POST",
      body: JSON.stringify(verificationFailureLdSignedBody),
      headers: { Signature: "bogus" },
    },
  );
  const verificationFailureLdSignedContext = createRequestContext({
    federation,
    request: verificationFailureLdSignedRequest,
    url: new URL(verificationFailureLdSignedRequest.url),
    data: undefined,
    documentLoader: async (resource: string) => {
      if (resource === transientCreatorUrl) {
        return {
          contextUrl: null,
          documentUrl: resource,
          document: {
            "@context": [transientKeyContextUrl],
            id: resource,
          },
        };
      }
      return await mockDocumentLoader(new URL(resource).href);
    },
    contextLoader: async (resource: string) => {
      if (resource === transientKeyContextUrl) {
        throw new Error(`Transient key context failure: ${resource}`);
      }
      return await mockDocumentLoader(new URL(resource).href);
    },
  });
  response = await handleInbox(verificationFailureLdSignedRequest, {
    recipient: null,
    context: verificationFailureLdSignedContext,
    inboxContextFactory(_activity) {
      return createInboxContext({
        ...verificationFailureLdSignedContext,
        clone: undefined,
      });
    },
    ...inboxOptions,
  });
  assertEquals([response.status, await response.text()], [
    401,
    "Failed to verify the request signature.",
  ]);

  failRemoteContextOnce = true;
  const deferredMalformedTemporalLdSignedBody = await signJsonLd(
    {
      "@context": [
        remoteContextUrl,
        "https://www.w3.org/ns/activitystreams",
      ],
      id: "https://example.com/activities/deferred-invalid-published",
      type: "Create",
      actor: "https://example.com/person2",
      ext: "preserve-me",
      published: { "@value": "not-a-date" },
      object: {
        id: "https://example.com/notes/deferred-invalid-published",
        type: "Note",
        attributedTo: "https://example.com/person2",
        content: "Hello, world!",
      },
    },
    rsaPrivateKey3,
    rsaPublicKey3.id!,
    {
      contextLoader: async (resource: string) => {
        const url = new URL(resource).href;
        if (url === remoteContextUrl) {
          return {
            contextUrl: null,
            documentUrl: url,
            document: {
              "@context": {
                ext: "https://example.com/ext",
              },
            },
          };
        }
        return await mockDocumentLoader(url);
      },
    },
  );
  const deferredMalformedTemporalLdSignedRequest = new Request(
    "https://example.com/",
    {
      method: "POST",
      body: JSON.stringify(deferredMalformedTemporalLdSignedBody),
      headers: { Signature: "bogus" },
    },
  );
  const deferredMalformedTemporalLdSignedContext = createRequestContext({
    federation,
    request: deferredMalformedTemporalLdSignedRequest,
    url: new URL(deferredMalformedTemporalLdSignedRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: flakyContextLoader,
  });
  response = await handleInbox(deferredMalformedTemporalLdSignedRequest, {
    recipient: null,
    context: deferredMalformedTemporalLdSignedContext,
    inboxContextFactory(_activity) {
      return createInboxContext({
        ...deferredMalformedTemporalLdSignedContext,
        clone: undefined,
      });
    },
    ...inboxOptions,
  });
  assertEquals([response.status, await response.text()], [
    400,
    "Invalid activity.",
  ]);

  const malformedLdSignedRequest = new Request("https://example.com/", {
    method: "POST",
    body: JSON.stringify({
      ...ldSignedOnlyBody,
      "@context": [
        "not a url",
        "https://www.w3.org/ns/activitystreams",
      ],
    }),
  });
  const malformedLdSignedContext = createRequestContext({
    federation,
    request: malformedLdSignedRequest,
    url: new URL(malformedLdSignedRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  });
  response = await handleInbox(malformedLdSignedRequest, {
    recipient: null,
    context: malformedLdSignedContext,
    inboxContextFactory(_activity) {
      return createInboxContext({
        ...malformedLdSignedContext,
        clone: undefined,
      });
    },
    ...inboxOptions,
  });
  assertEquals([response.status, await response.text()], [
    400,
    "Invalid JSON-LD.",
  ]);

  const dualSignedInvalidCreatorRequest = await signRequest(
    new Request("https://example.com/", {
      method: "POST",
      body: JSON.stringify({
        ...httpSignedLdBody,
        signature: {
          ...httpSignedLdBody.signature,
          creator: "not a url",
        },
      }),
    }),
    rsaPrivateKey3,
    rsaPublicKey3.id!,
  );
  const dualSignedInvalidCreatorContext = createRequestContext({
    federation,
    request: dualSignedInvalidCreatorRequest,
    url: new URL(dualSignedInvalidCreatorRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: flakyContextLoader,
  });
  response = await handleInbox(dualSignedInvalidCreatorRequest, {
    recipient: null,
    context: dualSignedInvalidCreatorContext,
    inboxContextFactory(_activity) {
      return createInboxContext({
        ...dualSignedInvalidCreatorContext,
        clone: undefined,
      });
    },
    ...inboxOptions,
  });
  assertEquals(onNotFoundCalled, null);
  assertEquals([response.status, await response.text()], [202, ""]);

  const invalidUrlHttpSignedRequest = await signRequest(
    new Request("https://example.com/", {
      method: "POST",
      body: JSON.stringify({
        "@context": [
          remoteContextUrl,
          "https://www.w3.org/ns/activitystreams",
        ],
        id: "https://example.com/activities/http-signed-invalid-context",
        type: "Create",
        actor: "https://example.com/person2",
        ext: "preserve-me",
        object: {
          id: "https://example.com/notes/http-signed-invalid-context",
          type: "Note",
          attributedTo: "https://example.com/person2",
          content: "Hello, world!",
        },
      }),
    }),
    rsaPrivateKey3,
    rsaPublicKey3.id!,
  );
  const invalidUrlHttpSignedContext = createRequestContext({
    federation,
    request: invalidUrlHttpSignedRequest,
    url: new URL(invalidUrlHttpSignedRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: async (resource: string) => {
      const url = new URL(resource).href;
      if (url === remoteContextUrl) {
        const error = new Error(
          `Transient remote context failure: ${url}`,
        ) as Error & { details?: { code: string; url: string } };
        error.name = "jsonld.InvalidUrl";
        error.details = {
          code: "loading remote context failed",
          url,
        };
        throw error;
      }
      return await mockDocumentLoader(url);
    },
  });
  await assertRejects(
    () =>
      handleInbox(invalidUrlHttpSignedRequest, {
        recipient: null,
        context: invalidUrlHttpSignedContext,
        inboxContextFactory(_activity) {
          return createInboxContext({
            ...invalidUrlHttpSignedContext,
            clone: undefined,
          });
        },
        ...inboxOptions,
      }),
    Error,
  );

  const opaqueContextIdHttpSignedRequest = await signRequest(
    new Request("https://example.com/", {
      method: "POST",
      body: JSON.stringify({
        "@context": [
          "app-context",
          "https://www.w3.org/ns/activitystreams",
        ],
        id: "https://example.com/activities/http-signed-opaque-context",
        type: "Create",
        actor: "https://example.com/person2",
        object: {
          id: "https://example.com/notes/http-signed-opaque-context",
          type: "Note",
          attributedTo: "https://example.com/person2",
          content: "Hello, world!",
        },
      }),
    }),
    rsaPrivateKey3,
    rsaPublicKey3.id!,
  );
  const opaqueContextIdHttpSignedContext = createRequestContext({
    federation,
    request: opaqueContextIdHttpSignedRequest,
    url: new URL(opaqueContextIdHttpSignedRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: async (resource: string) => {
      if (resource === "app-context") {
        const error = new Error(
          `Opaque context backend is unavailable: ${resource}`,
        ) as Error & { details?: { code: string; url: string } };
        error.name = "jsonld.InvalidUrl";
        error.details = {
          code: "loading remote context failed",
          url: resource,
        };
        throw error;
      }
      return await mockDocumentLoader(new URL(resource).href);
    },
  });
  await assertRejects(
    () =>
      handleInbox(opaqueContextIdHttpSignedRequest, {
        recipient: null,
        context: opaqueContextIdHttpSignedContext,
        inboxContextFactory(_activity) {
          return createInboxContext({
            ...opaqueContextIdHttpSignedContext,
            clone: undefined,
          });
        },
        ...inboxOptions,
      }),
    Error,
  );

  const opaqueContextTypeErrorHttpSignedRequest = await signRequest(
    new Request("https://example.com/", {
      method: "POST",
      body: JSON.stringify({
        "@context": [
          "app:context",
          "https://www.w3.org/ns/activitystreams",
        ],
        id: "https://example.com/activities/http-signed-opaque-typeerror",
        type: "Create",
        actor: "https://example.com/person2",
        object: {
          id: "https://example.com/notes/http-signed-opaque-typeerror",
          type: "Note",
          attributedTo: "https://example.com/person2",
          content: "Hello, world!",
        },
      }),
    }),
    rsaPrivateKey3,
    rsaPublicKey3.id!,
  );
  const opaqueContextTypeErrorHttpSignedContext = createRequestContext({
    federation,
    request: opaqueContextTypeErrorHttpSignedRequest,
    url: new URL(opaqueContextTypeErrorHttpSignedRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: async (resource: string) => {
      if (resource === "app:context") {
        throw new TypeError(`Invalid URL: ${resource}`);
      }
      return await mockDocumentLoader(new URL(resource).href);
    },
  });
  await assertRejects(
    () =>
      handleInbox(opaqueContextTypeErrorHttpSignedRequest, {
        recipient: null,
        context: opaqueContextTypeErrorHttpSignedContext,
        inboxContextFactory(_activity) {
          return createInboxContext({
            ...opaqueContextTypeErrorHttpSignedContext,
            clone: undefined,
          });
        },
        ...inboxOptions,
      }),
    Error,
  );

  const networkPathContextHttpSignedRequest = await signRequest(
    new Request("https://example.com/", {
      method: "POST",
      body: JSON.stringify({
        "@context": [
          "//cdn.example/ctx",
          "https://www.w3.org/ns/activitystreams",
        ],
        id: "https://example.com/activities/http-signed-network-path-context",
        type: "Create",
        actor: "https://example.com/person2",
        object: {
          id: "https://example.com/notes/http-signed-network-path-context",
          type: "Note",
          attributedTo: "https://example.com/person2",
          content: "Hello, world!",
        },
      }),
    }),
    rsaPrivateKey3,
    rsaPublicKey3.id!,
  );
  const networkPathContextHttpSignedContext = createRequestContext({
    federation,
    request: networkPathContextHttpSignedRequest,
    url: new URL(networkPathContextHttpSignedRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: async (resource: string) => {
      if (resource === "//cdn.example/ctx") {
        const error = new Error(
          `Network-path context backend is unavailable: ${resource}`,
        ) as Error & { details?: { code: string; url: string } };
        error.name = "jsonld.InvalidUrl";
        error.details = {
          code: "loading remote context failed",
          url: resource,
        };
        throw error;
      }
      return await mockDocumentLoader(new URL(resource).href);
    },
  });
  await assertRejects(
    () =>
      handleInbox(networkPathContextHttpSignedRequest, {
        recipient: null,
        context: networkPathContextHttpSignedContext,
        inboxContextFactory(_activity) {
          return createInboxContext({
            ...networkPathContextHttpSignedContext,
            clone: undefined,
          });
        },
        ...inboxOptions,
      }),
    Error,
  );

  const malformedNetworkPathContextHttpSignedRequest = await signRequest(
    new Request("https://example.com/", {
      method: "POST",
      body: JSON.stringify({
        "@context": [
          "//[",
          "https://www.w3.org/ns/activitystreams",
        ],
        id:
          "https://example.com/activities/http-signed-malformed-network-path-context",
        type: "Create",
        actor: "https://example.com/person2",
        object: {
          id:
            "https://example.com/notes/http-signed-malformed-network-path-context",
          type: "Note",
          attributedTo: "https://example.com/person2",
          content: "Hello, world!",
        },
      }),
    }),
    rsaPrivateKey3,
    rsaPublicKey3.id!,
  );
  const malformedNetworkPathContextHttpSignedContext = createRequestContext({
    federation,
    request: malformedNetworkPathContextHttpSignedRequest,
    url: new URL(malformedNetworkPathContextHttpSignedRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: async (resource: string) => {
      if (resource === "//[") {
        const error = new Error(
          `Malformed network-path context: ${resource}`,
        ) as Error & { details?: { code: string; url: string } };
        error.name = "jsonld.InvalidUrl";
        error.details = {
          code: "loading remote context failed",
          url: resource,
        };
        throw error;
      }
      return await mockDocumentLoader(new URL(resource).href);
    },
  });
  response = await handleInbox(
    malformedNetworkPathContextHttpSignedRequest,
    {
      recipient: null,
      context: malformedNetworkPathContextHttpSignedContext,
      inboxContextFactory(_activity) {
        return createInboxContext({
          ...malformedNetworkPathContextHttpSignedContext,
          clone: undefined,
        });
      },
      ...inboxOptions,
    },
  );
  assertEquals(response.status, 400);

  const malformedUrlLikeContextHttpSignedRequest = await signRequest(
    new Request("https://example.com/", {
      method: "POST",
      body: JSON.stringify({
        "@context": [
          "http://[",
          "https://www.w3.org/ns/activitystreams",
        ],
        id:
          "https://example.com/activities/http-signed-malformed-url-like-context",
        type: "Create",
        actor: "https://example.com/person2",
        object: {
          id:
            "https://example.com/notes/http-signed-malformed-url-like-context",
          type: "Note",
          attributedTo: "https://example.com/person2",
          content: "Hello, world!",
        },
      }),
    }),
    rsaPrivateKey3,
    rsaPublicKey3.id!,
  );
  const malformedUrlLikeContextHttpSignedContext = createRequestContext({
    federation,
    request: malformedUrlLikeContextHttpSignedRequest,
    url: new URL(malformedUrlLikeContextHttpSignedRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: async (resource: string) => {
      if (resource === "http://[") {
        const error = new Error(
          `Invalid remote context URL: ${resource}`,
        ) as Error & { details?: { code: string; url: string } };
        error.name = "jsonld.InvalidUrl";
        error.details = {
          code: "loading remote context failed",
          url: resource,
        };
        throw error;
      }
      return await mockDocumentLoader(new URL(resource).href);
    },
  });
  response = await handleInbox(malformedUrlLikeContextHttpSignedRequest, {
    recipient: null,
    context: malformedUrlLikeContextHttpSignedContext,
    inboxContextFactory(_activity) {
      return createInboxContext({
        ...malformedUrlLikeContextHttpSignedContext,
        clone: undefined,
      });
    },
    ...inboxOptions,
  });
  assertEquals(response.status, 400);

  const malformedContextUrlHttpSignedRequest = await signRequest(
    new Request("https://example.com/", {
      method: "POST",
      body: JSON.stringify({
        "@context": [
          "not a url",
          "https://www.w3.org/ns/activitystreams",
        ],
        id: "https://example.com/activities/http-signed-malformed-context",
        type: "Create",
        actor: "https://example.com/person2",
        object: {
          id: "https://example.com/notes/http-signed-malformed-context",
          type: "Note",
          attributedTo: "https://example.com/person2",
          content: "Hello, world!",
        },
      }),
    }),
    rsaPrivateKey3,
    rsaPublicKey3.id!,
  );
  const malformedContextUrlHttpSignedContext = createRequestContext({
    federation,
    request: malformedContextUrlHttpSignedRequest,
    url: new URL(malformedContextUrlHttpSignedRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: async (resource: string) => {
      if (resource === "not a url") {
        const error = new Error(
          `Invalid remote context URL: ${resource}`,
        ) as Error & { details?: { code: string; url: string } };
        error.name = "jsonld.InvalidUrl";
        error.details = {
          code: "loading remote context failed",
          url: resource,
        };
        throw error;
      }
      return await mockDocumentLoader(new URL(resource).href);
    },
  });
  response = await handleInbox(malformedContextUrlHttpSignedRequest, {
    recipient: null,
    context: malformedContextUrlHttpSignedContext,
    inboxContextFactory(_activity) {
      return createInboxContext({
        ...malformedContextUrlHttpSignedContext,
        clone: undefined,
      });
    },
    ...inboxOptions,
  });
  assertEquals(response.status, 400);

  const invalidRemoteContextHttpSignedRequest = await signRequest(
    new Request("https://example.com/", {
      method: "POST",
      body: JSON.stringify({
        "@context": [
          remoteContextUrl,
          "https://www.w3.org/ns/activitystreams",
        ],
        id: "https://example.com/activities/http-signed-invalid-remote-context",
        type: "Create",
        actor: "https://example.com/person2",
        object: {
          id: "https://example.com/notes/http-signed-invalid-remote-context",
          type: "Note",
          attributedTo: "https://example.com/person2",
          content: "Hello, world!",
        },
      }),
    }),
    rsaPrivateKey3,
    rsaPublicKey3.id!,
  );
  const invalidRemoteContextHttpSignedContext = createRequestContext({
    federation,
    request: invalidRemoteContextHttpSignedRequest,
    url: new URL(invalidRemoteContextHttpSignedRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: async (resource: string) => {
      const url = new URL(resource).href;
      if (url === remoteContextUrl) {
        return {
          contextUrl: null,
          documentUrl: url,
          document: ["not", "an", "object"],
        };
      }
      return await mockDocumentLoader(url);
    },
  });
  response = await handleInbox(invalidRemoteContextHttpSignedRequest, {
    recipient: null,
    context: invalidRemoteContextHttpSignedContext,
    inboxContextFactory(_activity) {
      return createInboxContext({
        ...invalidRemoteContextHttpSignedContext,
        clone: undefined,
      });
    },
    ...inboxOptions,
  });
  assertEquals(response.status, 400);

  const invalidUrlAbsoluteContextHttpSignedRequest = await signRequest(
    new Request("https://example.com/", {
      method: "POST",
      body: JSON.stringify({
        "@context": [
          remoteContextUrl,
          "https://www.w3.org/ns/activitystreams",
        ],
        id: "https://example.com/activities/http-signed-invalid-url-context",
        type: "Create",
        actor: "https://example.com/person2",
        ext: "preserve-me",
        object: {
          id: "https://example.com/notes/http-signed-invalid-url-context",
          type: "Note",
          attributedTo: "https://example.com/person2",
          content: "Hello, world!",
        },
      }),
    }),
    rsaPrivateKey3,
    rsaPublicKey3.id!,
  );
  const invalidUrlAbsoluteContextHttpSignedContext = createRequestContext({
    federation,
    request: invalidUrlAbsoluteContextHttpSignedRequest,
    url: new URL(invalidUrlAbsoluteContextHttpSignedRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: async (resource: string) => {
      const url = new URL(resource).href;
      if (url === remoteContextUrl) {
        throw new TypeError(`Invalid URL: ${url}`);
      }
      return await mockDocumentLoader(url);
    },
  });
  await assertRejects(
    () =>
      handleInbox(invalidUrlAbsoluteContextHttpSignedRequest, {
        recipient: null,
        context: invalidUrlAbsoluteContextHttpSignedContext,
        inboxContextFactory(_activity) {
          return createInboxContext({
            ...invalidUrlAbsoluteContextHttpSignedContext,
            clone: undefined,
          });
        },
        ...inboxOptions,
      }),
    Error,
  );

  const typeErrorHttpSignedRequest = await signRequest(
    new Request("https://example.com/", {
      method: "POST",
      body: JSON.stringify({
        "@context": [
          remoteContextUrl,
          "https://www.w3.org/ns/activitystreams",
        ],
        id: "https://example.com/activities/http-signed-typeerror-context",
        type: "Create",
        actor: "https://example.com/person2",
        ext: "preserve-me",
        object: {
          id: "https://example.com/notes/http-signed-typeerror-context",
          type: "Note",
          attributedTo: "https://example.com/person2",
          content: "Hello, world!",
        },
      }),
    }),
    rsaPrivateKey3,
    rsaPublicKey3.id!,
  );
  const typeErrorHttpSignedContext = createRequestContext({
    federation,
    request: typeErrorHttpSignedRequest,
    url: new URL(typeErrorHttpSignedRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: async (resource: string) => {
      const url = new URL(resource).href;
      if (url === remoteContextUrl) {
        throw new TypeError(`The remote context host timed out: ${url}`);
      }
      return await mockDocumentLoader(url);
    },
  });
  await assertRejects(
    () =>
      handleInbox(typeErrorHttpSignedRequest, {
        recipient: null,
        context: typeErrorHttpSignedContext,
        inboxContextFactory(_activity) {
          return createInboxContext({
            ...typeErrorHttpSignedContext,
            clone: undefined,
          });
        },
        ...inboxOptions,
      }),
    Error,
  );

  const rangeErrorHttpSignedRequest = await signRequest(
    new Request("https://example.com/", {
      method: "POST",
      body: JSON.stringify({
        "@context": [
          remoteContextUrl,
          "https://www.w3.org/ns/activitystreams",
        ],
        id: "https://example.com/activities/http-signed-rangeerror-context",
        type: "Create",
        actor: "https://example.com/person2",
        ext: "preserve-me",
        object: {
          id: "https://example.com/notes/http-signed-rangeerror-context",
          type: "Note",
          attributedTo: "https://example.com/person2",
          content: "Hello, world!",
        },
      }),
    }),
    rsaPrivateKey3,
    rsaPublicKey3.id!,
  );
  const rangeErrorHttpSignedContext = createRequestContext({
    federation,
    request: rangeErrorHttpSignedRequest,
    url: new URL(rangeErrorHttpSignedRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: async (resource: string) => {
      const url = new URL(resource).href;
      if (url === remoteContextUrl) {
        throw new RangeError(
          `Temporary remote context cache window exceeded: ${url}`,
        );
      }
      return await mockDocumentLoader(url);
    },
  });
  await assertRejects(
    () =>
      handleInbox(rangeErrorHttpSignedRequest, {
        recipient: null,
        context: rangeErrorHttpSignedContext,
        inboxContextFactory(_activity) {
          return createInboxContext({
            ...rangeErrorHttpSignedContext,
            clone: undefined,
          });
        },
        ...inboxOptions,
      }),
    Error,
  );

  const syntaxErrorHttpSignedRequest = await signRequest(
    new Request("https://example.com/", {
      method: "POST",
      body: JSON.stringify({
        "@context": [
          remoteContextUrl,
          "https://www.w3.org/ns/activitystreams",
        ],
        id: "https://example.com/activities/http-signed-syntax-context",
        type: "Create",
        actor: "https://example.com/person2",
        ext: "preserve-me",
        object: {
          id: "https://example.com/notes/http-signed-syntax-context",
          type: "Note",
          attributedTo: "https://example.com/person2",
          content: "Hello, world!",
        },
      }),
    }),
    rsaPrivateKey3,
    rsaPublicKey3.id!,
  );
  const syntaxErrorHttpSignedContext = createRequestContext({
    federation,
    request: syntaxErrorHttpSignedRequest,
    url: new URL(syntaxErrorHttpSignedRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: async (resource: string) => {
      const url = new URL(resource).href;
      if (url === remoteContextUrl) {
        const error = new Error(
          `Transient syntax failure: ${url}`,
        ) as Error & { details?: { code: string } };
        error.name = "jsonld.SyntaxError";
        error.details = { code: "loading remote context failed" };
        throw error;
      }
      return await mockDocumentLoader(url);
    },
  });
  await assertRejects(
    () =>
      handleInbox(syntaxErrorHttpSignedRequest, {
        recipient: null,
        context: syntaxErrorHttpSignedContext,
        inboxContextFactory(_activity) {
          return createInboxContext({
            ...syntaxErrorHttpSignedContext,
            clone: undefined,
          });
        },
        ...inboxOptions,
      }),
    Error,
  );

  response = await handleInbox(signedRequest, {
    recipient: "someone",
    context: signedContext,
    inboxContextFactory(_activity) {
      return createInboxContext({
        ...unsignedContext,
        clone: undefined,
        recipient: "someone",
      });
    },
    ...inboxOptions,
  });
  assertEquals(onNotFoundCalled, null);
  assertEquals([response.status, await response.text()], [202, ""]);

  response = await handleInbox(unsignedRequest, {
    recipient: null,
    context: unsignedContext,
    inboxContextFactory(_activity) {
      return createInboxContext({ ...unsignedContext, clone: undefined });
    },
    ...inboxOptions,
    skipSignatureVerification: true,
  });
  assertEquals(onNotFoundCalled, null);
  assertEquals(response.status, 202);

  response = await handleInbox(unsignedRequest, {
    recipient: "someone",
    context: unsignedContext,
    inboxContextFactory(_activity) {
      return createInboxContext({
        ...unsignedContext,
        clone: undefined,
        recipient: "someone",
      });
    },
    ...inboxOptions,
    skipSignatureVerification: true,
  });
  assertEquals(onNotFoundCalled, null);
  assertEquals(response.status, 202);

  const unsafeJson = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      { rev: "@reverse" },
    ],
    id: "https://example.com/activities/unsafe",
    type: "Announce",
    actor: "https://example.com/person2",
    object: "https://example.com/notes/1",
    rev: {
      object: {
        id: "https://example.com/activities/undo",
        type: "Undo",
        actor: "https://example.com/person2",
      },
    },
  };
  const unsafeRequest = await signRequest(
    new Request("https://example.com/", {
      method: "POST",
      body: JSON.stringify(unsafeJson),
    }),
    rsaPrivateKey3,
    rsaPublicKey3.id!,
  );
  const unsafeContext = createRequestContext({
    federation,
    request: unsafeRequest,
    url: new URL(unsafeRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
  });
  response = await handleInbox(unsafeRequest, {
    recipient: null,
    context: unsafeContext,
    inboxContextFactory(_activity) {
      return createInboxContext({ ...unsafeContext, clone: undefined });
    },
    ...inboxOptions,
  });
  assertEquals(response.status, 202);

  const unsafeLdRequest = new Request("https://example.com/", {
    method: "POST",
    body: JSON.stringify(
      await signJsonLd(
        unsafeJson,
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        { contextLoader: mockDocumentLoader },
      ),
    ),
  });
  const unsafeLdContext = createRequestContext({
    federation,
    request: unsafeLdRequest,
    url: new URL(unsafeLdRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
  });
  response = await handleInbox(unsafeLdRequest, {
    recipient: null,
    context: unsafeLdContext,
    inboxContextFactory(_activity) {
      return createInboxContext({ ...unsafeLdContext, clone: undefined });
    },
    ...inboxOptions,
  });
  assertEquals(response.status, 400);

  const invalidRequest = new Request("https://example.com/", {
    method: "POST",
    body: JSON.stringify({
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        true,
        23,
      ],
      type: "Create",
      object: { type: "Note", content: "Hello, world!" },
      actor: "https://example.com/users/alice",
    }),
  });
  const signedInvalidRequest = await signRequest(
    invalidRequest,
    rsaPrivateKey3,
    rsaPublicKey3.id!,
  );
  const signedInvalidContext = createRequestContext({
    federation,
    request: signedInvalidRequest,
    url: new URL(signedInvalidRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
  });
  response = await handleInbox(signedInvalidRequest, {
    recipient: null,
    context: signedContext,
    inboxContextFactory(_activity) {
      return createInboxContext({ ...signedInvalidContext, clone: undefined });
    },
    ...inboxOptions,
  });
  assertEquals(onNotFoundCalled, null);
  assertEquals(response.status, 400);
});

test("handleInbox() preserves the raw signed payload for inboxContextFactory", async () => {
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  const remoteContextUrl = "https://remote.example/contexts/ext";
  const sourceContextLoader = async (resource: string) => {
    const url = new URL(resource).href;
    if (url === remoteContextUrl) {
      return {
        contextUrl: null,
        documentUrl: url,
        document: {
          "@context": {
            ext: "https://example.com/ext",
          },
        },
      };
    }
    return await mockDocumentLoader(url);
  };
  const signed = await signJsonLd(
    {
      "@context": [
        remoteContextUrl,
        "https://www.w3.org/ns/activitystreams",
      ],
      id: "https://example.com/activities/preserve-raw",
      type: "Create",
      actor: "https://example.com/person2",
      ext: "preserve-me",
      object: {
        id: "https://example.com/notes/preserve-raw",
        type: "Note",
        attributedTo: "https://example.com/person2",
        content: "Hello, world!",
      },
    },
    rsaPrivateKey3,
    rsaPublicKey3.id!,
    { contextLoader: sourceContextLoader },
  );
  const request = new Request("https://example.com/", {
    method: "POST",
    body: JSON.stringify(signed),
  });
  const context = createRequestContext({
    federation,
    request,
    url: new URL(request.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: sourceContextLoader,
  });
  let receivedRaw: unknown = null;
  let receivedTyped: Create | null = null;
  const inboxListeners = new InboxListenerSet<void>();
  inboxListeners.add(Create, (ctx, activity) => {
    receivedRaw = (ctx as unknown as { activity: unknown }).activity;
    receivedTyped = activity;
  });
  const response = await handleInbox(request, {
    recipient: "someone",
    context,
    inboxContextFactory(recipient, activity, activityId, activityType) {
      return {
        ...createInboxContext({
          ...context,
          clone: undefined,
          recipient,
        }),
        activity,
        activityId,
        activityType,
      };
    },
    kv: new MemoryKvStore(),
    kvPrefixes: {
      activityIdempotence: ["_fedify", "activityIdempotence"],
      publicKey: ["_fedify", "publicKey"],
    },
    actorDispatcher: (_ctx, identifier) =>
      identifier === "someone" ? new Person({ name: "Someone" }) : null,
    inboxListeners,
    onNotFound: () => new Response("Not found", { status: 404 }),
    signatureTimeWindow: { minutes: 5 },
    skipSignatureVerification: false,
  });
  assertEquals([response.status, await response.text()], [202, ""]);
  assertEquals(receivedRaw, signed);
  const delivered = receivedTyped;
  assert(delivered != null);
  const deliveredCreate = delivered as Create;
  assertEquals(
    deliveredCreate.id?.href,
    "https://example.com/activities/preserve-raw",
  );
});

test("handleInbox() enqueues normalizedActivity for LD-signed inbox work", async () => {
  const remoteContextUrl = "https://remote.example/contexts/ext";
  const sourceContextLoader = async (resource: string) => {
    const url = new URL(resource).href;
    if (url === remoteContextUrl) {
      return {
        contextUrl: null,
        documentUrl: url,
        document: {
          "@context": {
            ext: "https://example.com/ext",
          },
        },
      };
    }
    return await mockDocumentLoader(url);
  };
  let queuedMessage: InboxMessage | null = null;
  const queue: MessageQueue = {
    enqueue(message) {
      queuedMessage = message as InboxMessage;
      return Promise.resolve();
    },
    async listen() {
    },
  };
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    queue,
  });
  const signed = await signJsonLd(
    {
      "@context": [
        remoteContextUrl,
        "https://www.w3.org/ns/activitystreams",
      ],
      id: "https://example.com/activities/enqueued-normalized",
      type: "Create",
      actor: "https://example.com/person2",
      ext: "preserve-me",
      object: {
        id: "https://example.com/notes/enqueued-normalized",
        type: "Note",
        attributedTo: "https://example.com/person2",
        content: "Hello, world!",
      },
    },
    rsaPrivateKey3,
    rsaPublicKey3.id!,
    { contextLoader: sourceContextLoader },
  );
  const request = new Request("https://example.com/", {
    method: "POST",
    body: JSON.stringify(signed),
  });
  const context = createRequestContext({
    federation,
    request,
    url: new URL(request.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: sourceContextLoader,
  });
  const response = await handleInbox(request, {
    recipient: "someone",
    context,
    inboxContextFactory(recipient, activity, activityId, activityType) {
      return {
        ...createInboxContext({
          ...context,
          clone: undefined,
          recipient,
        }),
        activity,
        activityId,
        activityType,
      };
    },
    kv: new MemoryKvStore(),
    kvPrefixes: {
      activityIdempotence: ["_fedify", "activityIdempotence"],
      publicKey: ["_fedify", "publicKey"],
    },
    queue,
    actorDispatcher: (_ctx, identifier) =>
      identifier === "someone" ? new Person({ name: "Someone" }) : null,
    onNotFound: () => new Response("Not found", { status: 404 }),
    signatureTimeWindow: { minutes: 5 },
    skipSignatureVerification: false,
  });
  assertEquals([response.status, await response.text()], [
    202,
    "Activity is enqueued.",
  ]);
  const enqueued = queuedMessage;
  assert(enqueued != null);
  const inboxMessage = enqueued as InboxMessage;
  assertEquals(inboxMessage.activity, signed);
  assertEquals(
    inboxMessage.normalizedActivity,
    await compactJsonLd(signed, sourceContextLoader),
  );
  assertEquals(inboxMessage.ldSignatureVerified, true);
});

test(
  "handleInbox() caches normalizedActivity for queued signature-bearing " +
    "fallback traffic",
  async () => {
    const remoteContextUrl = "https://remote.example/contexts/ext";
    let queuedMessage: InboxMessage | null = null;
    const queue: MessageQueue = {
      enqueue(message) {
        queuedMessage = message as InboxMessage;
        return Promise.resolve();
      },
      async listen() {
      },
    };
    const federation = createFederation<void>({
      kv: new MemoryKvStore(),
      queue,
    });
    const sourceContextLoader = async (resource: string) => {
      const url = new URL(resource).href;
      if (url === remoteContextUrl) {
        return {
          contextUrl: null,
          documentUrl: url,
          document: {
            "@context": {
              ext: "https://example.com/ext",
            },
          },
        };
      }
      return await mockDocumentLoader(url);
    };
    const unsignedBody = {
      "@context": [
        remoteContextUrl,
        "https://www.w3.org/ns/activitystreams",
      ],
      id: "https://example.com/activities/non-lds-queued-signature",
      type: "Create",
      actor: "https://example.com/person2",
      ext: "preserve-me",
      object: {
        id: "https://example.com/notes/non-lds-queued-signature",
        type: "Note",
        attributedTo: "https://example.com/person2",
        content: "Hello, world!",
      },
      signature: {
        type: "RsaSignature2017",
        creator: "not a url",
        created: "2024-09-12T16:50:46Z",
        signatureValue: "Zm9v",
      },
    };
    const request = await signRequest(
      new Request("https://example.com/", {
        method: "POST",
        body: JSON.stringify(unsignedBody),
      }),
      rsaPrivateKey3,
      rsaPublicKey3.id!,
    );
    const context = createRequestContext({
      federation,
      request,
      url: new URL(request.url),
      data: undefined,
      documentLoader: mockDocumentLoader,
      contextLoader: sourceContextLoader,
    });
    const response = await handleInbox(request, {
      recipient: "someone",
      context,
      inboxContextFactory(recipient, activity, activityId, activityType) {
        return {
          ...createInboxContext({
            ...context,
            clone: undefined,
            recipient,
          }),
          activity,
          activityId,
          activityType,
        };
      },
      kv: new MemoryKvStore(),
      kvPrefixes: {
        activityIdempotence: ["_fedify", "activityIdempotence"],
        publicKey: ["_fedify", "publicKey"],
      },
      queue,
      actorDispatcher: (_ctx, identifier) =>
        identifier === "someone" ? new Person({ name: "Someone" }) : null,
      onNotFound: () => new Response("Not found", { status: 404 }),
      signatureTimeWindow: { minutes: 5 },
      skipSignatureVerification: false,
    });
    assertEquals([response.status, await response.text()], [
      202,
      "Activity is enqueued.",
    ]);
    if (queuedMessage == null) throw new Error("Inbox message not queued.");
    const inboxMessage = queuedMessage as InboxMessage;
    assertEquals(inboxMessage, {
      type: "inbox",
      id: inboxMessage.id,
      baseUrl: "https://example.com",
      activity: unsignedBody,
      normalizedActivity: await compactJsonLd(
        unsignedBody,
        sourceContextLoader,
      ),
      ldSignatureVerified: false,
      started: inboxMessage.started,
      attempt: 0,
      identifier: "someone",
      traceContext: inboxMessage.traceContext,
    });
  },
);

test("respondWithObject()", async () => {
  const response = await respondWithObject(
    new Note({
      id: new URL("https://example.com/notes/1"),
      content: "Hello, world!",
    }),
    { contextLoader: mockDocumentLoader },
  );
  assert(response.ok);
  assertEquals(
    response.headers.get("Content-Type"),
    "application/activity+json",
  );
  assertEquals(await response.json(), {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
      {
        Emoji: "toot:Emoji",
        Hashtag: "as:Hashtag",
        sensitive: "as:sensitive",
        toot: "http://joinmastodon.org/ns#",
        _misskey_quote: "misskey:_misskey_quote",
        fedibird: "http://fedibird.com/ns#",
        misskey: "https://misskey-hub.net/ns#",
        quoteUri: "fedibird:quoteUri",
        quoteUrl: "as:quoteUrl",
        emojiReactions: {
          "@id": "fedibird:emojiReactions",
          "@type": "@id",
        },
      },
    ],
    id: "https://example.com/notes/1",
    type: "Note",
    content: "Hello, world!",
  });
});

test("handleInbox() - authentication bypass vulnerability", async () => {
  // This test reproduces the authentication bypass vulnerability where
  // activities are processed before verifying the signing key belongs
  // to the claimed actor

  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  let processedActivity: Create | undefined;
  const inboxListeners = new InboxListenerSet<void>();
  inboxListeners.add(Create, (_ctx, activity) => {
    // Track that the malicious activity was processed
    processedActivity = activity;
  });

  // Create malicious activity claiming to be from victim actor
  const maliciousActivity = new Create({
    id: new URL("https://attacker.example.com/activities/malicious"),
    actor: new URL("https://victim.example.com/users/alice"), // Impersonating victim
    object: new Note({
      id: new URL("https://attacker.example.com/notes/forged"),
      attribution: new URL("https://victim.example.com/users/alice"),
      content: "This is a forged message from the victim!",
    }),
  });

  // Sign request with attacker's key (not victim's key)
  const maliciousRequest = await signRequest(
    new Request("https://example.com/", {
      method: "POST",
      body: JSON.stringify(await maliciousActivity.toJsonLd()),
    }),
    rsaPrivateKey3, // Attacker's private key
    rsaPublicKey3.id!, // Attacker's public key ID
  );

  const maliciousContext = createRequestContext({
    request: maliciousRequest,
    url: new URL(maliciousRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    federation,
  });

  const actorDispatcher: ActorDispatcher<void> = (_ctx, identifier) => {
    if (identifier !== "someone") return null;
    return new Person({ name: "Someone" });
  };

  const response = await handleInbox(maliciousRequest, {
    recipient: "someone",
    context: maliciousContext,
    inboxContextFactory(_activity) {
      return createInboxContext({
        url: new URL(maliciousRequest.url),
        data: undefined,
        documentLoader: mockDocumentLoader,
        federation,
        recipient: "someone",
      });
    },
    kv: new MemoryKvStore(),
    kvPrefixes: {
      activityIdempotence: ["_fedify", "activityIdempotence"],
      publicKey: ["_fedify", "publicKey"],
    },
    actorDispatcher,
    inboxListeners,
    onNotFound: () => new Response("Not found", { status: 404 }),
    signatureTimeWindow: { minutes: 5 },
    skipSignatureVerification: false,
  });

  // The vulnerability: Even though the response is 401 (unauthorized),
  // the malicious activity was already processed by routeActivity()
  assertEquals(response.status, 401);
  assertEquals(await response.text(), "The signer and the actor do not match.");

  assertEquals(
    processedActivity,
    undefined,
    `SECURITY VULNERABILITY: Malicious activity with mismatched signature was processed! ` +
      `Activity ID: ${processedActivity?.id?.href}, ` +
      `Claimed actor: ${processedActivity?.actorId?.href}`,
  );

  // If we reach here, the vulnerability is fixed - activities with mismatched
  // signatures are properly rejected before processing
});

test("respondWithObjectIfAcceptable", async () => {
  let request = new Request("https://example.com/", {
    headers: { Accept: "application/activity+json" },
  });
  let response = await respondWithObjectIfAcceptable(
    new Note({
      id: new URL("https://example.com/notes/1"),
      content: "Hello, world!",
    }),
    request,
    { contextLoader: mockDocumentLoader },
  );
  assert(response != null);
  assert(response.ok);
  assertEquals(
    response.headers.get("Content-Type"),
    "application/activity+json",
  );
  assertEquals(await response.json(), {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
      {
        Emoji: "toot:Emoji",
        Hashtag: "as:Hashtag",
        sensitive: "as:sensitive",
        toot: "http://joinmastodon.org/ns#",
        _misskey_quote: "misskey:_misskey_quote",
        fedibird: "http://fedibird.com/ns#",
        misskey: "https://misskey-hub.net/ns#",
        quoteUri: "fedibird:quoteUri",
        quoteUrl: "as:quoteUrl",
        emojiReactions: {
          "@id": "fedibird:emojiReactions",
          "@type": "@id",
        },
      },
    ],
    id: "https://example.com/notes/1",
    type: "Note",
    content: "Hello, world!",
  });

  request = new Request("https://example.com/", {
    headers: { Accept: "text/html" },
  });
  response = await respondWithObjectIfAcceptable(
    new Note({
      id: new URL("https://example.com/notes/1"),
      content: "Hello, world!",
    }),
    request,
    { contextLoader: mockDocumentLoader },
  );
  assertEquals(response, null);
});

test("handleCustomCollection()", async () => {
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  let context = createRequestContext<void>({
    federation,
    data: undefined,
    url: new URL("https://example.com/"),
  });

  // Mock dispatcher similar to collection dispatcher pattern
  const dispatcher: CustomCollectionDispatcher<
    Create,
    string,
    RequestContext<void>,
    void
  > = (
    _ctx: RequestContext<void>,
    values: Record<string, string>,
    cursor: string | null,
  ) => {
    if (values.handle !== "someone") return null;
    const items = [
      new Create({ id: new URL("https://example.com/activities/1") }),
      new Create({ id: new URL("https://example.com/activities/2") }),
      new Create({ id: new URL("https://example.com/activities/3") }),
    ];
    if (cursor != null) {
      const idx = parseInt(cursor);
      return {
        items: [items[idx]],
        nextCursor: idx < items.length - 1 ? (idx + 1).toString() : null,
        prevCursor: idx > 0 ? (idx - 1).toString() : null,
      };
    }
    return { items };
  };

  const counter: CustomCollectionCounter<string, void> = (
    _ctx: RequestContext<void>,
    values: Record<string, string>,
  ) => values.handle === "someone" ? 3 : null;

  const firstCursor: CustomCollectionCursor<
    string,
    RequestContext<void>,
    void
  > = (
    _ctx: RequestContext<void>,
    values: Record<string, string>,
  ) => values.handle === "someone" ? "0" : null;

  const lastCursor: CustomCollectionCursor<
    string,
    RequestContext<void>,
    void
  > = (
    _ctx: RequestContext<void>,
    values: Record<string, string>,
  ) => values.handle === "someone" ? "2" : null;

  const callbacks: CustomCollectionCallbacks<
    Create,
    string,
    RequestContext<void>,
    void
  > = {
    dispatcher,
    counter,
    firstCursor,
    lastCursor,
  };

  let onNotFoundCalled: Request | null = null;
  const onNotFound = (request: Request) => {
    onNotFoundCalled = request;
    return new Response("Not found", { status: 404 });
  };
  let onNotAcceptableCalled: Request | null = null;
  const onNotAcceptable = (request: Request) => {
    onNotAcceptableCalled = request;
    return new Response("Not acceptable", { status: 406 });
  };
  let onUnauthorizedCalled: Request | null = null;
  const onUnauthorized = (request: Request) => {
    onUnauthorizedCalled = request;
    return new Response("Unauthorized", { status: 401 });
  };
  const errorHandlers = {
    onNotFound,
    onNotAcceptable,
    onUnauthorized,
  };

  // Test without callbacks (should return 404)
  let response = await handleCustomCollection(
    context.request,
    {
      context,
      name: "custom collection",
      values: { handle: "someone" },
      ...errorHandlers,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(onNotFoundCalled, context.request);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);

  // Test with HTML Accept header (should return 406)
  onNotFoundCalled = null;
  response = await handleCustomCollection(
    context.request,
    {
      context,
      name: "custom collection",
      values: { handle: "someone" },
      collectionCallbacks: { dispatcher },
      ...errorHandlers,
    },
  );
  assertEquals(response.status, 406);
  assertEquals(onNotFoundCalled, null);
  assertEquals(onNotAcceptableCalled, context.request);
  assertEquals(onUnauthorizedCalled, null);

  // Test with unknown handle (should return 404)
  onNotAcceptableCalled = null;
  context = createRequestContext<void>({
    ...context,
    request: new Request(context.url, {
      headers: {
        Accept: "application/activity+json",
      },
    }),
  });
  response = await handleCustomCollection(
    context.request,
    {
      context,
      name: "custom collection",
      values: { handle: "no-one" },
      collectionCallbacks: { dispatcher },
      ...errorHandlers,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(onNotFoundCalled, context.request);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);

  // Test successful request without pagination
  onNotFoundCalled = null;
  response = await handleCustomCollection(
    context.request,
    {
      context,
      name: "custom collection",
      values: { handle: "someone" },
      collectionCallbacks: { dispatcher },
      ...errorHandlers,
    },
  );
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("Content-Type"),
    "application/activity+json",
  );
  const createCtx = [
    "https://w3id.org/identity/v1",
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/data-integrity/v1",
    {
      toot: "http://joinmastodon.org/ns#",
      misskey: "https://misskey-hub.net/ns#",
      fedibird: "http://fedibird.com/ns#",
      ChatMessage: "http://litepub.social/ns#ChatMessage",
      Emoji: "toot:Emoji",
      Hashtag: "as:Hashtag",
      sensitive: "as:sensitive",
      votersCount: {
        "@id": "toot:votersCount",
        "@type": "http://www.w3.org/2001/XMLSchema#nonNegativeInteger",
      },
      _misskey_quote: "misskey:_misskey_quote",
      quoteUri: "fedibird:quoteUri",
      quoteUrl: "as:quoteUrl",
      emojiReactions: {
        "@id": "fedibird:emojiReactions",
        "@type": "@id",
      },
    },
  ];
  const CONTEXT = [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/data-integrity/v1",
    {
      toot: "http://joinmastodon.org/ns#",
      misskey: "https://misskey-hub.net/ns#",
      fedibird: "http://fedibird.com/ns#",
      ChatMessage: "http://litepub.social/ns#ChatMessage",
      Emoji: "toot:Emoji",
      Hashtag: "as:Hashtag",
      sensitive: "as:sensitive",
      votersCount: "toot:votersCount",
      _misskey_quote: "misskey:_misskey_quote",
      quoteUri: "fedibird:quoteUri",
      quoteUrl: "as:quoteUrl",
      emojiReactions: {
        "@id": "fedibird:emojiReactions",
        "@type": "@id",
      },
    },
  ];
  assertEquals(await response.json(), {
    "@context": CONTEXT,
    id: "https://example.com/",
    type: "Collection",
    items: [
      {
        "@context": createCtx,
        type: "Create",
        id: "https://example.com/activities/1",
      },
      {
        "@context": createCtx,
        type: "Create",
        id: "https://example.com/activities/2",
      },
      {
        "@context": createCtx,
        type: "Create",
        id: "https://example.com/activities/3",
      },
    ],
  });
  assertEquals(onNotFoundCalled, null);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);

  // Test with authorization predicate (should fail without signature)
  response = await handleCustomCollection(
    context.request,
    {
      context,
      name: "custom collection",
      values: { handle: "someone" },
      collectionCallbacks: {
        dispatcher,
        authorizePredicate: (_ctx, _values, key, keyOwner) =>
          key != null && keyOwner != null,
      },
      ...errorHandlers,
    },
  );
  assertEquals(response.status, 401);
  assertEquals(onNotFoundCalled, null);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, context.request);

  // Test with authorization predicate (should succeed with signature)
  onUnauthorizedCalled = null;
  context = createRequestContext<void>({
    ...context,
    getSignedKey: () => Promise.resolve(rsaPublicKey2),
    getSignedKeyOwner: () => Promise.resolve(new Person({})),
  });
  response = await handleCustomCollection(
    context.request,
    {
      context,
      name: "custom collection",
      values: { handle: "someone" },
      collectionCallbacks: {
        dispatcher,
        authorizePredicate: (_ctx, _values, key, keyOwner) =>
          key != null && keyOwner != null,
      },
      ...errorHandlers,
    },
  );
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("Content-Type"),
    "application/activity+json",
  );
  assertEquals(await response.json(), {
    "@context": CONTEXT,
    id: "https://example.com/",
    type: "Collection",
    items: [
      {
        "@context": createCtx,
        type: "Create",
        id: "https://example.com/activities/1",
      },
      {
        "@context": createCtx,
        type: "Create",
        id: "https://example.com/activities/2",
      },
      {
        "@context": createCtx,
        type: "Create",
        id: "https://example.com/activities/3",
      },
    ],
  });
  assertEquals(onNotFoundCalled, null);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);

  // Test with pagination - full collection with pagination info
  response = await handleCustomCollection(
    context.request,
    {
      context,
      name: "custom collection",
      values: { handle: "someone" },
      collectionCallbacks: callbacks,
      ...errorHandlers,
    },
  );
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("Content-Type"),
    "application/activity+json",
  );
  assertEquals(await response.json(), {
    "@context": CONTEXT,
    id: "https://example.com/",
    type: "Collection",
    totalItems: 3,
    first: "https://example.com/?cursor=0",
    last: "https://example.com/?cursor=2",
  });
  assertEquals(onNotFoundCalled, null);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);

  // Test with cursor - collection page
  let url = new URL("https://example.com/?cursor=0");
  context = createRequestContext({
    ...context,
    url,
    request: new Request(url, {
      headers: {
        Accept: "application/activity+json",
      },
    }),
  });
  response = await handleCustomCollection(
    context.request,
    {
      context,
      name: "custom collection",
      values: { handle: "someone" },
      collectionCallbacks: callbacks,
      ...errorHandlers,
    },
  );
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("Content-Type"),
    "application/activity+json",
  );
  assertEquals(await response.json(), {
    "@context": CONTEXT,
    id: "https://example.com/?cursor=0",
    type: "CollectionPage",
    partOf: "https://example.com/",
    next: "https://example.com/?cursor=1",
    items: {
      "@context": createCtx,
      id: "https://example.com/activities/1",
      type: "Create",
    },
  });
  assertEquals(onNotFoundCalled, null);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);

  // Test with cursor - last page
  url = new URL("https://example.com/?cursor=2");
  context = createRequestContext({
    ...context,
    url,
    request: new Request(url, {
      headers: {
        Accept: "application/activity+json",
      },
    }),
  });
  response = await handleCustomCollection(
    context.request,
    {
      context,
      name: "custom collection",
      values: { handle: "someone" },
      collectionCallbacks: callbacks,
      ...errorHandlers,
    },
  );
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("Content-Type"),
    "application/activity+json",
  );
  assertEquals(await response.json(), {
    "@context": CONTEXT,
    id: "https://example.com/?cursor=2",
    type: "CollectionPage",
    partOf: "https://example.com/",
    prev: "https://example.com/?cursor=1",
    items: {
      "@context": createCtx,
      id: "https://example.com/activities/3",
      type: "Create",
    },
  });
  assertEquals(onNotFoundCalled, null);
  assertEquals(onNotAcceptableCalled, null);
  assertEquals(onUnauthorizedCalled, null);
});
