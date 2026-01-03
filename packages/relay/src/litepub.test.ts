// deno-lint-ignore-file no-explicit-any
import { MemoryKvStore, signRequest } from "@fedify/fedify";
import { createRelay, type RelayOptions } from "@fedify/relay";
import {
  Accept,
  Announce,
  Create,
  Delete,
  Follow,
  Move,
  Note,
  Person,
  Undo,
  Update,
} from "@fedify/vocab";
import {
  exportSpki,
  getDocumentLoader,
  type RemoteDocument,
} from "@fedify/vocab-runtime";
import { ok, strictEqual } from "node:assert";
import test, { describe } from "node:test";
import { isRelayFollowerData } from "./types.ts";

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

describe("LitePubRelay", () => {
  test("constructor with required options", () => {
    const options: RelayOptions = {
      kv: new MemoryKvStore(),
      origin: "https://relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      subscriptionHandler: async (_ctx, _actor) => {
        return await Promise.resolve(true);
      },
    };

    const relay = createRelay("litepub", options);
    ok(relay);
  });

  test("fetch method returns Response", async () => {
    const kv = new MemoryKvStore();
    const relay = createRelay("litepub", {
      kv,
      origin: "https://relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      subscriptionHandler: () => Promise.resolve(true),
    });

    const request = new Request("https://relay.example.com/users/relay", {
      headers: { "Accept": "application/activity+json" },
    });
    const response = await relay.fetch(request);

    ok(response instanceof Response);
  });

  test("fetching relay actor returns Application", async () => {
    const kv = new MemoryKvStore();
    const relay = createRelay("litepub", {
      kv,
      origin: "https://relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      subscriptionHandler: () => Promise.resolve(true),
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
    const relay = createRelay("litepub", {
      kv,
      origin: "https://relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      subscriptionHandler: () => Promise.resolve(true),
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
    const relay = createRelay("litepub", {
      kv,
      origin: "https://relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      subscriptionHandler: () => Promise.resolve(true),
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

    await kv.set(
      ["follower", follower1Id],
      { actor: await follower1.toJsonLd(), state: "accepted" },
    );
    await kv.set(
      ["follower", follower2Id],
      { actor: await follower2.toJsonLd(), state: "accepted" },
    );

    const relay = createRelay("litepub", {
      kv,
      origin: "https://relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      subscriptionHandler: () => Promise.resolve(true),
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
    if (json.totalItems !== undefined) {
      strictEqual(json.totalItems, 2);
    }
  });

  test("relay actor has correct properties", async () => {
    const kv = new MemoryKvStore();
    const relay = createRelay("litepub", {
      kv,
      origin: "https://relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      subscriptionHandler: () => Promise.resolve(true),
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

  test("handles Follow activity with subscription approval", async () => {
    const kv = new MemoryKvStore();
    let handlerCalled = false;
    let handlerActor: any = null;

    const relay = createRelay("litepub", {
      kv,
      origin: "https://relay.example.com",
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

    // Verify follower was stored with "pending" state (awaiting reciprocal Accept)
    const followerData = await kv.get([
      "follower",
      "https://remote.example.com/users/alice",
    ]);
    ok(isRelayFollowerData(followerData));
    strictEqual(followerData.state, "pending");
  });

  test("handles Follow activity with subscription rejection", async () => {
    const kv = new MemoryKvStore();

    const relay = createRelay("litepub", {
      kv,
      origin: "https://relay.example.com",
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
    const followerData = await kv.get([
      "follower",
      "https://remote.example.com/users/alice",
    ]);
    strictEqual(followerData, undefined);
  });

  test("handles public Follow activity", async () => {
    const kv = new MemoryKvStore();

    const relay = createRelay("litepub", {
      kv,
      origin: "https://relay.example.com",
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

    // Verify follower was stored with "pending" state
    const followerData = await kv.get([
      "follower",
      "https://remote.example.com/users/alice",
    ]);
    ok(isRelayFollowerData(followerData));
    strictEqual(followerData.state, "pending");
  });

  test("ignores Follow activity without required fields", async () => {
    const kv = new MemoryKvStore();

    const relay = createRelay("litepub", {
      kv,
      origin: "https://relay.example.com",
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
    const followerData = await kv.get([
      "follower",
      "https://remote.example.com/users/alice",
    ]);
    strictEqual(followerData, undefined);
  });

  test("ignores duplicate Follow activity from pending follower", async () => {
    const kv = new MemoryKvStore();
    let handlerCallCount = 0;

    const relay = createRelay("litepub", {
      kv,
      origin: "https://relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      authenticatedDocumentLoaderFactory: () => mockDocumentLoader,
      subscriptionHandler: async (_ctx, _actor) => {
        handlerCallCount++;
        return await Promise.resolve(true);
      },
    });

    const follower = new Person({
      id: new URL("https://remote.example.com/users/alice"),
      preferredUsername: "alice",
      inbox: new URL("https://remote.example.com/users/alice/inbox"),
    });

    // Pre-populate with pending follower
    await kv.set(
      ["follower", "https://remote.example.com/users/alice"],
      { actor: await follower.toJsonLd(), state: "pending" },
    );

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

    // Verify handler was NOT called (duplicate follow ignored)
    strictEqual(handlerCallCount, 0);
  });

  test("handles Accept activity completing reciprocal follow", async () => {
    const kv = new MemoryKvStore();

    const follower = new Person({
      id: new URL("https://remote.example.com/users/alice"),
      preferredUsername: "alice",
      inbox: new URL("https://remote.example.com/users/alice/inbox"),
    });

    // Pre-populate with pending follower
    await kv.set(
      ["follower", "https://remote.example.com/users/alice"],
      { actor: await follower.toJsonLd(), state: "pending" },
    );

    const relay = createRelay("litepub", {
      kv,
      origin: "https://relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      authenticatedDocumentLoaderFactory: () => mockDocumentLoader,
      subscriptionHandler: () => Promise.resolve(true),
    });

    const relayFollow = new Follow({
      id: new URL("https://relay.example.com/activities/follow/1"),
      actor: new URL("https://relay.example.com/users/relay"),
      object: new URL("https://remote.example.com/users/alice"),
    });

    const acceptActivity = new Accept({
      id: new URL("https://remote.example.com/activities/accept/1"),
      actor: new URL("https://remote.example.com/users/alice"),
      object: relayFollow,
    });

    let request = new Request("https://relay.example.com/inbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
      },
      body: JSON.stringify(
        await acceptActivity.toJsonLd({ contextLoader: mockDocumentLoader }),
      ),
    });

    request = await signRequest(
      request,
      rsaKeyPair.privateKey,
      rsaPublicKey.id,
    );

    await relay.fetch(request);

    // Verify follower state changed to "accepted"
    const followerData = await kv.get([
      "follower",
      "https://remote.example.com/users/alice",
    ]);
    ok(isRelayFollowerData(followerData));
    strictEqual(followerData.state, "accepted");
  });

  test("handles Undo Follow activity", async () => {
    const kv = new MemoryKvStore();

    // Pre-populate with an accepted follower
    const followerId = "https://remote.example.com/users/alice";
    const follower = new Person({
      id: new URL(followerId),
      preferredUsername: "alice",
      inbox: new URL("https://remote.example.com/users/alice/inbox"),
    });

    await kv.set(
      ["follower", followerId],
      { actor: await follower.toJsonLd(), state: "accepted" },
    );

    const relay = createRelay("litepub", {
      kv,
      origin: "https://relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      authenticatedDocumentLoaderFactory: () => mockDocumentLoader,
      subscriptionHandler: () => Promise.resolve(true),
    });

    const originalFollow = new Follow({
      id: new URL("https://remote.example.com/activities/follow/1"),
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
    const followerData = await kv.get(["follower", followerId]);
    strictEqual(followerData, undefined);
  });

  test("handles Create activity with Announce forwarding", async () => {
    const kv = new MemoryKvStore();

    // Pre-populate with a follower
    const followerId = "https://remote.example.com/users/alice";
    const follower = new Person({
      id: new URL(followerId),
      preferredUsername: "alice",
      inbox: new URL("https://remote.example.com/users/alice/inbox"),
    });

    await kv.set(
      ["follower", followerId],
      { actor: await follower.toJsonLd(), state: "accepted" },
    );

    const relay = createRelay("litepub", {
      kv,
      origin: "https://relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      authenticatedDocumentLoaderFactory: () => mockDocumentLoader,
      subscriptionHandler: () => Promise.resolve(true),
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

  test("handles Update activity with Announce forwarding", async () => {
    const kv = new MemoryKvStore();

    const relay = createRelay("litepub", {
      kv,
      origin: "https://relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      authenticatedDocumentLoaderFactory: () => mockDocumentLoader,
      subscriptionHandler: () => Promise.resolve(true),
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

  test("handles Move activity with Announce forwarding", async () => {
    const kv = new MemoryKvStore();

    const relay = createRelay("litepub", {
      kv,
      origin: "https://relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      authenticatedDocumentLoaderFactory: () => mockDocumentLoader,
      subscriptionHandler: () => Promise.resolve(true),
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

  test("handles Delete activity with Announce forwarding", async () => {
    const kv = new MemoryKvStore();

    const relay = createRelay("litepub", {
      kv,
      origin: "https://relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      authenticatedDocumentLoaderFactory: () => mockDocumentLoader,
      subscriptionHandler: () => Promise.resolve(true),
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

  test("handles Announce activity forwarding", async () => {
    const kv = new MemoryKvStore();

    const relay = createRelay("litepub", {
      kv,
      origin: "https://relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      authenticatedDocumentLoaderFactory: () => mockDocumentLoader,
      subscriptionHandler: () => Promise.resolve(true),
    });

    const announceActivity = new Announce({
      id: new URL("https://remote.example.com/activities/announce/1"),
      actor: new URL("https://remote.example.com/users/alice"),
      object: new URL("https://remote.example.com/notes/1"),
    });

    let request = new Request("https://relay.example.com/inbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
      },
      body: JSON.stringify(
        await announceActivity.toJsonLd({ contextLoader: mockDocumentLoader }),
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

  test("multiple followers can be stored", async () => {
    const kv = new MemoryKvStore();

    // Simulate multiple accepted followers
    const followerIds = [
      "https://remote1.example.com/users/user1",
      "https://remote2.example.com/users/user2",
      "https://remote3.example.com/users/user3",
    ];

    for (let i = 0; i < followerIds.length; i++) {
      const followerId = followerIds[i];
      const actor = new Person({
        id: new URL(followerId),
        preferredUsername: `user${i + 1}`,
        inbox: new URL(`${followerId}/inbox`),
      });
      await kv.set(
        ["follower", followerId],
        { actor: await actor.toJsonLd(), state: "accepted" },
      );
    }

    // Verify all followers are stored
    let count = 0;
    for await (const _ of kv.list(["follower"])) {
      count++;
    }
    strictEqual(count, 3);
  });

  test("list() returns empty when no followers exist", async () => {
    const kv = new MemoryKvStore();

    // Verify list is initially empty
    let count = 0;
    for await (const _ of kv.list(["follower"])) {
      count++;
    }
    strictEqual(count, 0);
  });

  test("list() returns all followers after additions", async () => {
    const kv = new MemoryKvStore();

    // Add multiple followers
    const followerIds = [
      "https://server1.example.com/users/alice",
      "https://server2.example.com/users/bob",
      "https://server3.example.com/users/carol",
    ];

    for (const followerId of followerIds) {
      const actor = new Person({
        id: new URL(followerId),
        preferredUsername: followerId.split("/").pop(),
        inbox: new URL(`${followerId}/inbox`),
      });
      await kv.set(
        ["follower", followerId],
        { actor: await actor.toJsonLd(), state: "accepted" },
      );
    }

    // Verify list returns all followers
    const retrievedIds: string[] = [];
    for await (const { key, value } of kv.list(["follower"])) {
      strictEqual(key.length, 2);
      strictEqual(key[0], "follower");
      retrievedIds.push(key[1] as string);
      ok(isRelayFollowerData(value));
      strictEqual(value.state, "accepted");
    }

    strictEqual(retrievedIds.length, 3);
    for (const id of followerIds) {
      ok(retrievedIds.includes(id));
    }
  });

  test("list() excludes followers after deletion", async () => {
    const kv = new MemoryKvStore();

    // Add three followers
    const follower1Id = "https://server1.example.com/users/alice";
    const follower2Id = "https://server2.example.com/users/bob";
    const follower3Id = "https://server3.example.com/users/carol";

    for (const followerId of [follower1Id, follower2Id, follower3Id]) {
      const actor = new Person({
        id: new URL(followerId),
        preferredUsername: followerId.split("/").pop(),
        inbox: new URL(`${followerId}/inbox`),
      });
      await kv.set(
        ["follower", followerId],
        { actor: await actor.toJsonLd(), state: "accepted" },
      );
    }

    // Delete one follower
    await kv.delete(["follower", follower2Id]);

    // Verify list only returns remaining followers
    const retrievedIds: string[] = [];
    for await (const { key } of kv.list(["follower"])) {
      retrievedIds.push(key[1] as string);
    }

    strictEqual(retrievedIds.length, 2);
    ok(retrievedIds.includes(follower1Id));
    ok(!retrievedIds.includes(follower2Id)); // Deleted follower not in list
    ok(retrievedIds.includes(follower3Id));
  });

  test("list() distinguishes between pending and accepted followers", async () => {
    const kv = new MemoryKvStore();

    // Add followers with different states
    const pendingFollowerId = "https://server1.example.com/users/alice";
    const acceptedFollowerId = "https://server2.example.com/users/bob";

    const pendingFollower = new Person({
      id: new URL(pendingFollowerId),
      preferredUsername: "alice",
      inbox: new URL("https://server1.example.com/users/alice/inbox"),
    });

    const acceptedFollower = new Person({
      id: new URL(acceptedFollowerId),
      preferredUsername: "bob",
      inbox: new URL("https://server2.example.com/users/bob/inbox"),
    });

    await kv.set(
      ["follower", pendingFollowerId],
      { actor: await pendingFollower.toJsonLd(), state: "pending" },
    );

    await kv.set(
      ["follower", acceptedFollowerId],
      { actor: await acceptedFollower.toJsonLd(), state: "accepted" },
    );

    // Verify list returns both with correct states
    const followers: { id: string; state: string }[] = [];
    for await (const { key, value } of kv.list(["follower"])) {
      if (!isRelayFollowerData(value)) continue;
      followers.push({
        id: key[1] as string,
        state: value.state,
      });
    }

    strictEqual(followers.length, 2);

    const pendingEntry = followers.find((f) => f.id === pendingFollowerId);
    ok(pendingEntry);
    strictEqual(pendingEntry.state, "pending");

    const acceptedEntry = followers.find((f) => f.id === acceptedFollowerId);
    ok(acceptedEntry);
    strictEqual(acceptedEntry.state, "accepted");
  });

  test("list() returns correct actor data", async () => {
    const kv = new MemoryKvStore();

    const followerId = "https://remote.example.com/users/alice";
    const follower = new Person({
      id: new URL(followerId),
      preferredUsername: "alice",
      name: "Alice Wonderland",
      inbox: new URL("https://remote.example.com/users/alice/inbox"),
    });

    await kv.set(
      ["follower", followerId],
      { actor: await follower.toJsonLd(), state: "accepted" },
    );

    // Verify list returns complete actor data
    for await (const { key, value } of kv.list(["follower"])) {
      strictEqual(key[1], followerId);
      ok(isRelayFollowerData(value));
      strictEqual(value.state, "accepted");
      ok(value.actor && typeof value.actor === "object");
      const actor = value.actor as Record<string, unknown>;
      strictEqual(actor.preferredUsername, "alice");
      strictEqual(actor.name, "Alice Wonderland");
    }
  });
});
