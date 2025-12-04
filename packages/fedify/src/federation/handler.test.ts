import { assert, assertEquals, assertFalse } from "@std/assert";
import { signRequest } from "../sig/http.ts";
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
import { createTestTracerProvider } from "../testing/otel.ts";
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

test("handleInbox() records OpenTelemetry span events", async () => {
  const [tracerProvider, exporter] = createTestTracerProvider();
  const kv = new MemoryKvStore();
  const federation = createFederation<void>({ kv, tracerProvider });

  const activity = new Create({
    id: new URL("https://example.com/activity"),
    actor: new URL("https://example.com/users/someone"),
    object: new Note({
      id: new URL("https://example.com/note"),
      content: "Hello, world!",
    }),
  });

  const request = new Request("https://example.com/users/someone/inbox", {
    method: "POST",
    headers: {
      "Content-Type": "application/activity+json",
    },
    body: JSON.stringify(await activity.toJsonLd()),
  });

  const signed = await signRequest(
    request,
    rsaPrivateKey3,
    new URL("https://example.com/users/someone#main-key"),
  );

  const context = createRequestContext<void>({
    federation,
    request: signed,
    url: new URL(signed.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
    getActorUri(identifier: string) {
      return new URL(`https://example.com/users/${identifier}`);
    },
  });

  const actorDispatcher: ActorDispatcher<void> = (ctx, handle) => {
    if (handle !== "someone") return null;
    return new Person({
      id: ctx.getActorUri(handle),
      name: "Someone",
      inbox: new URL("https://example.com/users/someone/inbox"),
      publicKey: rsaPublicKey2,
    });
  };

  const listeners = new InboxListenerSet<void>();
  let receivedActivity: Activity | null = null;
  listeners.add(Create, (_ctx, activity) => {
    receivedActivity = activity;
  });

  const response = await handleInbox(signed, {
    recipient: "someone",
    context,
    inboxContextFactory(_activity) {
      return createInboxContext({ ...context, clone: undefined });
    },
    kv,
    kvPrefixes: {
      activityIdempotence: ["activityIdempotence"],
      publicKey: ["publicKey"],
    },
    actorDispatcher,
    inboxListeners: listeners,
    inboxErrorHandler: undefined,
    onNotFound: (_request) => new Response("Not found", { status: 404 }),
    signatureTimeWindow: false,
    skipSignatureVerification: true,
    tracerProvider,
  });

  assertEquals(response.status, 202);
  assert(receivedActivity != null);

  // Check that the span was recorded
  const spans = exporter.getSpans("activitypub.inbox");
  assertEquals(spans.length, 1);
  const span = spans[0];

  // Check span attributes
  assertEquals(span.attributes["fedify.inbox.recipient"], "someone");
  assertEquals(
    span.attributes["activitypub.activity.id"],
    "https://example.com/activity",
  );

  // Check that the activity.received event was recorded
  const events = exporter.getEvents(
    "activitypub.inbox",
    "activitypub.activity.received",
  );
  assertEquals(events.length, 1);
  const event = events[0];

  // Verify event attributes
  assert(event.attributes != null);
  assertEquals(event.attributes["activitypub.activity.verified"], true);
  assertEquals(event.attributes["http_signatures.verified"], false);
  assert(typeof event.attributes["activitypub.activity.json"] === "string");

  // Verify the JSON contains the activity
  const recordedActivity = JSON.parse(
    event.attributes["activitypub.activity.json"] as string,
  );
  assertEquals(recordedActivity.id, "https://example.com/activity");
  assertEquals(recordedActivity.type, "Create");
});
