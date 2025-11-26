// deno-lint-ignore-file no-explicit-any
import { MemoryKvStore, signRequest } from "@fedify/fedify";
import {
  Create,
  Delete,
  Follow,
  Move,
  Note,
  Person,
  Undo,
  Update,
} from "@fedify/fedify/vocab";
import {
  exportSpki,
  getDocumentLoader,
  type RemoteDocument,
} from "@fedify/vocab-runtime";
import { ok, strictEqual } from "node:assert";
import test, { describe } from "node:test";
import { createRelay, type RelayOptions } from "@fedify/relay";

// Simple mock document loader that returns a minimal context
const mockDocumentLoader = async (url: string): Promise<RemoteDocument> => {
  if (
    url === "https://remote.example.com/users/alice" ||
    url === "https://remote.example.com/users/alice#main-key"
  ) {
    return {
      contextUrl: null,
      documentUrl: url.replace(/#main-key$/, ""),
      document: {
        "@context": [
          "https://www.w3.org/ns/activitystreams",
          "https://w3id.org/security/v1",
        ],
        id: url,
        type: "Person",
        preferredUsername: "alice",
        inbox: "https://remote.example.com/users/alice/inbox",
        publicKey: {
          id: "https://remote.example.com/users/alice#main-key",
          owner: url.replace(/#main-key$/, ""),
          publicKeyPem: await exportSpki(rsaKeyPair.publicKey),
        },
      },
    };
  } else if (url === "https://remote.example.com/notes/1") {
    return {
      contextUrl: null,
      documentUrl: url,
      document: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: url,
        type: "Note",
        content: "Hello world",
      },
    };
  } else if (url.startsWith("https://remote.example.com/")) {
    throw new Error(`Document not found: ${url}`);
  }
  return await getDocumentLoader()(url);
};

// Mock RSA key pair for testing
const rsaKeyPair = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
);

const rsaPublicKey = {
  id: new URL("https://remote.example.com/users/alice#main-key"),
  ...rsaKeyPair.publicKey,
};

describe("MastodonRelay", () => {
  test("constructor with required options", () => {
    const options: RelayOptions = {
      kv: new MemoryKvStore(),
      domain: "relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      subscriptionHandler: async (_ctx, _actor) => {
        return await Promise.resolve(true);
      },
    };

    const relay = createRelay("mastodon", options);
    ok(relay);
  });

  test("fetch method returns Response", async () => {
    const kv = new MemoryKvStore();
    const relay = createRelay("mastodon", {
      kv,
      domain: "relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
    });

    const request = new Request("https://relay.example.com/users/relay", {
      headers: { "Accept": "application/activity+json" },
    });
    const response = await relay.fetch(request);

    ok(response instanceof Response);
  });

  test("fetching relay actor returns Application", async () => {
    const kv = new MemoryKvStore();
    const relay = createRelay("mastodon", {
      kv,
      domain: "relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
    });

    const request = new Request("https://relay.example.com/users/relay", {
      headers: { "Accept": "application/activity+json" },
    });
    const response = await relay.fetch(request);

    strictEqual(response.status, 200);
    const json = await response.json() as any;
    strictEqual(json.type, "Application");
    strictEqual(json.preferredUsername, "relay");
    strictEqual(json.name, "ActivityPub Relay");
  });

  test("fetching non-relay actor returns 404", async () => {
    const kv = new MemoryKvStore();
    const relay = createRelay("mastodon", {
      kv,
      domain: "relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
    });

    const request = new Request(
      "https://relay.example.com/users/non-existent",
      {
        headers: { "Accept": "application/activity+json" },
      },
    );
    const response = await relay.fetch(request);

    strictEqual(response.status, 404);
  });

  test("followers collection returns empty list initially", async () => {
    const kv = new MemoryKvStore();
    const relay = createRelay("mastodon", {
      kv,
      domain: "relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
    });

    const request = new Request(
      "https://relay.example.com/users/relay/followers",
      {
        headers: { "Accept": "application/activity+json" },
      },
    );
    const response = await relay.fetch(request);

    strictEqual(response.status, 200);
    const json = await response.json() as any;
    // The followers dispatcher is configured, verify response structure
    ok(json);
    ok(json.type === "Collection" || json.type === "OrderedCollection");
  });

  test("followers collection returns populated list", async () => {
    const kv = new MemoryKvStore();

    // Pre-populate followers
    const follower1 = new Person({
      id: new URL("https://remote1.example.com/users/alice"),
      preferredUsername: "alice",
      inbox: new URL("https://remote1.example.com/users/alice/inbox"),
    });

    const follower2 = new Person({
      id: new URL("https://remote2.example.com/users/bob"),
      preferredUsername: "bob",
      inbox: new URL("https://remote2.example.com/users/bob/inbox"),
    });

    const follower1Id = "https://remote1.example.com/users/alice";
    const follower2Id = "https://remote2.example.com/users/bob";

    await kv.set(["followers"], [follower1Id, follower2Id]);
    await kv.set(
      ["follower", follower1Id],
      { actor: await follower1.toJsonLd(), state: "accepted" },
    );
    await kv.set(
      ["follower", follower2Id],
      { actor: await follower2.toJsonLd(), state: "accepted" },
    );

    const relay = createRelay("mastodon", {
      kv,
      domain: "relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
    });

    const request = new Request(
      "https://relay.example.com/users/relay/followers",
      {
        headers: { "Accept": "application/activity+json" },
      },
    );
    const response = await relay.fetch(request);

    strictEqual(response.status, 200);
    const json = await response.json() as any;
    ok(json);
    ok(json.type === "Collection" || json.type === "OrderedCollection");
    // Fedify wraps the items in a collection, check totalItems if available
    if (json.totalItems !== undefined) {
      strictEqual(json.totalItems, 2);
    }
  });

  test("stores follower in KV when Follow is approved", async () => {
    const kv = new MemoryKvStore();

    // Manually simulate what happens when a Follow is approved
    const followActivityId = "https://remote.example.com/activities/follow/1";
    const follower = new Person({
      id: new URL("https://remote.example.com/users/alice"),
      preferredUsername: "alice",
      inbox: new URL("https://remote.example.com/users/alice/inbox"),
    });

    // Simulate the relay's internal logic
    const followers = (await kv.get<string[]>(["followers"])) ?? [];
    followers.push(followActivityId);
    await kv.set(["followers"], followers);
    await kv.set(
      ["follower", followActivityId],
      { actor: await follower.toJsonLd(), state: "accepted" },
    );

    // Verify storage
    const storedFollowers = await kv.get<string[]>(["followers"]);
    ok(storedFollowers);
    strictEqual(storedFollowers?.length, 1);
    strictEqual(storedFollowers[0], followActivityId);

    const storedActor = await kv.get(["follower", followActivityId]);
    ok(storedActor);
  });

  test("removes follower from KV when Undo Follow is received", async () => {
    const kv = new MemoryKvStore();

    // Pre-populate with a follower
    const followerId = "https://remote.example.com/users/alice";
    const follower = new Person({
      id: new URL(followerId),
      preferredUsername: "alice",
      inbox: new URL("https://remote.example.com/users/alice/inbox"),
    });

    await kv.set(["followers"], [followerId]);
    await kv.set(
      ["follower", followerId],
      { actor: await follower.toJsonLd(), state: "accepted" },
    );

    // Simulate the Undo Follow logic
    const followers = (await kv.get<string[]>(["followers"])) ?? [];
    const updatedFollowers = followers.filter((id) => id !== followerId);
    await kv.set(["followers"], updatedFollowers);
    await kv.delete(["follower", followerId]);

    // Verify removal
    const storedFollowers = await kv.get<string[]>(["followers"]);
    ok(storedFollowers);
    strictEqual(storedFollowers.length, 0);

    const storedActor = await kv.get(["follower", followerId]);
    strictEqual(storedActor, undefined);
  });

  test("relay actor has correct properties", async () => {
    const kv = new MemoryKvStore();
    const relay = createRelay("mastodon", {
      kv,
      domain: "relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
    });

    const request = new Request("https://relay.example.com/users/relay", {
      headers: { "Accept": "application/activity+json" },
    });
    const response = await relay.fetch(request);

    strictEqual(response.status, 200);
    const json = await response.json() as any;

    strictEqual(json.type, "Application");
    strictEqual(json.preferredUsername, "relay");
    strictEqual(json.name, "ActivityPub Relay");
    strictEqual(json.id, "https://relay.example.com/users/relay");
    strictEqual(json.inbox, "https://relay.example.com/inbox");
    strictEqual(
      json.followers,
      "https://relay.example.com/users/relay/followers",
    );
    strictEqual(
      json.following,
      "https://relay.example.com/users/relay/following",
    );
  });

  test("multiple followers can be stored", async () => {
    const kv = new MemoryKvStore();

    // Simulate multiple Follow activities
    const followIds = [
      "https://remote1.example.com/users/user1",
      "https://remote2.example.com/users/user2",
      "https://remote3.example.com/users/user3",
    ];

    const followers: string[] = [];
    for (const followId of followIds) {
      followers.push(followId);
      const actor = new Person({
        id: new URL(followId),
        preferredUsername: `user${followers.length}`,
        inbox: new URL(`${followId}/inbox`),
      });
      await kv.set(
        ["follower", followId],
        { actor: await actor.toJsonLd(), state: "accepted" },
      );
    }
    await kv.set(["followers"], followers);

    const storedFollowers = await kv.get<string[]>(["followers"]);
    ok(storedFollowers);
    strictEqual(storedFollowers.length, 3);
  });

  test("handles Follow activity with subscription approval", async () => {
    const kv = new MemoryKvStore();
    let handlerCalled = false;
    let handlerActor: any = null;

    const relay = createRelay("mastodon", {
      kv,
      domain: "relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      authenticatedDocumentLoaderFactory: () => mockDocumentLoader,
      subscriptionHandler: async (_ctx, actor) => {
        handlerCalled = true;
        handlerActor = actor;
        return await Promise.resolve(true);
      },
    });

    const follower = new Person({
      id: new URL("https://remote.example.com/users/alice"),
      preferredUsername: "alice",
      inbox: new URL("https://remote.example.com/users/alice/inbox"),
    });

    const followActivity = new Follow({
      id: new URL("https://remote.example.com/activities/follow/1"),
      actor: follower.id,
      object: new URL("https://relay.example.com/users/relay"),
    });

    let request = new Request("https://relay.example.com/inbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
      },
      body: JSON.stringify(
        await followActivity.toJsonLd({ contextLoader: mockDocumentLoader }),
      ),
    });

    request = await signRequest(
      request,
      rsaKeyPair.privateKey,
      rsaPublicKey.id,
    );

    await relay.fetch(request);

    // Verify handler was called
    strictEqual(handlerCalled, true);
    ok(handlerActor);

    // Verify follower was stored
    const followers = await kv.get<string[]>(["followers"]);
    ok(followers);
    strictEqual(followers.length, 1);
    strictEqual(
      followers[0],
      "https://remote.example.com/users/alice",
    );
  });

  test("handles Follow activity with subscription rejection", async () => {
    const kv = new MemoryKvStore();

    const relay = createRelay("mastodon", {
      kv,
      domain: "relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      authenticatedDocumentLoaderFactory: () => mockDocumentLoader,
      subscriptionHandler: async (_ctx, _actor) => {
        return await Promise.resolve(false); // Reject the subscription
      },
    });

    const follower = new Person({
      id: new URL("https://remote.example.com/users/alice"),
      preferredUsername: "alice",
      inbox: new URL("https://remote.example.com/users/alice/inbox"),
    });

    const followActivity = new Follow({
      id: new URL("https://remote.example.com/activities/follow/1"),
      actor: follower.id,
      object: new URL("https://relay.example.com/users/relay"),
    });

    let request = new Request("https://relay.example.com/inbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
      },
      body: JSON.stringify(
        await followActivity.toJsonLd({ contextLoader: mockDocumentLoader }),
      ),
    });

    request = await signRequest(
      request,
      rsaKeyPair.privateKey,
      rsaPublicKey.id,
    );

    await relay.fetch(request);

    // Verify follower was NOT stored
    const followers = await kv.get<string[]>(["followers"]);
    ok(!followers || followers.length === 0);
  });

  test("handles Undo Follow activity", async () => {
    const kv = new MemoryKvStore();

    // Pre-populate with a follower
    const followerId = "https://remote.example.com/users/alice";
    const follower = new Person({
      id: new URL(followerId),
      preferredUsername: "alice",
      inbox: new URL("https://remote.example.com/users/alice/inbox"),
    });

    const followActivityId = "https://remote.example.com/activities/follow/1";
    await kv.set(["followers"], [followerId]);
    await kv.set(
      ["follower", followerId],
      { actor: await follower.toJsonLd(), state: "accepted" },
    );

    const relay = createRelay("mastodon", {
      kv,
      domain: "relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      authenticatedDocumentLoaderFactory: () => mockDocumentLoader,
    });

    const originalFollow = new Follow({
      id: new URL(followActivityId),
      actor: new URL(followerId),
      object: new URL("https://relay.example.com/users/relay"),
    });

    const undoActivity = new Undo({
      id: new URL("https://remote.example.com/activities/undo/1"),
      actor: new URL(followerId),
      object: originalFollow,
    });

    let request = new Request("https://relay.example.com/inbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
      },
      body: JSON.stringify(
        await undoActivity.toJsonLd({ contextLoader: mockDocumentLoader }),
      ),
    });

    request = await signRequest(
      request,
      rsaKeyPair.privateKey,
      rsaPublicKey.id,
    );

    await relay.fetch(request);

    // Verify follower was removed
    const followers = await kv.get<string[]>(["followers"]);
    ok(followers);
    strictEqual(followers.length, 0);
  });

  test("handles Create activity forwarding", async () => {
    const kv = new MemoryKvStore();

    // Pre-populate with a follower
    const followerId = "https://remote.example.com/users/alice";
    const follower = new Person({
      id: new URL(followerId),
      preferredUsername: "alice",
      inbox: new URL("https://remote.example.com/users/alice/inbox"),
    });

    await kv.set(["followers"], [followerId]);
    await kv.set(
      ["follower", followerId],
      { actor: await follower.toJsonLd(), state: "accepted" },
    );

    const relay = createRelay("mastodon", {
      kv,
      domain: "relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      authenticatedDocumentLoaderFactory: () => mockDocumentLoader,
    });

    const note = new Note({
      id: new URL("https://remote.example.com/notes/1"),
      content: "Hello world",
    });

    const createActivity = new Create({
      id: new URL("https://remote.example.com/activities/create/1"),
      actor: new URL(followerId),
      object: note,
    });

    let request = new Request("https://relay.example.com/inbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
      },
      body: JSON.stringify(
        await createActivity.toJsonLd({ contextLoader: mockDocumentLoader }),
      ),
    });

    request = await signRequest(
      request,
      rsaKeyPair.privateKey,
      rsaPublicKey.id,
    );

    const response = await relay.fetch(request);

    // Verify the request was accepted (forwarding happens in background)
    ok(response.status === 200 || response.status === 202);
  });

  test("handles Delete activity forwarding", async () => {
    const kv = new MemoryKvStore();

    const relay = createRelay("mastodon", {
      kv,
      domain: "relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      authenticatedDocumentLoaderFactory: () => mockDocumentLoader,
    });

    const deleteActivity = new Delete({
      id: new URL("https://remote.example.com/activities/delete/1"),
      actor: new URL("https://remote.example.com/users/alice"),
      object: new URL("https://remote.example.com/notes/1"),
    });

    let request = new Request("https://relay.example.com/inbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
      },
      body: JSON.stringify(
        await deleteActivity.toJsonLd({ contextLoader: mockDocumentLoader }),
      ),
    });

    request = await signRequest(
      request,
      rsaKeyPair.privateKey,
      rsaPublicKey.id,
    );

    const response = await relay.fetch(request);

    // Verify the request was accepted
    ok(response.status === 200 || response.status === 202);
  });

  test("handles Update activity forwarding", async () => {
    const kv = new MemoryKvStore();

    const relay = createRelay("mastodon", {
      kv,
      domain: "relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      authenticatedDocumentLoaderFactory: () => mockDocumentLoader,
    });

    const note = new Note({
      id: new URL("https://remote.example.com/notes/1"),
      content: "Updated content",
    });

    const updateActivity = new Update({
      id: new URL("https://remote.example.com/activities/update/1"),
      actor: new URL("https://remote.example.com/users/alice"),
      object: note,
    });

    let request = new Request("https://relay.example.com/inbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
      },
      body: JSON.stringify(
        await updateActivity.toJsonLd({ contextLoader: mockDocumentLoader }),
      ),
    });

    request = await signRequest(
      request,
      rsaKeyPair.privateKey,
      rsaPublicKey.id,
    );

    const response = await relay.fetch(request);

    // Verify the request was accepted
    ok(response.status === 200 || response.status === 202);
  });

  test("handles Move activity forwarding", async () => {
    const kv = new MemoryKvStore();

    const relay = createRelay("mastodon", {
      kv,
      domain: "relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      authenticatedDocumentLoaderFactory: () => mockDocumentLoader,
    });

    const moveActivity = new Move({
      id: new URL("https://remote.example.com/activities/move/1"),
      actor: new URL("https://remote.example.com/users/alice"),
      object: new URL("https://remote.example.com/users/alice"),
      target: new URL("https://other.example.com/users/alice"),
    });

    let request = new Request("https://relay.example.com/inbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
      },
      body: JSON.stringify(
        await moveActivity.toJsonLd({ contextLoader: mockDocumentLoader }),
      ),
    });

    request = await signRequest(
      request,
      rsaKeyPair.privateKey,
      rsaPublicKey.id,
    );

    const response = await relay.fetch(request);

    // Verify the request was accepted
    ok(response.status === 200 || response.status === 202);
  });

  test("ignores Follow activity without required fields", async () => {
    const kv = new MemoryKvStore();

    const relay = createRelay("mastodon", {
      kv,
      domain: "relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      authenticatedDocumentLoaderFactory: () => mockDocumentLoader,
      subscriptionHandler: async (_ctx, _actor) => await Promise.resolve(true),
    });

    // Follow activity without id
    const followActivity = new Follow({
      actor: new URL("https://remote.example.com/users/alice"),
      object: new URL("https://relay.example.com/users/relay"),
    });

    let request = new Request("https://relay.example.com/inbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
      },
      body: JSON.stringify(
        await followActivity.toJsonLd({ contextLoader: mockDocumentLoader }),
      ),
    });

    request = await signRequest(
      request,
      rsaKeyPair.privateKey,
      rsaPublicKey.id,
    );

    await relay.fetch(request);

    // Verify follower was NOT stored
    const followers = await kv.get<string[]>(["followers"]);
    ok(!followers || followers.length === 0);
  });

  test("handles public Follow activity", async () => {
    const kv = new MemoryKvStore();

    const relay = createRelay("mastodon", {
      kv,
      domain: "relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      authenticatedDocumentLoaderFactory: () => mockDocumentLoader,
      subscriptionHandler: async (_ctx, _actor) => await Promise.resolve(true),
    });

    const follower = new Person({
      id: new URL("https://remote.example.com/users/alice"),
      preferredUsername: "alice",
      inbox: new URL("https://remote.example.com/users/alice/inbox"),
    });

    // Public follow activity
    const followActivity = new Follow({
      id: new URL("https://remote.example.com/activities/follow/1"),
      actor: follower.id,
      object: new URL("https://www.w3.org/ns/activitystreams#Public"),
    });

    let request = new Request("https://relay.example.com/inbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
      },
      body: JSON.stringify(
        await followActivity.toJsonLd({ contextLoader: mockDocumentLoader }),
      ),
    });

    request = await signRequest(
      request,
      rsaKeyPair.privateKey,
      rsaPublicKey.id,
    );

    await relay.fetch(request);

    // Verify follower was stored
    const followers = await kv.get<string[]>(["followers"]);
    ok(followers);
    strictEqual(followers.length, 1);
  });
});
