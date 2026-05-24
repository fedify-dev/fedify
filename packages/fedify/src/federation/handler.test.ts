import {
  createTestMeterProvider,
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
import {
  assert,
  assertEquals,
  assertGreaterOrEqual,
  assertInstanceOf,
  assertRejects,
} from "@std/assert";
import { parseAcceptSignature } from "../sig/accept.ts";
import { signRequest } from "../sig/http.ts";
import { compactJsonLd, signJsonLd } from "../sig/ld.ts";
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
import type { MessageQueue } from "./mq.ts";
import type { InboxMessage } from "./queue.ts";

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

  onNotFoundCalled = null;
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
    actorDispatcher: () => null,
    outboxListeners: listeners,
    authorizePredicate: () => false,
    onNotFound,
    onUnauthorized,
  });
  assertEquals(onNotFoundCalled, null);
  assertInstanceOf(onUnauthorizedCalled, Request);
  assertEquals(response.status, 401);

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
  assertEquals(
    response.headers.get("content-type"),
    "text/plain; charset=utf-8",
  );
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
  assertEquals(
    response.headers.get("content-type"),
    "text/plain; charset=utf-8",
  );
  assertEquals(seen, [
    `someone:${activity.id?.href}`,
    `someone:${activity.id?.href}`,
  ]);

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
  const inboxListeners = new ActivityListenerSet<InboxContext<void>>();
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
      acceptSignatureNonce: ["_fedify", "acceptSignatureNonce"],
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
      acceptSignatureNonce: ["_fedify", "acceptSignatureNonce"],
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
        acceptSignatureNonce: ["_fedify", "acceptSignatureNonce"],
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
  const [meterProvider, recorder] = createTestMeterProvider();
  const kv = new MemoryKvStore();
  const federation = createFederation<void>({
    kv,
    meterProvider,
    tracerProvider,
  });

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
    meterProvider,
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

  const durations = recorder.getMeasurements(
    "activitypub.inbox.processing_duration",
  );
  assertEquals(durations.length, 1);
  assertEquals(durations[0].type, "histogram");
  assertGreaterOrEqual(durations[0].value, 0);
  assertEquals(
    durations[0].attributes["activitypub.activity.type"],
    "https://www.w3.org/ns/activitystreams#Create",
  );
});

test("handleInbox() records fedify.queue.task.enqueued when queued", async () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  const kv = new MemoryKvStore();
  const federation = createFederation<void>({
    kv,
    meterProvider,
  });

  const activity = new Create({
    id: new URL("https://example.com/activities/queued"),
    actor: new URL("https://example.com/users/someone"),
    object: new Note({
      id: new URL("https://example.com/note-queued"),
      content: "Queue me up",
    }),
  });

  const request = new Request("https://example.com/users/someone/inbox", {
    method: "POST",
    headers: { "Content-Type": "application/activity+json" },
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

  const queuedMessages: unknown[] = [];
  const queue: MessageQueue = {
    enqueue(message, _options) {
      queuedMessages.push(message);
      return Promise.resolve();
    },
    listen(_handler, _options) {
      return Promise.resolve();
    },
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
    onNotFound: (_request) => new Response("Not found", { status: 404 }),
    signatureTimeWindow: false,
    skipSignatureVerification: true,
    queue,
    meterProvider,
  });

  assertEquals(response.status, 202);
  assertEquals(queuedMessages.length, 1);

  const enqueued = recorder.getMeasurements("fedify.queue.task.enqueued");
  assertEquals(enqueued.length, 1);
  assertEquals(enqueued[0].type, "counter");
  assertEquals(enqueued[0].attributes["fedify.queue.role"], "inbox");
  assertEquals(enqueued[0].attributes["fedify.queue.task.attempt"], 0);
  assertEquals(
    enqueued[0].attributes["activitypub.activity.type"],
    "https://www.w3.org/ns/activitystreams#Create",
  );
  // The queue here is an object literal, so getQueueBackend() should omit the
  // backend attribute rather than emit "Object".
  assertEquals(enqueued[0].attributes["fedify.queue.backend"], undefined);
});

test("handleInbox() records unverified HTTP signature details", async () => {
  const [tracerProvider, exporter] = createTestTracerProvider();
  const [meterProvider, recorder] = createTestMeterProvider();
  const kv = new MemoryKvStore();
  const federation = createFederation<void>({
    kv,
    meterProvider,
    tracerProvider,
  });
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
    meterProvider,
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

  const failures = recorder.getMeasurements(
    "activitypub.signature.verification_failure",
  );
  assertEquals(failures.length, 1);
  assertEquals(failures[0].type, "counter");
  assertEquals(failures[0].value, 1);
  assertEquals(
    failures[0].attributes["activitypub.remote.host"],
    "gone.example",
  );
  assertEquals(
    failures[0].attributes["activitypub.verification.failure_reason"],
    "keyFetchError",
  );
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
    // No inboxChallengePolicy—disabled by default
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
  const [meterProvider, recorder] = createTestMeterProvider();
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
  // Do NOT store the nonce—simulate it was already consumed or never issued
  const signedRequest = await signRequest(
    new Request("https://example.com/", {
      method: "POST",
      body: JSON.stringify(await activity.toJsonLd()),
    }),
    rsaPrivateKey3,
    rsaPublicKey3.id!,
    { spec: "rfc9421", rfc9421: { nonce } },
  );
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    meterProvider,
  });
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
    meterProvider,
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
  const failures = recorder.getMeasurements(
    "activitypub.signature.verification_failure",
  );
  assertEquals(failures.length, 1);
  assertEquals(failures[0].value, 1);
  assertEquals(
    failures[0].attributes["activitypub.remote.host"],
    "example.com",
  );
  assertEquals(
    failures[0].attributes["activitypub.verification.failure_reason"],
    "invalidNonce",
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
    // the stored nonce.  The signature bytes are garbage—it will never verify—
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
    const [meterProvider, recorder] = createTestMeterProvider();
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
    const federation = createFederation<void>({
      kv: new MemoryKvStore(),
      meterProvider,
    });
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
      meterProvider,
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
    // The nonce must NOT have been consumed—the actor/key mismatch should
    // reject before nonce consumption so the nonce remains usable.
    const stored = await kv.get(
      ["_fedify", "acceptSignatureNonce", nonce] as const,
    );
    assertEquals(
      stored,
      true,
      "Nonce must not be consumed when actor/key ownership check fails",
    );
    const failures = recorder.getMeasurements(
      "activitypub.signature.verification_failure",
    );
    assertEquals(failures.length, 1);
    assertEquals(failures[0].value, 1);
    assertEquals(
      failures[0].attributes["activitypub.remote.host"],
      "example.com",
    );
    assertEquals(
      failures[0].attributes["activitypub.verification.failure_reason"],
      "actorKeyMismatch",
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
