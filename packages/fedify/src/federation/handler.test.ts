import {
  createTestTracerProvider,
  mockDocumentLoader,
  test,
} from "@fedify/fixture";
import {
  Activity,
  Create,
  Note,
  type Object,
  Person,
  Tombstone,
} from "@fedify/vocab";
import { FetchError } from "@fedify/vocab-runtime";
import { assert, assertEquals, assertInstanceOf } from "@std/assert";
import { parseAcceptSignature } from "../sig/accept.ts";
import { signRequest } from "../sig/http.ts";
import {
  createInboxContext,
  createOutboxContext,
  createRequestContext,
} from "../testing/context.ts";
import {
  rsaPrivateKey3,
  rsaPublicKey2,
  rsaPublicKey3,
} from "../testing/keys.ts";
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
import type { InboxContext, OutboxContext, RequestContext } from "./context.ts";
import type { ConstructorWithTypeId } from "./federation.ts";
import {
  type CustomCollectionCallbacks,
  handleActor,
  handleCollection,
  handleCustomCollection,
  handleInbox,
  handleObject,
  handleOutbox,
  respondWithObject,
  respondWithObjectIfAcceptable,
} from "./handler.ts";
import { ActivityListenerSet } from "./activity-listener.ts";
import { MemoryKvStore } from "./kv.ts";
import { createFederation } from "./middleware.ts";

const QUOTE_CONTEXT_TERMS = {
  QuoteAuthorization: "https://w3id.org/fep/044f#QuoteAuthorization",
  quote: {
    "@id": "https://w3id.org/fep/044f#quote",
    "@type": "@id",
  },
  quoteAuthorization: {
    "@id": "https://w3id.org/fep/044f#quoteAuthorization",
    "@type": "@id",
  },
} as const;

const WRAPPER_QUOTE_CONTEXT_TERMS = {
  ...QUOTE_CONTEXT_TERMS,
  QuoteRequest: "https://w3id.org/fep/044f#QuoteRequest",
} as const;

test("handleActor()", async () => {
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  const deletedAt = Temporal.Instant.from("2024-01-15T00:00:00Z");
  let context = createRequestContext<void>({
    federation,
    data: undefined,
    url: new URL("https://example.com/"),
    getActorUri(identifier: string) {
      return new URL(`https://example.com/users/${identifier}`);
    },
  });
  const actorDispatcher: ActorDispatcher<void> = (ctx, identifier) => {
    if (identifier !== "someone") return null;
    return new Person({
      id: ctx.getActorUri(identifier),
      name: "Someone",
    });
  };
  const tombstoneDispatcher: ActorDispatcher<void> = (ctx, identifier) => {
    if (identifier !== "gone") return null;
    return new Tombstone({
      id: ctx.getActorUri(identifier),
      formerType: Person,
      deleted: deletedAt,
    });
  };
  let onNotFoundCalled: Request | null = null;
  const onNotFound = (request: Request) => {
    onNotFoundCalled = request;
    return new Response("Not found", { status: 404 });
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
      onUnauthorized,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(onNotFoundCalled, context.request);
  assertEquals(onUnauthorizedCalled, null);

  onNotFoundCalled = null;
  response = await handleActor(
    context.request,
    {
      context,
      identifier: "no-one",
      actorDispatcher,
      onNotFound,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(onNotFoundCalled, context.request);
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
      "https://gotosocial.org/ns",
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
  assertEquals(onUnauthorizedCalled, null);

  response = await handleActor(
    context.request,
    {
      context,
      identifier: "no-one",
      actorDispatcher,
      onNotFound,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(onNotFoundCalled, context.request);
  assertEquals(onUnauthorizedCalled, null);

  onNotFoundCalled = null;
  response = await handleActor(
    context.request,
    {
      context,
      identifier: "someone",
      actorDispatcher,
      authorizePredicate: async (ctx, _handle) =>
        await ctx.getSignedKey() != null &&
        await ctx.getSignedKeyOwner() != null,
      onNotFound,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 401);
  assertEquals(onNotFoundCalled, null);
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
      authorizePredicate: async (ctx, _handle) =>
        await ctx.getSignedKey() != null &&
        await ctx.getSignedKeyOwner() != null,
      onNotFound,
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
      "https://gotosocial.org/ns",
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
  assertEquals(onUnauthorizedCalled, null);

  onNotFoundCalled = null;
  response = await handleActor(
    context.request,
    {
      context,
      identifier: "gone",
      actorDispatcher: tombstoneDispatcher,
      authorizePredicate: () => false,
      onNotFound,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 401);
  assertEquals(onNotFoundCalled, null);
  assertEquals(onUnauthorizedCalled, context.request);

  onUnauthorizedCalled = null;
  response = await handleActor(
    context.request,
    {
      context,
      identifier: "gone",
      actorDispatcher: tombstoneDispatcher,
      authorizePredicate: () => true,
      onNotFound,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 410);
  assertEquals(
    response.headers.get("Content-Type"),
    "application/activity+json",
  );
  assertEquals(response.headers.get("Vary"), "Accept");
  assertEquals(await response.json(), {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
      "https://gotosocial.org/ns",
    ],
    id: "https://example.com/users/gone",
    type: "Tombstone",
    formerType: "as:Person",
    deleted: "2024-01-15T00:00:00Z",
  });
  assertEquals(onNotFoundCalled, null);
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
        `https://example.com/users/${values.identifier}/notes/${values.id}`,
      );
    },
  });
  const objectDispatcher: ObjectDispatcher<void, Object, string> = (
    ctx,
    values,
  ) => {
    if (values.identifier !== "someone" || values.id !== "123") return null;
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
  let onUnauthorizedCalled: Request | null = null;
  const onUnauthorized = (request: Request) => {
    onUnauthorizedCalled = request;
    return new Response("Unauthorized", { status: 401 });
  };
  let response = await handleObject(
    context.request,
    {
      context,
      values: { identifier: "someone", id: "123" },
      onNotFound,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(onNotFoundCalled, context.request);
  assertEquals(onUnauthorizedCalled, null);

  onNotFoundCalled = null;
  response = await handleObject(
    context.request,
    {
      context,
      values: { identifier: "someone", id: "123" },
      objectDispatcher,
      onNotFound,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 200);
  assertEquals(onNotFoundCalled, null);
  assertEquals(onUnauthorizedCalled, null);

  response = await handleObject(
    context.request,
    {
      context,
      values: { identifier: "no-one", id: "123" },
      objectDispatcher,
      onNotFound,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(onNotFoundCalled, context.request);
  assertEquals(onUnauthorizedCalled, null);

  onNotFoundCalled = null;
  response = await handleObject(
    context.request,
    {
      context,
      values: { identifier: "someone", id: "not-exist" },
      objectDispatcher,
      onNotFound,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(onNotFoundCalled, context.request);
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
      values: { identifier: "someone", id: "123" },
      objectDispatcher,
      onNotFound,
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
      "https://gotosocial.org/ns",
      {
        Emoji: "toot:Emoji",
        Hashtag: "as:Hashtag",
        sensitive: "as:sensitive",
        toot: "http://joinmastodon.org/ns#",
        _misskey_quote: "misskey:_misskey_quote",
        fedibird: "http://fedibird.com/ns#",
        misskey: "https://misskey-hub.net/ns#",
        ...QUOTE_CONTEXT_TERMS,
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
  assertEquals(onUnauthorizedCalled, null);

  response = await handleObject(
    context.request,
    {
      context,
      values: { identifier: "no-one", id: "123" },
      objectDispatcher,
      onNotFound,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(onNotFoundCalled, context.request);
  assertEquals(onUnauthorizedCalled, null);

  onNotFoundCalled = null;
  response = await handleObject(
    context.request,
    {
      context,
      values: { identifier: "someone", id: "not-exist" },
      objectDispatcher,
      onNotFound,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(onNotFoundCalled, context.request);
  assertEquals(onUnauthorizedCalled, null);

  onNotFoundCalled = null;
  response = await handleObject(
    context.request,
    {
      context,
      values: { identifier: "someone", id: "123" },
      objectDispatcher,
      authorizePredicate: async (ctx, _values) =>
        await ctx.getSignedKey() != null &&
        await ctx.getSignedKeyOwner() != null,
      onNotFound,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 401);
  assertEquals(onNotFoundCalled, null);
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
      values: { identifier: "someone", id: "123" },
      objectDispatcher,
      authorizePredicate: async (ctx, _values) =>
        await ctx.getSignedKey() != null &&
        await ctx.getSignedKeyOwner() != null,
      onNotFound,
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
      "https://gotosocial.org/ns",
      {
        Emoji: "toot:Emoji",
        Hashtag: "as:Hashtag",
        sensitive: "as:sensitive",
        toot: "http://joinmastodon.org/ns#",
        _misskey_quote: "misskey:_misskey_quote",
        fedibird: "http://fedibird.com/ns#",
        misskey: "https://misskey-hub.net/ns#",
        ...QUOTE_CONTEXT_TERMS,
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
    identifier,
    cursor,
  ) => {
    if (identifier !== "someone") return null;
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
  const counter: CollectionCounter<void, void> = (_ctx, identifier) =>
    identifier === "someone" ? 3 : null;
  const firstCursor: CollectionCursor<RequestContext<void>, void, void> = (
    _ctx,
    identifier,
  ) => identifier === "someone" ? "0" : null;
  const lastCursor: CollectionCursor<RequestContext<void>, void, void> = (
    _ctx,
    identifier,
  ) => identifier === "someone" ? "2" : null;
  let onNotFoundCalled: Request | null = null;
  const onNotFound = (request: Request) => {
    onNotFoundCalled = request;
    return new Response("Not found", { status: 404 });
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
      onUnauthorized,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(onNotFoundCalled, context.request);
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
      onUnauthorized,
    },
  );
  assertEquals(response.status, 200);
  assertEquals(onNotFoundCalled, null);
  assertEquals(onUnauthorizedCalled, null);

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
      onUnauthorized,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(onNotFoundCalled, context.request);
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
      onUnauthorized,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(onNotFoundCalled, context.request);
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
    "https://gotosocial.org/ns",
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
      ...WRAPPER_QUOTE_CONTEXT_TERMS,
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
      "https://gotosocial.org/ns",
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
        ...WRAPPER_QUOTE_CONTEXT_TERMS,
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
        authorizePredicate: async (ctx, _handle) =>
          await ctx.getSignedKey() != null &&
          await ctx.getSignedKeyOwner() != null,
      },
      onNotFound,
      onUnauthorized,
    },
  );
  assertEquals(response.status, 401);
  assertEquals(onNotFoundCalled, null);
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
        authorizePredicate: async (ctx, _handle) =>
          await ctx.getSignedKey() != null &&
          await ctx.getSignedKeyOwner() != null,
      },
      onNotFound,
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
      "https://gotosocial.org/ns",
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
        ...WRAPPER_QUOTE_CONTEXT_TERMS,
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
      "https://gotosocial.org/ns",
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
        ...WRAPPER_QUOTE_CONTEXT_TERMS,
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
      "https://gotosocial.org/ns",
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
        ...WRAPPER_QUOTE_CONTEXT_TERMS,
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
      "https://gotosocial.org/ns",
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
        ...WRAPPER_QUOTE_CONTEXT_TERMS,
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
      acceptSignatureNonce: ["_fedify", "acceptSignatureNonce"],
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

test("handleOutbox()", async () => {
  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/someone"),
    object: new Note({
      id: new URL("https://example.com/notes/1"),
      attribution: new URL("https://example.com/users/someone"),
      content: "Hello, world!",
    }),
  });
  const requestUrl = "https://example.com/users/someone/outbox";
  const requestBody = JSON.stringify(await activity.toJsonLd());
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  const createRequestContextPair = (body = requestBody) => {
    const request = new Request(requestUrl, {
      method: "POST",
      body,
    });
    const context = createRequestContext({
      federation,
      request,
      url: new URL(request.url),
      data: undefined,
      getActorUri(identifier: string) {
        return new URL(`https://example.com/users/${identifier}`);
      },
    });
    return { request, context };
  };
  let onNotFoundCalled: Request | null = null;
  const onNotFound = (request: Request) => {
    onNotFoundCalled = request;
    return new Response("Not found", { status: 404 });
  };
  let onUnauthorizedCalled: Request | null = null;
  const onUnauthorized = (request: Request) => {
    onUnauthorizedCalled = request;
    return new Response("Unauthorized", { status: 401 });
  };
  const actorDispatcher: ActorDispatcher<void> = (ctx, identifier) => {
    if (identifier !== "someone") return null;
    return new Person({ id: ctx.getActorUri(identifier), name: "Someone" });
  };
  const listeners = new ActivityListenerSet<OutboxContext<void>>();
  const seen: string[] = [];
  listeners.add(Activity, (ctx, activity) => {
    seen.push(`${ctx.identifier}:${activity.id?.href}`);
  });

  let { request, context } = createRequestContextPair();
  let response = await handleOutbox(request, {
    identifier: "someone",
    context,
    outboxContextFactory(identifier) {
      return createOutboxContext({
        ...context,
        clone: undefined,
        identifier,
      });
    },
    actorDispatcher: undefined,
    outboxListeners: listeners,
    onNotFound,
    onUnauthorized,
  });
  assertEquals(onNotFoundCalled, request);
  assertEquals(response.status, 404);

  onNotFoundCalled = null;
  ({ request, context } = createRequestContextPair());
  response = await handleOutbox(request, {
    identifier: "nobody",
    context,
    outboxContextFactory(identifier) {
      return createOutboxContext({
        ...context,
        clone: undefined,
        identifier,
      });
    },
    actorDispatcher,
    outboxListeners: listeners,
    onNotFound,
    onUnauthorized,
  });
  assertEquals(onNotFoundCalled, request);
  assertEquals(response.status, 404);

  onNotFoundCalled = null;
  ({ request, context } = createRequestContextPair());
  response = await handleOutbox(request, {
    identifier: "someone",
    context,
    outboxContextFactory(identifier) {
      return createOutboxContext({
        ...context,
        clone: undefined,
        identifier,
      });
    },
    actorDispatcher,
    outboxListeners: listeners,
    authorizePredicate: () => false,
    onNotFound,
    onUnauthorized,
  });
  assertEquals(onNotFoundCalled, null);
  assertInstanceOf(onUnauthorizedCalled, Request);
  assertEquals(onUnauthorizedCalled === request, false);
  assertEquals(response.status, 401);
  assertEquals(seen, []);

  onUnauthorizedCalled = null;
  ({ request, context } = createRequestContextPair());
  response = await handleOutbox(request, {
    identifier: "someone",
    context,
    outboxContextFactory(identifier) {
      return createOutboxContext({
        ...context,
        clone: undefined,
        identifier,
      });
    },
    actorDispatcher,
    outboxListeners: listeners,
    authorizePredicate: () => true,
    onNotFound,
    onUnauthorized,
  });
  assertEquals(onUnauthorizedCalled, null);
  assertEquals([response.status, await response.text()], [202, ""]);
  assertEquals(seen, [
    `someone:${activity.id?.href}`,
  ]);

  onUnauthorizedCalled = null;
  ({ request, context } = createRequestContextPair());
  response = await handleOutbox(request, {
    identifier: "someone",
    context,
    outboxContextFactory(identifier) {
      return createOutboxContext({
        ...context,
        clone: undefined,
        identifier,
      });
    },
    actorDispatcher,
    outboxListeners: listeners,
    authorizePredicate: async (ctx) => {
      await ctx.request.json();
      return true;
    },
    onNotFound,
    onUnauthorized,
  });
  assertEquals(onUnauthorizedCalled, null);
  assertEquals([response.status, await response.text()], [202, ""]);

  onUnauthorizedCalled = null;
  ({ request, context } = createRequestContextPair());
  let unauthorizedBody: string | null = null;
  response = await handleOutbox(request, {
    identifier: "someone",
    context,
    outboxContextFactory(identifier) {
      return createOutboxContext({
        ...context,
        clone: undefined,
        identifier,
      });
    },
    actorDispatcher,
    outboxListeners: listeners,
    authorizePredicate: async (ctx) => {
      await ctx.request.json();
      return false;
    },
    onNotFound,
    onUnauthorized: async (request) => {
      onUnauthorizedCalled = request;
      unauthorizedBody = await request.text();
      return new Response("Unauthorized", { status: 401 });
    },
  });
  assertInstanceOf(onUnauthorizedCalled, Request);
  assertEquals((unauthorizedBody ?? "").includes('"type":"Create"'), true);
  assertEquals([response.status, await response.text()], [401, "Unauthorized"]);

  const invalidRequest = new Request(
    "https://example.com/users/someone/outbox",
    {
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
    },
  );
  const invalidContext = createRequestContext({
    federation,
    request: invalidRequest,
    url: new URL(invalidRequest.url),
    data: undefined,
    getActorUri(identifier: string) {
      return new URL(`https://example.com/users/${identifier}`);
    },
  });
  let invalidActivityId: string | undefined;
  let invalidActivityType: string | undefined;
  response = await handleOutbox(invalidRequest, {
    identifier: "someone",
    context: invalidContext,
    outboxContextFactory(identifier, _json, activityId, activityType) {
      invalidActivityId = activityId;
      invalidActivityType = activityType;
      return createOutboxContext({
        ...invalidContext,
        clone: undefined,
        identifier,
      });
    },
    actorDispatcher,
    outboxListeners: listeners,
    onNotFound,
    onUnauthorized,
  });
  assertEquals(response.status, 400);
  assertEquals(invalidActivityId, undefined);
  assertEquals(invalidActivityType, "Create");

  const mismatchedActorJson = (await activity.toJsonLd()) as Record<
    string,
    unknown
  >;

  const missingActorRequest = new Request(
    "https://example.com/users/someone/outbox",
    {
      method: "POST",
      body: JSON.stringify({
        ...mismatchedActorJson,
        actor: undefined,
      }),
    },
  );
  const missingActorContext = createRequestContext({
    federation,
    request: missingActorRequest,
    url: new URL(missingActorRequest.url),
    data: undefined,
    getActorUri(identifier: string) {
      return new URL(`https://example.com/users/${identifier}`);
    },
  });
  let missingActorErrorMessage: string | null = null;
  response = await handleOutbox(missingActorRequest, {
    identifier: "someone",
    context: missingActorContext,
    outboxContextFactory(identifier) {
      return createOutboxContext({
        ...missingActorContext,
        clone: undefined,
        identifier,
      });
    },
    actorDispatcher,
    outboxListeners: listeners,
    outboxErrorHandler: (_ctx, error) => {
      missingActorErrorMessage = error.message;
    },
    onNotFound,
    onUnauthorized,
  });
  assertEquals(
    [response.status, await response.text()],
    [400, "The posted activity has no actor."],
  );
  assertEquals(missingActorErrorMessage, "The posted activity has no actor.");
  const mismatchedActorRequest = new Request(
    "https://example.com/users/someone/outbox",
    {
      method: "POST",
      body: JSON.stringify({
        ...mismatchedActorJson,
        actor: "https://example.com/users/somebody-else",
      }),
    },
  );
  const mismatchedActorContext = createRequestContext({
    federation,
    request: mismatchedActorRequest,
    url: new URL(mismatchedActorRequest.url),
    data: undefined,
    getActorUri(identifier: string) {
      return new URL(`https://example.com/users/${identifier}`);
    },
  });
  let mismatchedActorErrorMessage: string | null = null;
  response = await handleOutbox(mismatchedActorRequest, {
    identifier: "someone",
    context: mismatchedActorContext,
    outboxContextFactory(identifier) {
      return createOutboxContext({
        ...mismatchedActorContext,
        clone: undefined,
        identifier,
      });
    },
    actorDispatcher,
    outboxListeners: listeners,
    outboxErrorHandler: (_ctx, error) => {
      mismatchedActorErrorMessage = error.message;
    },
    onNotFound,
    onUnauthorized,
  });
  assertEquals(
    [response.status, await response.text()],
    [400, "The activity actor does not match the outbox owner."],
  );
  assertEquals(
    mismatchedActorErrorMessage,
    "The activity actor does not match the outbox owner.",
  );

  const throwingListeners = new ActivityListenerSet<OutboxContext<void>>();
  let onErrorCalled = false;
  throwingListeners.add(Create, () => {
    throw new Error("Boom");
  });
  ({ request, context } = createRequestContextPair());
  response = await handleOutbox(request, {
    identifier: "someone",
    context,
    outboxContextFactory(identifier) {
      return createOutboxContext({
        ...context,
        clone: undefined,
        identifier,
      });
    },
    actorDispatcher,
    outboxListeners: throwingListeners,
    outboxErrorHandler: (_ctx, _error) => {
      onErrorCalled = true;
    },
    onNotFound,
    onUnauthorized,
  });
  assertEquals(response.status, 500);
  assertEquals(onErrorCalled, true);
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
      "https://gotosocial.org/ns",
      {
        Emoji: "toot:Emoji",
        Hashtag: "as:Hashtag",
        sensitive: "as:sensitive",
        toot: "http://joinmastodon.org/ns#",
        _misskey_quote: "misskey:_misskey_quote",
        fedibird: "http://fedibird.com/ns#",
        misskey: "https://misskey-hub.net/ns#",
        ...QUOTE_CONTEXT_TERMS,
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
  const inboxListeners = new ActivityListenerSet<InboxContext<void>>();
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
      acceptSignatureNonce: ["_fedify", "acceptSignatureNonce"],
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
      "https://gotosocial.org/ns",
      {
        Emoji: "toot:Emoji",
        Hashtag: "as:Hashtag",
        sensitive: "as:sensitive",
        toot: "http://joinmastodon.org/ns#",
        _misskey_quote: "misskey:_misskey_quote",
        fedibird: "http://fedibird.com/ns#",
        misskey: "https://misskey-hub.net/ns#",
        ...QUOTE_CONTEXT_TERMS,
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
    if (values.identifier !== "someone") return null;
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
  ) => values.identifier === "someone" ? 3 : null;

  const firstCursor: CustomCollectionCursor<
    string,
    RequestContext<void>,
    void
  > = (
    _ctx: RequestContext<void>,
    values: Record<string, string>,
  ) => values.identifier === "someone" ? "0" : null;

  const lastCursor: CustomCollectionCursor<
    string,
    RequestContext<void>,
    void
  > = (
    _ctx: RequestContext<void>,
    values: Record<string, string>,
  ) => values.identifier === "someone" ? "2" : null;

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
  let onUnauthorizedCalled: Request | null = null;
  const onUnauthorized = (request: Request) => {
    onUnauthorizedCalled = request;
    return new Response("Unauthorized", { status: 401 });
  };
  const errorHandlers = {
    onNotFound,
    onUnauthorized,
  };

  // Test without callbacks (should return 404)
  let response = await handleCustomCollection(
    context.request,
    {
      context,
      name: "custom collection",
      values: { identifier: "someone" },
      ...errorHandlers,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(onNotFoundCalled, context.request);
  assertEquals(onUnauthorizedCalled, null);

  // Test with unknown identifier (should return 404)
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
      values: { identifier: "no-one" },
      collectionCallbacks: { dispatcher },
      ...errorHandlers,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(onNotFoundCalled, context.request);
  assertEquals(onUnauthorizedCalled, null);

  // Test successful request without pagination
  onNotFoundCalled = null;
  response = await handleCustomCollection(
    context.request,
    {
      context,
      name: "custom collection",
      values: { identifier: "someone" },
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
    "https://gotosocial.org/ns",
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
      ...WRAPPER_QUOTE_CONTEXT_TERMS,
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
    "https://gotosocial.org/ns",
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
      ...WRAPPER_QUOTE_CONTEXT_TERMS,
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
  assertEquals(onUnauthorizedCalled, null);

  // Test with authorization predicate (should fail without signature)
  response = await handleCustomCollection(
    context.request,
    {
      context,
      name: "custom collection",
      values: { identifier: "someone" },
      collectionCallbacks: {
        dispatcher,
        authorizePredicate: async (ctx, _values) =>
          await ctx.getSignedKey() != null &&
          await ctx.getSignedKeyOwner() != null,
      },
      ...errorHandlers,
    },
  );
  assertEquals(response.status, 401);
  assertEquals(onNotFoundCalled, null);
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
      values: { identifier: "someone" },
      collectionCallbacks: {
        dispatcher,
        authorizePredicate: async (ctx, _values) =>
          await ctx.getSignedKey() != null &&
          await ctx.getSignedKeyOwner() != null,
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
  assertEquals(onUnauthorizedCalled, null);

  // Test with pagination - full collection with pagination info
  response = await handleCustomCollection(
    context.request,
    {
      context,
      name: "custom collection",
      values: { identifier: "someone" },
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
      values: { identifier: "someone" },
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
      values: { identifier: "someone" },
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

  const actorDispatcher: ActorDispatcher<void> = (ctx, identifier) => {
    if (identifier !== "someone") return null;
    return new Person({
      id: ctx.getActorUri(identifier),
      name: "Someone",
      inbox: new URL("https://example.com/users/someone/inbox"),
      publicKey: rsaPublicKey2,
    });
  };

  const listeners = new ActivityListenerSet<InboxContext<void>>();
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
      acceptSignatureNonce: ["acceptSignatureNonce"],
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
  assertEquals(event.attributes["activitypub.activity.verified"], false);
  assertEquals(event.attributes["http_signatures.verified"], false);
  assert(typeof event.attributes["activitypub.activity.json"] === "string");

  // Verify the JSON contains the activity
  const recordedActivity = JSON.parse(
    event.attributes["activitypub.activity.json"] as string,
  );
  assertEquals(recordedActivity.id, "https://example.com/activity");
  assertEquals(recordedActivity.type, "Create");
});

test("handleInbox() records unverified HTTP signature details", async () => {
  const [tracerProvider, exporter] = createTestTracerProvider();
  const kv = new MemoryKvStore();
  const federation = createFederation<void>({ kv, tracerProvider });
  const keyId = new URL("https://gone.example/users/someone#main-key");

  const activity = new Create({
    id: new URL("https://example.com/activity"),
    actor: new URL("https://gone.example/users/someone"),
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
  const signed = await signRequest(request, rsaPrivateKey3, keyId);

  const documentLoader = (url: string) => {
    if (url === keyId.href) {
      throw new FetchError(
        keyId,
        `HTTP 410: ${keyId.href}`,
        new Response(null, { status: 410 }),
      );
    }
    return mockDocumentLoader(url);
  };

  const context = createRequestContext<void>({
    federation,
    request: signed,
    url: new URL(signed.url),
    data: undefined,
    documentLoader,
    contextLoader: mockDocumentLoader,
    getActorUri(identifier: string) {
      return new URL(`https://example.com/users/${identifier}`);
    },
  });

  const actorDispatcher: ActorDispatcher<void> = (ctx, identifier) => {
    if (identifier !== "someone") return null;
    return new Person({
      id: ctx.getActorUri(identifier),
      name: "Someone",
      inbox: new URL("https://example.com/users/someone/inbox"),
      publicKey: rsaPublicKey2,
    });
  };

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
      acceptSignatureNonce: ["acceptSignatureNonce"],
    },
    actorDispatcher,
    inboxListeners: new ActivityListenerSet<InboxContext<void>>(),
    inboxErrorHandler: undefined,
    unverifiedActivityHandler() {
      return new Response("", { status: 202 });
    },
    onNotFound: (_request) => new Response("Not found", { status: 404 }),
    signatureTimeWindow: false,
    skipSignatureVerification: false,
    tracerProvider,
  });

  assertEquals(response.status, 202);

  const verifySpans = exporter.getSpans("http_signatures.verify");
  assertEquals(verifySpans.length, 1);
  assertEquals(
    verifySpans[0].attributes["http_signatures.failure_reason"],
    "keyFetchError",
  );
  assertEquals(
    verifySpans[0].attributes["http_signatures.key_fetch_status"],
    410,
  );

  const events = exporter.getEvents(
    "activitypub.inbox",
    "activitypub.activity.received",
  );
  assertEquals(events.length, 1);
  const event = events[0];
  assert(event.attributes != null);
  assertEquals(
    event.attributes["http_signatures.failure_reason"],
    "keyFetchError",
  );
  assertEquals(event.attributes["http_signatures.key_fetch_status"], 410);
});

test("handleInbox() challenge policy enabled + unsigned request", async () => {
  const activity = new Create({
    id: new URL("https://example.com/activities/challenge-1"),
    actor: new URL("https://example.com/person2"),
    object: new Note({
      id: new URL("https://example.com/notes/challenge-1"),
      attribution: new URL("https://example.com/person2"),
      content: "Hello!",
    }),
  });
  const unsignedRequest = new Request("https://example.com/", {
    method: "POST",
    body: JSON.stringify(await activity.toJsonLd()),
  });
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  const context = createRequestContext({
    federation,
    request: unsignedRequest,
    url: new URL(unsignedRequest.url),
    data: undefined,
  });
  const actorDispatcher: ActorDispatcher<void> = (_ctx, identifier) => {
    if (identifier !== "someone") return null;
    return new Person({ name: "Someone" });
  };
  const kv = new MemoryKvStore();
  const response = await handleInbox(unsignedRequest, {
    recipient: "someone",
    context,
    inboxContextFactory(_activity) {
      return createInboxContext({
        ...context,
        clone: undefined,
        recipient: "someone",
      });
    },
    kv,
    kvPrefixes: {
      activityIdempotence: ["_fedify", "activityIdempotence"],
      publicKey: ["_fedify", "publicKey"],
      acceptSignatureNonce: ["_fedify", "acceptSignatureNonce"],
    },
    actorDispatcher,
    onNotFound: () => new Response("Not found", { status: 404 }),
    signatureTimeWindow: { minutes: 5 },
    skipSignatureVerification: false,
    inboxChallengePolicy: { enabled: true },
  });
  assertEquals(response.status, 401);
  const acceptSig = response.headers.get("Accept-Signature");
  assert(acceptSig != null, "Accept-Signature header must be present");
  const parsed = parseAcceptSignature(acceptSig);
  assert(parsed.length > 0, "Accept-Signature must have at least one entry");
  assertEquals(parsed[0].label, "sig1");
  assert(
    parsed[0].components.some((c) => c.value === "@method"),
    "Must include @method component",
  );
  assertEquals(
    response.headers.get("Cache-Control"),
    "no-store",
  );
  assertEquals(
    response.headers.get("Vary"),
    "Accept, Signature",
  );
});

test("handleInbox() challenge policy enabled + invalid signature", async () => {
  const activity = new Create({
    id: new URL("https://example.com/activities/challenge-2"),
    actor: new URL("https://example.com/person2"),
    object: new Note({
      id: new URL("https://example.com/notes/challenge-2"),
      attribution: new URL("https://example.com/person2"),
      content: "Hello!",
    }),
  });
  // Sign with a key, then tamper with the body to invalidate the signature
  const originalRequest = new Request("https://example.com/", {
    method: "POST",
    body: JSON.stringify(await activity.toJsonLd()),
  });
  const signedRequest = await signRequest(
    originalRequest,
    rsaPrivateKey3,
    rsaPublicKey3.id!,
  );
  // Reconstruct with a different body but same signature headers
  const jsonLd = await activity.toJsonLd() as Record<string, unknown>;
  const tamperedBody = JSON.stringify({
    ...jsonLd,
    "https://example.com/tampered": true,
  });
  const tamperedRequest = new Request(signedRequest.url, {
    method: signedRequest.method,
    headers: signedRequest.headers,
    body: tamperedBody,
  });
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  const context = createRequestContext({
    federation,
    request: tamperedRequest,
    url: new URL(tamperedRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
  });
  const actorDispatcher: ActorDispatcher<void> = (_ctx, identifier) => {
    if (identifier !== "someone") return null;
    return new Person({ name: "Someone" });
  };
  const kv = new MemoryKvStore();
  const response = await handleInbox(tamperedRequest, {
    recipient: "someone",
    context,
    inboxContextFactory(_activity) {
      return createInboxContext({
        ...context,
        clone: undefined,
        recipient: "someone",
      });
    },
    kv,
    kvPrefixes: {
      activityIdempotence: ["_fedify", "activityIdempotence"],
      publicKey: ["_fedify", "publicKey"],
      acceptSignatureNonce: ["_fedify", "acceptSignatureNonce"],
    },
    actorDispatcher,
    onNotFound: () => new Response("Not found", { status: 404 }),
    signatureTimeWindow: { minutes: 5 },
    skipSignatureVerification: false,
    inboxChallengePolicy: { enabled: true },
  });
  assertEquals(response.status, 401);
  const acceptSig = response.headers.get("Accept-Signature");
  assert(acceptSig != null, "Accept-Signature header must be present");
  assertEquals(response.headers.get("Cache-Control"), "no-store");
});

test("handleInbox() challenge policy enabled + valid signature", async () => {
  const activity = new Create({
    id: new URL("https://example.com/activities/challenge-3"),
    actor: new URL("https://example.com/person2"),
    object: new Note({
      id: new URL("https://example.com/notes/challenge-3"),
      attribution: new URL("https://example.com/person2"),
      content: "Hello!",
    }),
  });
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  const signedRequest = await signRequest(
    new Request("https://example.com/", {
      method: "POST",
      body: JSON.stringify(await activity.toJsonLd()),
    }),
    rsaPrivateKey3,
    rsaPublicKey3.id!,
  );
  const context = createRequestContext({
    federation,
    request: signedRequest,
    url: new URL(signedRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
  });
  const actorDispatcher: ActorDispatcher<void> = (_ctx, identifier) => {
    if (identifier !== "someone") return null;
    return new Person({ name: "Someone" });
  };
  const kv = new MemoryKvStore();
  const response = await handleInbox(signedRequest, {
    recipient: "someone",
    context,
    inboxContextFactory(_activity) {
      return createInboxContext({
        ...context,
        clone: undefined,
        recipient: "someone",
      });
    },
    kv,
    kvPrefixes: {
      activityIdempotence: ["_fedify", "activityIdempotence"],
      publicKey: ["_fedify", "publicKey"],
      acceptSignatureNonce: ["_fedify", "acceptSignatureNonce"],
    },
    actorDispatcher,
    onNotFound: () => new Response("Not found", { status: 404 }),
    signatureTimeWindow: { minutes: 5 },
    skipSignatureVerification: false,
    inboxChallengePolicy: { enabled: true },
  });
  assertEquals(response.status, 202);
  assertEquals(
    response.headers.get("Accept-Signature"),
    null,
    "No Accept-Signature header on successful request",
  );
});

test("handleInbox() challenge policy disabled + unsigned request", async () => {
  const activity = new Create({
    id: new URL("https://example.com/activities/challenge-4"),
    actor: new URL("https://example.com/person2"),
    object: new Note({
      id: new URL("https://example.com/notes/challenge-4"),
      attribution: new URL("https://example.com/person2"),
      content: "Hello!",
    }),
  });
  const unsignedRequest = new Request("https://example.com/", {
    method: "POST",
    body: JSON.stringify(await activity.toJsonLd()),
  });
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  const context = createRequestContext({
    federation,
    request: unsignedRequest,
    url: new URL(unsignedRequest.url),
    data: undefined,
  });
  const actorDispatcher: ActorDispatcher<void> = (_ctx, identifier) => {
    if (identifier !== "someone") return null;
    return new Person({ name: "Someone" });
  };
  const kv = new MemoryKvStore();
  const response = await handleInbox(unsignedRequest, {
    recipient: "someone",
    context,
    inboxContextFactory(_activity) {
      return createInboxContext({
        ...context,
        clone: undefined,
        recipient: "someone",
      });
    },
    kv,
    kvPrefixes: {
      activityIdempotence: ["_fedify", "activityIdempotence"],
      publicKey: ["_fedify", "publicKey"],
      acceptSignatureNonce: ["_fedify", "acceptSignatureNonce"],
    },
    actorDispatcher,
    onNotFound: () => new Response("Not found", { status: 404 }),
    signatureTimeWindow: { minutes: 5 },
    skipSignatureVerification: false,
    // No inboxChallengePolicy — disabled by default
  });
  assertEquals(response.status, 401);
  assertEquals(
    response.headers.get("Accept-Signature"),
    null,
    "No Accept-Signature header when challenge policy is disabled",
  );
});

test("handleInbox() actor/key mismatch → plain 401 (no challenge)", async () => {
  // Sign with attacker's key but claim to be a different actor
  const maliciousActivity = new Create({
    id: new URL("https://attacker.example.com/activities/challenge-5"),
    actor: new URL("https://victim.example.com/users/alice"),
    object: new Note({
      id: new URL("https://attacker.example.com/notes/challenge-5"),
      attribution: new URL("https://victim.example.com/users/alice"),
      content: "Forged message!",
    }),
  });
  const maliciousRequest = await signRequest(
    new Request("https://example.com/", {
      method: "POST",
      body: JSON.stringify(await maliciousActivity.toJsonLd()),
    }),
    rsaPrivateKey3,
    rsaPublicKey3.id!,
  );
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  const context = createRequestContext({
    federation,
    request: maliciousRequest,
    url: new URL(maliciousRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
  });
  const actorDispatcher: ActorDispatcher<void> = (_ctx, identifier) => {
    if (identifier !== "someone") return null;
    return new Person({ name: "Someone" });
  };
  const kv = new MemoryKvStore();
  const response = await handleInbox(maliciousRequest, {
    recipient: "someone",
    context,
    inboxContextFactory(_activity) {
      return createInboxContext({
        ...context,
        clone: undefined,
        recipient: "someone",
      });
    },
    kv,
    kvPrefixes: {
      activityIdempotence: ["_fedify", "activityIdempotence"],
      publicKey: ["_fedify", "publicKey"],
      acceptSignatureNonce: ["_fedify", "acceptSignatureNonce"],
    },
    actorDispatcher,
    onNotFound: () => new Response("Not found", { status: 404 }),
    signatureTimeWindow: { minutes: 5 },
    skipSignatureVerification: false,
    inboxChallengePolicy: { enabled: true },
  });
  assertEquals(response.status, 401);
  assertEquals(
    response.headers.get("Accept-Signature"),
    null,
    "Actor/key mismatch should not emit Accept-Signature challenge",
  );
  assertEquals(
    await response.text(),
    "The signer and the actor do not match.",
  );
});

test("handleInbox() nonce issuance in challenge", async () => {
  const activity = new Create({
    id: new URL("https://example.com/activities/nonce-1"),
    actor: new URL("https://example.com/person2"),
    object: new Note({
      id: new URL("https://example.com/notes/nonce-1"),
      attribution: new URL("https://example.com/person2"),
      content: "Hello!",
    }),
  });
  const unsignedRequest = new Request("https://example.com/", {
    method: "POST",
    body: JSON.stringify(await activity.toJsonLd()),
  });
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  const context = createRequestContext({
    federation,
    request: unsignedRequest,
    url: new URL(unsignedRequest.url),
    data: undefined,
  });
  const actorDispatcher: ActorDispatcher<void> = (_ctx, identifier) => {
    if (identifier !== "someone") return null;
    return new Person({ name: "Someone" });
  };
  const kv = new MemoryKvStore();
  const response = await handleInbox(unsignedRequest, {
    recipient: "someone",
    context,
    inboxContextFactory(_activity) {
      return createInboxContext({
        ...context,
        clone: undefined,
        recipient: "someone",
      });
    },
    kv,
    kvPrefixes: {
      activityIdempotence: ["_fedify", "activityIdempotence"],
      publicKey: ["_fedify", "publicKey"],
      acceptSignatureNonce: ["_fedify", "acceptSignatureNonce"],
    },
    actorDispatcher,
    onNotFound: () => new Response("Not found", { status: 404 }),
    signatureTimeWindow: { minutes: 5 },
    skipSignatureVerification: false,
    inboxChallengePolicy: {
      enabled: true,
      requestNonce: true,
      nonceTtlSeconds: 300,
    },
  });
  assertEquals(response.status, 401);
  const acceptSig = response.headers.get("Accept-Signature");
  assert(acceptSig != null, "Accept-Signature header must be present");
  const parsed = parseAcceptSignature(acceptSig);
  assert(parsed.length > 0);
  assert(
    parsed[0].parameters.nonce != null,
    "Nonce must be present in Accept-Signature parameters",
  );
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  // Verify the nonce was stored in KV
  const nonceKey = [
    "_fedify",
    "acceptSignatureNonce",
    parsed[0].parameters.nonce!,
  ] as const;
  const stored = await kv.get(nonceKey);
  assertEquals(stored, true, "Nonce must be stored in KV store");
});

test("handleInbox() nonce consumption on valid signed request", async () => {
  const activity = new Create({
    id: new URL("https://example.com/activities/nonce-2"),
    actor: new URL("https://example.com/person2"),
    object: new Note({
      id: new URL("https://example.com/notes/nonce-2"),
      attribution: new URL("https://example.com/person2"),
      content: "Hello!",
    }),
  });
  const kv = new MemoryKvStore();
  const noncePrefix = ["_fedify", "acceptSignatureNonce"] as const;
  // Pre-store a nonce in KV
  const nonce = "test-nonce-abc123";
  await kv.set(
    ["_fedify", "acceptSignatureNonce", nonce] as const,
    true,
    { ttl: Temporal.Duration.from({ seconds: 300 }) },
  );
  // Sign request with the nonce included via rfc9421
  const signedRequest = await signRequest(
    new Request("https://example.com/", {
      method: "POST",
      body: JSON.stringify(await activity.toJsonLd()),
    }),
    rsaPrivateKey3,
    rsaPublicKey3.id!,
    { spec: "rfc9421", rfc9421: { nonce } },
  );
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  const context = createRequestContext({
    federation,
    request: signedRequest,
    url: new URL(signedRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
  });
  const actorDispatcher: ActorDispatcher<void> = (_ctx, identifier) => {
    if (identifier !== "someone") return null;
    return new Person({ name: "Someone" });
  };
  const response = await handleInbox(signedRequest, {
    recipient: "someone",
    context,
    inboxContextFactory(_activity) {
      return createInboxContext({
        ...context,
        clone: undefined,
        recipient: "someone",
      });
    },
    kv,
    kvPrefixes: {
      activityIdempotence: ["_fedify", "activityIdempotence"],
      publicKey: ["_fedify", "publicKey"],
      acceptSignatureNonce: noncePrefix,
    },
    actorDispatcher,
    onNotFound: () => new Response("Not found", { status: 404 }),
    signatureTimeWindow: { minutes: 5 },
    skipSignatureVerification: false,
    inboxChallengePolicy: {
      enabled: true,
      requestNonce: true,
      nonceTtlSeconds: 300,
    },
  });
  assertEquals(response.status, 202);
  // Nonce must have been consumed (deleted from KV)
  const stored = await kv.get(
    ["_fedify", "acceptSignatureNonce", nonce] as const,
  );
  assertEquals(stored, undefined, "Nonce must be consumed after use");
});

test("handleInbox() nonce replay prevention", async () => {
  const activity = new Create({
    id: new URL("https://example.com/activities/nonce-3"),
    actor: new URL("https://example.com/person2"),
    object: new Note({
      id: new URL("https://example.com/notes/nonce-3"),
      attribution: new URL("https://example.com/person2"),
      content: "Hello!",
    }),
  });
  const kv = new MemoryKvStore();
  const noncePrefix = ["_fedify", "acceptSignatureNonce"] as const;
  const nonce = "replay-nonce-xyz";
  // Do NOT store the nonce — simulate it was already consumed or never issued
  const signedRequest = await signRequest(
    new Request("https://example.com/", {
      method: "POST",
      body: JSON.stringify(await activity.toJsonLd()),
    }),
    rsaPrivateKey3,
    rsaPublicKey3.id!,
    { spec: "rfc9421", rfc9421: { nonce } },
  );
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  const context = createRequestContext({
    federation,
    request: signedRequest,
    url: new URL(signedRequest.url),
    data: undefined,
    documentLoader: mockDocumentLoader,
  });
  const actorDispatcher: ActorDispatcher<void> = (_ctx, identifier) => {
    if (identifier !== "someone") return null;
    return new Person({ name: "Someone" });
  };
  const response = await handleInbox(signedRequest, {
    recipient: "someone",
    context,
    inboxContextFactory(_activity) {
      return createInboxContext({
        ...context,
        clone: undefined,
        recipient: "someone",
      });
    },
    kv,
    kvPrefixes: {
      activityIdempotence: ["_fedify", "activityIdempotence"],
      publicKey: ["_fedify", "publicKey"],
      acceptSignatureNonce: noncePrefix,
    },
    actorDispatcher,
    onNotFound: () => new Response("Not found", { status: 404 }),
    signatureTimeWindow: { minutes: 5 },
    skipSignatureVerification: false,
    inboxChallengePolicy: {
      enabled: true,
      requestNonce: true,
      nonceTtlSeconds: 300,
    },
  });
  assertEquals(response.status, 401);
  // Should return a fresh challenge with a new nonce
  const acceptSig = response.headers.get("Accept-Signature");
  assert(acceptSig != null, "Must emit fresh Accept-Signature challenge");
  const parsed = parseAcceptSignature(acceptSig);
  assert(parsed.length > 0);
  assert(
    parsed[0].parameters.nonce != null,
    "Fresh challenge must include a new nonce",
  );
  assert(
    parsed[0].parameters.nonce !== nonce,
    "Fresh nonce must differ from the replayed one",
  );
  assertEquals(
    response.headers.get("Cache-Control"),
    "no-store",
    "Challenge response must have Cache-Control: no-store",
  );
});

test(
  "handleInbox() nonce bypass: valid sig without nonce + invalid sig with nonce",
  async () => {
    // This test demonstrates a vulnerability where verifySignatureNonce() scans
    // ALL Signature-Input entries for a nonce, but verifyRequestDetailed() does
    // not report which signature label was verified.  An attacker can bypass
    // nonce enforcement by submitting:
    //   1. A valid signature (sig1) WITHOUT a nonce
    //   2. A bogus signature (sig2) that carries a stored nonce
    // verifyRequestDetailed() succeeds on sig1, then verifySignatureNonce()
    // finds and consumes the nonce from sig2, so the request is accepted even
    // though the *verified* signature never carried a nonce.

    const activity = new Create({
      id: new URL("https://example.com/activities/nonce-bypass-1"),
      actor: new URL("https://example.com/person2"),
      object: new Note({
        id: new URL("https://example.com/notes/nonce-bypass-1"),
        attribution: new URL("https://example.com/person2"),
        content: "Hello!",
      }),
    });

    const kv = new MemoryKvStore();
    const noncePrefix = ["_fedify", "acceptSignatureNonce"] as const;

    // Pre-store a nonce that the attacker knows (e.g., from a prior challenge)
    const storedNonce = "bypass-nonce-abc123";
    await kv.set(
      ["_fedify", "acceptSignatureNonce", storedNonce] as const,
      true,
      { ttl: Temporal.Duration.from({ seconds: 300 }) },
    );

    // Step 1: Create a legitimately signed request (sig1) WITHOUT a nonce
    const signedRequest = await signRequest(
      new Request("https://example.com/", {
        method: "POST",
        body: JSON.stringify(await activity.toJsonLd()),
      }),
      rsaPrivateKey3,
      rsaPublicKey3.id!,
      { spec: "rfc9421" }, // no nonce
    );

    // Step 2: Manually inject a second bogus signature entry (sig2) that carries
    // the stored nonce.  The signature bytes are garbage — it will never verify —
    // but verifySignatureNonce() doesn't check validity, only presence.
    const existingSignatureInput = signedRequest.headers.get(
      "Signature-Input",
    )!;
    const existingSignature = signedRequest.headers.get("Signature")!;
    const bogusSigInput = `sig2=("@method" "@target-uri");` +
      `alg="rsa-v1_5-sha256";keyid="${rsaPublicKey3.id!.href}";` +
      `created=${Math.floor(Date.now() / 1000)};` +
      `nonce="${storedNonce}"`;
    const bogusSigValue = `sig2=:AAAA:`; // garbage base64

    const tamperedHeaders = new Headers(signedRequest.headers);
    tamperedHeaders.set(
      "Signature-Input",
      `${existingSignatureInput}, ${bogusSigInput}`,
    );
    tamperedHeaders.set(
      "Signature",
      `${existingSignature}, ${bogusSigValue}`,
    );

    const tamperedRequest = new Request(signedRequest.url, {
      method: signedRequest.method,
      headers: tamperedHeaders,
      body: await signedRequest.clone().arrayBuffer(),
    });

    const federation = createFederation<void>({ kv: new MemoryKvStore() });
    const context = createRequestContext({
      federation,
      request: tamperedRequest,
      url: new URL(tamperedRequest.url),
      data: undefined,
      documentLoader: mockDocumentLoader,
    });
    const actorDispatcher: ActorDispatcher<void> = (_ctx, identifier) => {
      if (identifier !== "someone") return null;
      return new Person({ name: "Someone" });
    };

    const response = await handleInbox(tamperedRequest, {
      recipient: "someone",
      context,
      inboxContextFactory(_activity) {
        return createInboxContext({
          ...context,
          clone: undefined,
          recipient: "someone",
        });
      },
      kv,
      kvPrefixes: {
        activityIdempotence: ["_fedify", "activityIdempotence"],
        publicKey: ["_fedify", "publicKey"],
        acceptSignatureNonce: noncePrefix,
      },
      actorDispatcher,
      onNotFound: () => new Response("Not found", { status: 404 }),
      signatureTimeWindow: { minutes: 5 },
      skipSignatureVerification: false,
      inboxChallengePolicy: {
        enabled: true,
        requestNonce: true,
        nonceTtlSeconds: 300,
      },
    });

    // The verified signature (sig1) has no nonce.  The nonce was only in the
    // bogus sig2.  A correct implementation MUST reject this request because
    // the *verified* signature did not carry a valid nonce.
    assertEquals(
      response.status,
      401,
      "Request with nonce only in a non-verified signature must be rejected " +
        "(nonce verification must be bound to the verified signature label)",
    );

    // The stored nonce should NOT have been consumed by a bogus signature
    const stored = await kv.get(
      ["_fedify", "acceptSignatureNonce", storedNonce] as const,
    );
    assertEquals(
      stored,
      true,
      "Nonce must not be consumed when it comes from a non-verified signature",
    );
  },
);

test(
  "handleInbox() actor/key mismatch does not consume nonce",
  async () => {
    // A request that has a valid RFC 9421 signature with a nonce, but the
    // signing key does not belong to the claimed actor.  The nonce must NOT be
    // consumed so the legitimate sender can still use it.
    const maliciousActivity = new Create({
      id: new URL("https://attacker.example.com/activities/mismatch-nonce-1"),
      actor: new URL("https://victim.example.com/users/alice"),
      object: new Note({
        id: new URL("https://attacker.example.com/notes/mismatch-nonce-1"),
        attribution: new URL("https://victim.example.com/users/alice"),
        content: "Forged message with nonce!",
      }),
    });
    const kv = new MemoryKvStore();
    const noncePrefix = ["_fedify", "acceptSignatureNonce"] as const;
    const nonce = "mismatch-nonce-xyz";
    await kv.set(
      ["_fedify", "acceptSignatureNonce", nonce] as const,
      true,
      { ttl: Temporal.Duration.from({ seconds: 300 }) },
    );
    // Sign with rsaPrivateKey3 (associated with example.com/person2, not
    // victim.example.com/users/alice), and include the stored nonce.
    const maliciousRequest = await signRequest(
      new Request("https://example.com/", {
        method: "POST",
        body: JSON.stringify(await maliciousActivity.toJsonLd()),
      }),
      rsaPrivateKey3,
      rsaPublicKey3.id!,
      { spec: "rfc9421", rfc9421: { nonce } },
    );
    const federation = createFederation<void>({ kv: new MemoryKvStore() });
    const context = createRequestContext({
      federation,
      request: maliciousRequest,
      url: new URL(maliciousRequest.url),
      data: undefined,
      documentLoader: mockDocumentLoader,
    });
    const actorDispatcher: ActorDispatcher<void> = (_ctx, identifier) => {
      if (identifier !== "someone") return null;
      return new Person({ name: "Someone" });
    };
    const response = await handleInbox(maliciousRequest, {
      recipient: "someone",
      context,
      inboxContextFactory(_activity) {
        return createInboxContext({
          ...context,
          clone: undefined,
          recipient: "someone",
        });
      },
      kv,
      kvPrefixes: {
        activityIdempotence: ["_fedify", "activityIdempotence"],
        publicKey: ["_fedify", "publicKey"],
        acceptSignatureNonce: noncePrefix,
      },
      actorDispatcher,
      onNotFound: () => new Response("Not found", { status: 404 }),
      signatureTimeWindow: { minutes: 5 },
      skipSignatureVerification: false,
      inboxChallengePolicy: {
        enabled: true,
        requestNonce: true,
        nonceTtlSeconds: 300,
      },
    });
    assertEquals(response.status, 401);
    assertEquals(
      await response.text(),
      "The signer and the actor do not match.",
    );
    // The nonce must NOT have been consumed — the actor/key mismatch should
    // reject before nonce consumption so the nonce remains usable.
    const stored = await kv.get(
      ["_fedify", "acceptSignatureNonce", nonce] as const,
    );
    assertEquals(
      stored,
      true,
      "Nonce must not be consumed when actor/key ownership check fails",
    );
  },
);

test(
  "handleInbox() challenge policy enabled + unverifiedActivityHandler " +
    "returns undefined",
  async () => {
    const activity = new Create({
      id: new URL("https://example.com/activities/challenge-unverified"),
      actor: new URL("https://example.com/person2"),
      object: new Note({
        id: new URL("https://example.com/notes/challenge-unverified"),
        attribution: new URL("https://example.com/person2"),
        content: "Hello!",
      }),
    });
    // Sign with a key, then tamper with the body to invalidate the signature
    const originalRequest = new Request("https://example.com/", {
      method: "POST",
      body: JSON.stringify(await activity.toJsonLd()),
    });
    const signedRequest = await signRequest(
      originalRequest,
      rsaPrivateKey3,
      rsaPublicKey3.id!,
    );
    const jsonLd = await activity.toJsonLd() as Record<string, unknown>;
    const tamperedBody = JSON.stringify({
      ...jsonLd,
      "https://example.com/tampered": true,
    });
    const tamperedRequest = new Request(signedRequest.url, {
      method: signedRequest.method,
      headers: signedRequest.headers,
      body: tamperedBody,
    });
    const federation = createFederation<void>({ kv: new MemoryKvStore() });
    const context = createRequestContext({
      federation,
      request: tamperedRequest,
      url: new URL(tamperedRequest.url),
      data: undefined,
      documentLoader: mockDocumentLoader,
    });
    const actorDispatcher: ActorDispatcher<void> = (_ctx, identifier) => {
      if (identifier !== "someone") return null;
      return new Person({ name: "Someone" });
    };
    const kv = new MemoryKvStore();
    const response = await handleInbox(tamperedRequest, {
      recipient: "someone",
      context,
      inboxContextFactory(_activity) {
        return createInboxContext({
          ...context,
          clone: undefined,
          recipient: "someone",
        });
      },
      kv,
      kvPrefixes: {
        activityIdempotence: ["_fedify", "activityIdempotence"],
        publicKey: ["_fedify", "publicKey"],
        acceptSignatureNonce: ["_fedify", "acceptSignatureNonce"],
      },
      actorDispatcher,
      // unverifiedActivityHandler returns undefined (void), not a Response
      unverifiedActivityHandler() {},
      onNotFound: () => new Response("Not found", { status: 404 }),
      signatureTimeWindow: { minutes: 5 },
      skipSignatureVerification: false,
      inboxChallengePolicy: { enabled: true },
    });
    assertEquals(response.status, 401);
    const acceptSig = response.headers.get("Accept-Signature");
    assert(
      acceptSig != null,
      "Accept-Signature header must be present when unverifiedActivityHandler " +
        "returns undefined and challenge policy is enabled",
    );
    const parsed = parseAcceptSignature(acceptSig);
    assert(
      parsed.length > 0,
      "Accept-Signature must have at least one entry",
    );
    assertEquals(
      response.headers.get("Cache-Control"),
      "no-store",
      "Cache-Control: no-store must be set for challenge-response",
    );
    assertEquals(
      response.headers.get("Vary"),
      "Accept, Signature",
      "Vary header must include Accept and Signature",
    );
  },
);

test(
  "handleInbox() challenge policy enabled + unverifiedActivityHandler " +
    "throws error",
  async () => {
    const activity = new Create({
      id: new URL("https://example.com/activities/challenge-throw"),
      actor: new URL("https://example.com/person2"),
      object: new Note({
        id: new URL("https://example.com/notes/challenge-throw"),
        attribution: new URL("https://example.com/person2"),
        content: "Hello!",
      }),
    });
    const originalRequest = new Request("https://example.com/", {
      method: "POST",
      body: JSON.stringify(await activity.toJsonLd()),
    });
    const signedRequest = await signRequest(
      originalRequest,
      rsaPrivateKey3,
      rsaPublicKey3.id!,
    );
    const jsonLd = await activity.toJsonLd() as Record<string, unknown>;
    const tamperedBody = JSON.stringify({
      ...jsonLd,
      "https://example.com/tampered": true,
    });
    const tamperedRequest = new Request(signedRequest.url, {
      method: signedRequest.method,
      headers: signedRequest.headers,
      body: tamperedBody,
    });
    const federation = createFederation<void>({ kv: new MemoryKvStore() });
    const context = createRequestContext({
      federation,
      request: tamperedRequest,
      url: new URL(tamperedRequest.url),
      data: undefined,
      documentLoader: mockDocumentLoader,
    });
    const actorDispatcher: ActorDispatcher<void> = (_ctx, identifier) => {
      if (identifier !== "someone") return null;
      return new Person({ name: "Someone" });
    };
    const kv = new MemoryKvStore();
    const response = await handleInbox(tamperedRequest, {
      recipient: "someone",
      context,
      inboxContextFactory(_activity) {
        return createInboxContext({
          ...context,
          clone: undefined,
          recipient: "someone",
        });
      },
      kv,
      kvPrefixes: {
        activityIdempotence: ["_fedify", "activityIdempotence"],
        publicKey: ["_fedify", "publicKey"],
        acceptSignatureNonce: ["_fedify", "acceptSignatureNonce"],
      },
      actorDispatcher,
      // unverifiedActivityHandler throws an error
      unverifiedActivityHandler() {
        throw new Error("handler error");
      },
      onNotFound: () => new Response("Not found", { status: 404 }),
      signatureTimeWindow: { minutes: 5 },
      skipSignatureVerification: false,
      inboxChallengePolicy: { enabled: true },
    });
    assertEquals(response.status, 401);
    const acceptSig = response.headers.get("Accept-Signature");
    assert(
      acceptSig != null,
      "Accept-Signature header must be present when unverifiedActivityHandler " +
        "throws and challenge policy is enabled",
    );
    const parsed = parseAcceptSignature(acceptSig);
    assert(
      parsed.length > 0,
      "Accept-Signature must have at least one entry",
    );
    assertEquals(
      response.headers.get("Cache-Control"),
      "no-store",
      "Cache-Control: no-store must be set for challenge-response",
    );
    assertEquals(
      response.headers.get("Vary"),
      "Accept, Signature",
      "Vary header must include Accept and Signature",
    );
  },
);
