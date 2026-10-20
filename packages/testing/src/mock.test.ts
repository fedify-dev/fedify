import type { InboxContext } from "@fedify/fedify/federation";
import { test } from "@fedify/fixture";
import { Create, Follow, Note, Person, Undo } from "@fedify/vocab";
import { getDocumentLoader, UrlError } from "@fedify/vocab-runtime";
import {
  assertEquals,
  assertInstanceOf,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
} from "@std/assert";
import { createFederation } from "./mock.ts";

test("MockFederation actor setters support chaining in any order", () => {
  const federation = createFederation<void>();
  const setters = federation.setActorDispatcher(
    "/users/{identifier}",
    () => null,
  );
  const configure = [
    () => setters.setKeyPairsDispatcher(() => []),
    () => setters.mapHandle((_ctx, handle) => handle),
    () => setters.mapAlias(() => null),
    () => setters.authorize(() => true),
  ];
  for (const first of configure) {
    assertStrictEquals(first(), setters);
    for (const second of configure) {
      assertStrictEquals(second(), setters);
    }
  }
  assertStrictEquals(
    setters.setKeyPairsDispatcher(() => [])
      .mapHandle((_ctx, handle) => handle)
      .mapAlias(() => null)
      .authorize(() => true)
      .setKeyPairsDispatcher(() => []),
    setters,
  );
});

test("MockFederation object setters support chaining authorize", () => {
  const federation = createFederation<void>();
  const setters = federation.setObjectDispatcher(
    Note,
    "/notes/{id}",
    () => null,
  );
  assertStrictEquals(setters.authorize(() => true), setters);
  assertStrictEquals(
    setters.authorize(() => true).authorize(() => false),
    setters,
  );
});

for (
  const method of [
    "setInboxDispatcher",
    "setOutboxDispatcher",
    "setFollowingDispatcher",
    "setFollowersDispatcher",
    "setLikedDispatcher",
    "setFeaturedDispatcher",
    "setFeaturedTagsDispatcher",
    "setCollectionDispatcher",
    "setOrderedCollectionDispatcher",
  ] as const
) {
  test(`MockFederation.${method} setters support chaining in any order`, () => {
    const federation = createFederation<void>();
    const setters = method === "setCollectionDispatcher" ||
        method === "setOrderedCollectionDispatcher"
      ? federation[method]("notes", Note, "/notes/{identifier}", () => null)
      : federation[method]("/users/{identifier}/collection", () => null);
    assertStrictEquals(setters.setCounter(() => 0), setters);
    assertStrictEquals(setters.setFirstCursor(() => null), setters);
    assertStrictEquals(setters.setLastCursor(() => null), setters);
    assertStrictEquals(setters.authorize(() => true), setters);
    assertStrictEquals(
      setters.authorize(() => true)
        .setCounter(() => 0)
        .setFirstCursor(() => null)
        .setLastCursor(() => null)
        .authorize(() => false),
      setters,
    );
    assertStrictEquals(
      setters.setLastCursor(() => null)
        .setFirstCursor(() => null)
        .setCounter(() => 0)
        .authorize(() => true)
        .setLastCursor(() => null),
      setters,
    );
  });
}

test("getSentActivities returns sent activities", async () => {
  const mockFederation = createFederation<void>();
  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  // Create a test activity
  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
    object: new Note({
      id: new URL("https://example.com/notes/1"),
      content: "Hello, world!",
    }),
  });

  // Send the activity
  await context.sendActivity(
    { identifier: "alice" },
    new Person({ id: new URL("https://example.com/users/bob") }),
    activity,
  );

  // Check that the activity was recorded
  assertEquals(mockFederation.sentActivities.length, 1);
  assertEquals(mockFederation.sentActivities[0].activity, activity);
  assertEquals(mockFederation.sentActivities[0].queued, false);
  assertEquals(mockFederation.sentActivities[0].sentOrder, 1);
});

test("reset clears sent activities", async () => {
  const mockFederation = createFederation<void>();
  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  // Send an activity
  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
  });

  await context.sendActivity(
    { identifier: "alice" },
    new Person({ id: new URL("https://example.com/users/bob") }),
    activity,
  );

  // Verify it was sent
  assertEquals(mockFederation.sentActivities.length, 1);
  assertEquals(mockFederation.sentActivities[0].activity, activity);

  // Clear sent activities
  mockFederation.reset();

  // Verify they were cleared
  assertEquals(mockFederation.sentActivities.length, 0);
});

test("receiveActivity triggers inbox listeners", async () => {
  // Provide contextData through constructor
  const mockFederation = createFederation<{ test: string }>({
    contextData: { test: "data" },
  });
  let receivedActivity: Create | null = null;

  // Set up an inbox listener
  mockFederation
    .setInboxListeners("/users/{identifier}/inbox")
    .on(
      Create,
      (_ctx: InboxContext<{ test: string }>, activity: Create) => {
        receivedActivity = activity;
        return Promise.resolve();
      },
    );

  // Create and receive an activity
  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
    object: new Note({
      id: new URL("https://example.com/notes/1"),
      content: "Test note",
    }),
  });

  await mockFederation.receiveActivity(activity);

  // Verify the listener was triggered
  assertEquals(receivedActivity, activity);
});

test("MockContext tracks sent activities", async () => {
  const mockFederation = createFederation<void>();
  const mockContext = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  // Create a test activity
  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
    object: new Note({
      id: new URL("https://example.com/notes/1"),
      content: "Hello from MockContext!",
    }),
  });

  // Send the activity
  await mockContext.sendActivity(
    { identifier: "alice" },
    new Person({ id: new URL("https://example.com/users/bob") }),
    activity,
  );

  // Check that the activity was recorded in the federation
  assertEquals(mockFederation.sentActivities.length, 1);
  assertEquals(mockFederation.sentActivities[0].activity, activity);
});

test("MockContext URI methods should work correctly", () => {
  const mockFederation = createFederation<void>();
  const mockContext = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  // Test URI generation methods
  assertEquals(
    mockContext.getActorUri("alice").href,
    "https://example.com/users/alice",
  );
  assertEquals(
    mockContext.getInboxUri("alice").href,
    "https://example.com/users/alice/inbox",
  );
  assertEquals(mockContext.getInboxUri().href, "https://example.com/inbox");
  assertEquals(
    mockContext.getOutboxUri("alice").href,
    "https://example.com/users/alice/outbox",
  );
  assertEquals(
    mockContext.getFollowingUri("alice").href,
    "https://example.com/users/alice/following",
  );
  assertEquals(
    mockContext.getFollowersUri("alice").href,
    "https://example.com/users/alice/followers",
  );

  const actorUri = new URL("https://example.com/users/alice");
  const parsed = mockContext.parseUri(actorUri);
  assertEquals(parsed?.type, "actor");
  if (parsed?.type === "actor") {
    assertEquals(parsed.identifier, "alice");
  }
});

test("MockContext URI methods respect registered paths", () => {
  const mockFederation = createFederation<void>();

  // Register custom paths with dummy dispatchers
  mockFederation.setNodeInfoDispatcher("/.well-known/nodeinfo", () => ({
    software: { name: "test", version: "1.0.0" },
    protocols: [],
    usage: {
      users: {},
      localPosts: 0,
      localComments: 0,
    },
  }));
  mockFederation.setActorDispatcher("/actors/{identifier}", () => null);
  mockFederation.setObjectDispatcher(Note, "/notes/{id}", () => null);
  mockFederation.setInboxListeners(
    "/actors/{identifier}/inbox",
    "/shared-inbox",
  );
  mockFederation.setOutboxDispatcher("/actors/{identifier}/outbox", () => null);
  mockFederation.setFollowingDispatcher(
    "/actors/{identifier}/following",
    () => null,
  );
  mockFederation.setFollowersDispatcher(
    "/actors/{identifier}/followers",
    () => null,
  );
  mockFederation.setLikedDispatcher("/actors/{identifier}/liked", () => null);
  mockFederation.setFeaturedDispatcher(
    "/actors/{identifier}/featured",
    () => null,
  );
  mockFederation.setFeaturedTagsDispatcher(
    "/actors/{identifier}/tags",
    () => null,
  );

  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  // Test that URIs use the registered paths
  assertEquals(
    context.getNodeInfoUri().href,
    "https://example.com/.well-known/nodeinfo",
  );
  assertEquals(
    context.getActorUri("alice").href,
    "https://example.com/actors/alice",
  );
  assertEquals(
    context.getObjectUri(Note, { id: "123" }).href,
    "https://example.com/notes/123",
  );
  assertEquals(
    context.getInboxUri("alice").href,
    "https://example.com/actors/alice/inbox",
  );
  assertEquals(
    context.getInboxUri().href,
    "https://example.com/shared-inbox",
  );
  assertEquals(
    context.getOutboxUri("alice").href,
    "https://example.com/actors/alice/outbox",
  );
  assertEquals(
    context.getFollowingUri("alice").href,
    "https://example.com/actors/alice/following",
  );
  assertEquals(
    context.getFollowersUri("alice").href,
    "https://example.com/actors/alice/followers",
  );
  assertEquals(
    context.getLikedUri("alice").href,
    "https://example.com/actors/alice/liked",
  );
  assertEquals(
    context.getFeaturedUri("alice").href,
    "https://example.com/actors/alice/featured",
  );
  assertEquals(
    context.getFeaturedTagsUri("alice").href,
    "https://example.com/actors/alice/tags",
  );
});

test("receiveActivity throws error when contextData not initialized", async () => {
  const mockFederation = createFederation<void>();

  // Set up an inbox listener without initializing contextData
  mockFederation
    .setInboxListeners("/users/{identifier}/inbox")
    .on(Create, (_ctx: InboxContext<void>, _activity: Create) => {
      /* should not happen */
      return Promise.resolve();
    });

  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
  });

  // Should throw error
  await assertRejects(
    () => mockFederation.receiveActivity(activity),
    Error,
    "MockFederation.receiveActivity(): contextData is not initialized. Please provide contextData through the constructor or call startQueue() before receiving activities.",
  );
});

test("MockFederation distinguishes between immediate and queued activities", async () => {
  const mockFederation = createFederation<void>();

  // Start the queue to enable queued sending
  await mockFederation.startQueue(undefined);

  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  const activity1 = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
  });

  const activity2 = new Create({
    id: new URL("https://example.com/activities/2"),
    actor: new URL("https://example.com/users/alice"),
  });

  // Send activities after queue is started - should be marked as queued
  await context.sendActivity(
    { identifier: "alice" },
    new Person({ id: new URL("https://example.com/users/bob") }),
    activity1,
  );

  await context.sendActivity(
    { identifier: "alice" },
    new Person({ id: new URL("https://example.com/users/bob") }),
    activity2,
  );

  // Check activity details
  assertEquals(mockFederation.sentActivities.length, 2);
  assertEquals(mockFederation.sentActivities[0].activity, activity1);
  assertEquals(mockFederation.sentActivities[1].activity, activity2);

  // Both should be marked as sent via queue
  assertEquals(mockFederation.sentActivities[0].queued, true);
  assertEquals(mockFederation.sentActivities[1].queued, true);
  assertEquals(mockFederation.sentActivities[0].queue, "outbox");
  assertEquals(mockFederation.sentActivities[1].queue, "outbox");
  assertEquals(mockFederation.sentActivities[0].sentOrder, 1);
  assertEquals(mockFederation.sentActivities[1].sentOrder, 2);
});

test("MockFederation without queue sends all activities immediately", async () => {
  const mockFederation = createFederation<void>();

  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/users/alice"),
  });

  // Send activity - should be marked as immediate since queue not started
  await context.sendActivity(
    { identifier: "alice" },
    new Person({ id: new URL("https://example.com/users/bob") }),
    activity,
  );

  // Check activity details
  assertEquals(mockFederation.sentActivities.length, 1);
  assertEquals(mockFederation.sentActivities[0].activity, activity);

  // Should be marked as sent immediately
  assertEquals(mockFederation.sentActivities[0].queued, false);
  assertEquals(mockFederation.sentActivities[0].queue, undefined);
  assertEquals(mockFederation.sentActivities[0].sentOrder, 1);
});

test("MockContext.getActor() calls registered actor dispatcher", async () => {
  const mockFederation = createFederation<void>();

  // Register actor dispatcher
  mockFederation.setActorDispatcher(
    "/users/{identifier}",
    (ctx, identifier) => {
      return new Person({
        id: ctx.getActorUri(identifier),
        preferredUsername: identifier,
        name: `Test User ${identifier}`,
      });
    },
  ).mapHandle((_ctx, handle) => handle).mapAlias(() => null).authorize(() =>
    true
  );

  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  const actor = await context.getActor("alice");

  assertEquals(actor instanceof Person, true);
  assertEquals(actor?.preferredUsername, "alice");
  assertEquals(actor?.name, "Test User alice");
  assertEquals(actor?.id?.href, "https://example.com/users/alice");
});

test("MockContext.getObject() calls registered object dispatcher", async () => {
  const mockFederation = createFederation<void>();

  // Register object dispatcher
  mockFederation.setObjectDispatcher(
    Note,
    "/users/{identifier}/posts/{postId}",
    (ctx, values) => {
      return new Note({
        id: ctx.getObjectUri(Note, values),
        content: `Post ${values.postId} by ${values.identifier}`,
      });
    },
  ).authorize(() => true).authorize(() => true);

  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  const note = await context.getObject(Note, {
    identifier: "alice",
    postId: "123",
  });

  assertEquals(note instanceof Note, true);
  assertEquals(note?.content, "Post 123 by alice");
  assertEquals(note?.id?.href, "https://example.com/users/alice/posts/123");
});

test("MockContext.getActor() returns null when no dispatcher registered", async () => {
  const mockFederation = createFederation<void>();
  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  const actor = await context.getActor("alice");
  assertEquals(actor, null);
});

test("MockContext.getObject() returns null when no dispatcher registered", async () => {
  const mockFederation = createFederation<void>();
  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  const note = await context.getObject(Note, {
    identifier: "alice",
    postId: "123",
  });
  assertEquals(note, null);
});

test("MockContext.getActorKeyPairs() calls registered key pairs dispatcher", async () => {
  const mockFederation = createFederation<void>();

  // Generate a test RSA key pair
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );

  // Register actor dispatcher with key pairs dispatcher
  mockFederation
    .setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
      return new Person({
        id: ctx.getActorUri(identifier),
        preferredUsername: identifier,
      });
    })
    .setKeyPairsDispatcher((ctx, identifier) => {
      return [
        {
          keyId: new URL(`${ctx.getActorUri(identifier).href}#main-key`),
          privateKey: keyPair.privateKey,
          publicKey: keyPair.publicKey,
        },
      ];
    })
    .mapHandle((_ctx, handle) => handle)
    .mapAlias(() => null)
    .authorize(() => true);

  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  const keyPairs = await context.getActorKeyPairs("alice");

  assertEquals(keyPairs.length, 1);
  assertEquals(
    keyPairs[0].keyId.href,
    "https://example.com/users/alice#main-key",
  );
  assertEquals(keyPairs[0].privateKey, keyPair.privateKey);
  assertEquals(keyPairs[0].publicKey, keyPair.publicKey);
  assertEquals(keyPairs[0].cryptographicKey.id?.href, keyPairs[0].keyId.href);
  assertEquals(
    keyPairs[0].cryptographicKey.ownerId?.href,
    "https://example.com/users/alice",
  );
  assertEquals(keyPairs[0].multikey.id?.href, keyPairs[0].keyId.href);
  assertEquals(
    keyPairs[0].multikey.controllerId?.href,
    "https://example.com/users/alice",
  );
});

test("MockContext.getActorKeyPairs() returns empty array when no dispatcher registered", async () => {
  const mockFederation = createFederation<void>();
  const context = mockFederation.createContext(
    new URL("https://example.com"),
    undefined,
  );

  const keyPairs = await context.getActorKeyPairs("alice");
  assertEquals(keyPairs, []);
});

const localActorUrl = "http://localhost:9999/users/alicia";

function createNetworkFederation() {
  const options = { contextData: {}, allowPrivateAddress: true };
  return createFederation(options);
}

function createLocalFollow(): Follow {
  return new Follow({
    id: new URL("http://localhost:9999/activities/follow"),
    actor: new URL(localActorUrl),
    object: new URL("https://example.com/users/alice"),
  });
}

async function withActorFetch(fn: () => Promise<void>): Promise<string[]> {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (input) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push(url);
    return Promise.resolve(
      new Response(
        JSON.stringify({
          "@context": "https://www.w3.org/ns/activitystreams",
          id: url,
          type: "Person",
          preferredUsername: "alicia",
        }),
        { headers: { "Content-Type": "application/activity+json" } },
      ),
    );
  };
  try {
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
  return requests;
}

for (const passContext of [false, true]) {
  test(`receiveActivity allows private actor lookup (pass context: ${passContext})`, async () => {
    const federation = createNetworkFederation();
    const activity = createLocalFollow();
    const received: Follow[] = [];
    let actor: unknown;
    federation.setInboxListeners("/users/{identifier}/inbox").on(
      Follow,
      async (ctx: InboxContext<Record<string, never>>, follow: Follow) => {
        received.push(follow);
        actor = await follow.getActor(passContext ? ctx : {});
      },
    ).on(
      Follow,
      (_ctx: InboxContext<Record<string, never>>, follow: Follow) => {
        received.push(follow);
        return Promise.resolve();
      },
    );
    const requests = await withActorFetch(() =>
      federation.receiveActivity(activity)
    );
    assertEquals(requests, [localActorUrl]);
    assertInstanceOf(actor, Person);
    assertEquals(actor.id?.href, localActorUrl);
    assertInstanceOf(received[0], Follow);
    assertNotStrictEquals(received[0], activity);
    assertStrictEquals(received[0], received[1]);
    assertEquals(activity.actorId?.href, localActorUrl);
    // The listener's lazy lookup must not populate the caller's actor cache.
    await assertRejects(() => activity.getActor(), UrlError, "Localhost");
  });
}

for (const allowPrivateAddress of [undefined, false]) {
  test(`receiveActivity retains offline defaults (allowPrivateAddress: ${allowPrivateAddress})`, async () => {
    const options = { contextData: {}, allowPrivateAddress };
    const federation = createFederation(options);
    const activity = createLocalFollow();
    let received: Follow | undefined;
    let document: unknown;
    let contextDocument: unknown;
    federation.setInboxListeners("/users/{identifier}/inbox").on(
      Follow,
      async (ctx: InboxContext<Record<string, never>>, follow: Follow) => {
        received = follow;
        document = (await ctx.documentLoader(localActorUrl)).document;
        contextDocument = (await ctx.contextLoader(localActorUrl)).document;
        await assertRejects(() => follow.getActor(), UrlError, "Localhost");
      },
    );
    const requests = await withActorFetch(async () => {
      await federation.receiveActivity(activity);
      const ctx = federation.createContext(new URL("https://example.com"), {});
      await ctx.documentLoader(localActorUrl);
      await ctx.contextLoader(localActorUrl);
    });
    assertEquals(requests, []);
    assertStrictEquals(received, activity);
    assertEquals(document, {});
    assertEquals(contextDocument, {});
  });
}

test("createContext allows private actor lookup", async () => {
  const federation = createNetworkFederation();
  const ctx = federation.createContext(new URL("https://example.com"), {});
  const activity = createLocalFollow();
  let actor: unknown;
  const requests = await withActorFetch(async () => {
    actor = await activity.getActor(ctx);
  });
  assertEquals(requests, [localActorUrl]);
  assertInstanceOf(actor, Person);
  assertEquals(actor.id?.href, localActorUrl);
});

test("receiveActivity preserves embedded objects and supports lookup with context", async () => {
  const federation = createNetworkFederation();
  const follow = createLocalFollow();
  // A different origin must not cause a trusted embedded object to be fetched.
  const activity = new Undo({
    id: new URL("https://example.com/activities/undo"),
    object: follow,
  });
  let embedded: unknown;
  let actor: unknown;
  federation.setInboxListeners("/users/{identifier}/inbox").on(
    Undo,
    async (ctx: InboxContext<Record<string, never>>, undo: Undo) => {
      const object = await undo.getObject();
      embedded = object;
      if (object instanceof Follow) actor = await object.getActor(ctx);
    },
  );
  const requests = await withActorFetch(() =>
    federation.receiveActivity(activity)
  );
  assertEquals(requests, [localActorUrl]);
  assertStrictEquals(embedded, follow);
  assertInstanceOf(actor, Person);
  assertEquals(actor.id?.href, localActorUrl);
});

test("receiveActivity respects an explicit getter document loader", async () => {
  const federation = createNetworkFederation();
  let actor: unknown;
  const loaderRequests: string[] = [];
  federation.setInboxListeners("/users/{identifier}/inbox").on(
    Follow,
    async (_ctx: InboxContext<Record<string, never>>, follow: Follow) => {
      actor = await follow.getActor({
        documentLoader: (url) => {
          loaderRequests.push(url);
          return Promise.resolve({
            contextUrl: null,
            documentUrl: url,
            document: {
              "@context": "https://www.w3.org/ns/activitystreams",
              id: url,
              type: "Person",
            },
          });
        },
      });
    },
  );
  const requests = await withActorFetch(() =>
    federation.receiveActivity(createLocalFollow())
  );
  assertEquals(requests, []);
  assertEquals(loaderRequests, [localActorUrl]);
  assertInstanceOf(actor, Person);
  assertEquals(actor.id?.href, localActorUrl);
});

test("receiveActivity preserves an unconfigured activity's own loaders", async () => {
  const federation = createFederation({ contextData: {} });
  const loader = getDocumentLoader({ allowPrivateAddress: true });
  const activity = createLocalFollow().clone({}, {
    documentLoader: loader,
    contextLoader: loader,
  });
  let actor: unknown;
  federation.setInboxListeners("/users/{identifier}/inbox").on(
    Follow,
    async (_ctx: InboxContext<Record<string, never>>, follow: Follow) => {
      actor = await follow.getActor();
    },
  );
  const requests = await withActorFetch(() =>
    federation.receiveActivity(activity)
  );
  assertEquals(requests, [localActorUrl]);
  assertInstanceOf(actor, Person);
});

test("receiveActivity does not clone without listeners or context data", async () => {
  const options = { contextData: undefined, allowPrivateAddress: true };
  const federation = createFederation(options);
  const activity = createLocalFollow();
  let clones = 0;
  activity.clone = () => {
    clones++;
    return activity;
  };
  const requests = await withActorFetch(async () => {
    await federation.receiveActivity(activity);
    federation.setInboxListeners("/users/{identifier}/inbox").on(
      Follow,
      () => Promise.resolve(),
    );
    await assertRejects(
      () => federation.receiveActivity(activity),
      Error,
      "contextData",
    );
  });
  assertEquals(requests, []);
  assertEquals(clones, 0);
});

test("receiveActivity preserves parsed JSON-LD extension properties", async () => {
  const federation = createNetworkFederation();
  const json = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: "http://localhost:9999/activities/follow",
    type: "Follow",
    actor: localActorUrl,
    object: "https://example.com/users/alice",
    "https://example.com/ns#custom": "preserved",
  };
  const activity = await Follow.fromJsonLd(json);
  let receivedJson: unknown;
  federation.setInboxListeners("/users/{identifier}/inbox").on(
    Follow,
    async (_ctx: InboxContext<Record<string, never>>, follow: Follow) => {
      receivedJson = await follow.toJsonLd();
    },
  );
  const requests = await withActorFetch(() =>
    federation.receiveActivity(activity)
  );
  assertEquals(requests, []);
  assertEquals(receivedJson, json);
  assertEquals(await activity.toJsonLd(), json);
});
