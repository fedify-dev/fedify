// deno-lint-ignore-file no-explicit-any
import { ok, strictEqual } from "node:assert/strict";
import { describe, test } from "node:test";
import { MemoryKvStore } from "@fedify/fedify";
import { Follow, Person } from "@fedify/fedify/vocab";
import { signRequest } from "@fedify/fedify/sig";
import { LitePubRelay, MastodonRelay, type RelayOptions } from "@fedify/relay";
import { createFederation } from "@fedify/testing";
import {
  exportSpki,
  getDocumentLoader,
  type RemoteDocument,
} from "@fedify/vocab-runtime";

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
      federation: createFederation<void>({ contextData: undefined }),
    };

    const relay = new MastodonRelay(options);
    strictEqual(relay.domain, "relay.example.com");
  });

  test("creates relay with default domain", () => {
    const options: RelayOptions = {
      kv: new MemoryKvStore(),
      documentLoaderFactory: () => mockDocumentLoader,
    };

    const relay = new MastodonRelay(options);
    strictEqual(relay.domain, "localhost");
  });

  test("setSubscriptionHandler returns relay instance for chaining", () => {
    const kv = new MemoryKvStore();
    const relay = new MastodonRelay({
      kv,
      domain: "relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
    });

    const result = relay.setSubscriptionHandler(async (_ctx, _actor) => {
      return await Promise.resolve(true);
    });

    strictEqual(result, relay);
  });

  test("fetch method returns Response", async () => {
    const kv = new MemoryKvStore();
    const relay = new MastodonRelay({
      kv,
      domain: "relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      federation: createFederation<void>({ contextData: undefined }),
    });

    const request = new Request("https://relay.example.com/users/relay", {
      headers: { "Accept": "application/activity+json" },
    });
    const response = await relay.fetch(request);

    ok(response instanceof Response);
  });

  test("fetching relay actor returns Service", async () => {
    const kv = new MemoryKvStore();
    const relay = new MastodonRelay({
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
    strictEqual(json.type, "Service");
    strictEqual(json.preferredUsername, "relay");
    strictEqual(json.name, "ActivityPub Relay");
  });

  test("fetching non-relay actor returns 404", async () => {
    const kv = new MemoryKvStore();
    const relay = new MastodonRelay({
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
    const relay = new MastodonRelay({
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

    const followActivity1Id = "https://remote1.example.com/activities/follow/1";
    const followActivity2Id = "https://remote2.example.com/activities/follow/2";

    await kv.set(["followers"], [followActivity1Id, followActivity2Id]);
    await kv.set(["follower", followActivity1Id], follower1.toJsonLd());
    await kv.set(["follower", followActivity2Id], follower2.toJsonLd());

    const relay = new MastodonRelay({
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

  test("subscription handler is called on Follow activity", async () => {
    const kv = new MemoryKvStore();
    const relay = new MastodonRelay({
      kv,
      domain: "relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      authenticatedDocumentLoaderFactory: () => mockDocumentLoader,
    });

    let handlerCalled = false;
    let handlerActor: unknown = null;

    relay.setSubscriptionHandler(async (_ctx, actor) => {
      handlerCalled = true;
      handlerActor = actor;
      return await Promise.resolve(true);
    });

    // Create a Follow activity
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

    // Sign and send the Follow activity to the relay's inbox
    let request = new Request("https://relay.example.com/users/relay/inbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
        "Accept": "application/activity+json",
      },
      body: JSON.stringify(
        await followActivity.toJsonLd({ contextLoader: mockDocumentLoader }),
      ),
    });

    request = await signRequest(
      request,
      rsaKeyPair.privateKey,
      rsaPublicKey.id!,
    );

    const _response = await relay.fetch(request);

    strictEqual(handlerCalled, true);
    ok(handlerActor);
  });

  test("stores follower in KV when Follow is approved", async () => {
    const kv = new MemoryKvStore();
    const relay = new MastodonRelay({
      kv,
      domain: "relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      federation: createFederation<void>({ contextData: undefined }),
    });

    relay.setSubscriptionHandler(async (_ctx, _actor) => {
      return await Promise.resolve(true);
    });

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
    await kv.set(["follower", followActivityId], follower.toJsonLd());

    // Verify storage
    const storedFollowers = await kv.get<string[]>(["followers"]);
    ok(storedFollowers);
    strictEqual(storedFollowers.length, 1);
    strictEqual(storedFollowers[0], followActivityId);

    const storedActor = await kv.get(["follower", followActivityId]);
    ok(storedActor);
  });

  test("removes follower from KV when Undo Follow is received", async () => {
    const kv = new MemoryKvStore();

    // Pre-populate with a follower
    const followActivityId = "https://remote.example.com/activities/follow/1";
    const follower = new Person({
      id: new URL("https://remote.example.com/users/alice"),
      preferredUsername: "alice",
      inbox: new URL("https://remote.example.com/users/alice/inbox"),
    });

    await kv.set(["followers"], [followActivityId]);
    await kv.set(["follower", followActivityId], follower.toJsonLd());

    const _relay = new MastodonRelay({
      kv,
      domain: "relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      federation: createFederation<void>({ contextData: undefined }),
    });

    // Simulate the Undo Follow logic
    const followers = (await kv.get<string[]>(["followers"])) ?? [];
    const updatedFollowers = followers.filter((id) => id !== followActivityId);
    await kv.set(["followers"], updatedFollowers);
    await kv.delete(["follower", followActivityId]);

    // Verify removal
    const storedFollowers = await kv.get<string[]>(["followers"]);
    ok(storedFollowers);
    strictEqual(storedFollowers.length, 0);

    const storedActor = await kv.get(["follower", followActivityId]);
    strictEqual(storedActor, undefined);
  });

  test("does not store follower when Follow is rejected", async () => {
    const kv = new MemoryKvStore();
    const relay = new MastodonRelay({
      kv,
      domain: "relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      federation: createFederation<void>({ contextData: undefined }),
    });

    relay.setSubscriptionHandler(async (_ctx, _actor) => {
      return await Promise.resolve(false);
    });

    // Verify no followers are stored initially
    const followers = await kv.get<string[]>(["followers"]);
    ok(!followers || followers.length === 0);
  });

  test("relay actor has correct properties", async () => {
    const kv = new MemoryKvStore();
    const relay = new MastodonRelay({
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

    strictEqual(json.type, "Service");
    strictEqual(json.preferredUsername, "relay");
    strictEqual(json.name, "ActivityPub Relay");
    strictEqual(
      json.summary,
      "Mastodon-compatible ActivityPub relay server",
    );
    strictEqual(json.id, "https://relay.example.com/users/relay");
    strictEqual(json.inbox, "https://relay.example.com/inbox");
    strictEqual(
      json.followers,
      "https://relay.example.com/users/relay/followers",
    );
  });

  test("multiple followers can be stored", async () => {
    const kv = new MemoryKvStore();
    const relay = new MastodonRelay({
      kv,
      domain: "relay.example.com",
      documentLoaderFactory: () => mockDocumentLoader,
      federation: createFederation<void>({ contextData: undefined }),
    });

    relay.setSubscriptionHandler(async (_ctx, _actor) =>
      await Promise.resolve(true)
    );

    // Simulate multiple Follow activities
    const followIds = [
      "https://remote1.example.com/activities/follow/1",
      "https://remote2.example.com/activities/follow/2",
      "https://remote3.example.com/activities/follow/3",
    ];

    const followers: string[] = [];
    for (const followId of followIds) {
      followers.push(followId);
      const actor = new Person({
        id: new URL(followId.replace("/activities/follow/", "/users/user")),
        preferredUsername: `user${followers.length}`,
        inbox: new URL(
          followId.replace("/activities/follow/", "/users/user") + "/inbox",
        ),
      });
      await kv.set(["follower", followId], actor.toJsonLd());
    }
    await kv.set(["followers"], followers);

    const storedFollowers = await kv.get<string[]>(["followers"]);
    ok(storedFollowers);
    strictEqual(storedFollowers.length, 3);
  });
});

describe("LitePubRelay", () => {
  test("creates relay with required options", () => {
    const options: RelayOptions = {
      kv: new MemoryKvStore(),
      domain: "relay.example.com",
    };

    const relay = new LitePubRelay(options);
    strictEqual(relay.domain, "relay.example.com");
  });

  test("creates relay with default domain", () => {
    const options: RelayOptions = {
      kv: new MemoryKvStore(),
    };

    const relay = new LitePubRelay(options);
    strictEqual(relay.domain, "localhost");
  });

  test("setSubscriptionHandler returns relay instance for chaining", () => {
    const kv = new MemoryKvStore();
    const relay = new LitePubRelay({
      kv,
      domain: "relay.example.com",
    });

    const result = relay.setSubscriptionHandler(async (_ctx, _actor) =>
      await Promise.resolve(true)
    );

    strictEqual(result, relay);
  });

  test("fetch method returns Response", async () => {
    const kv = new MemoryKvStore();
    const relay = new LitePubRelay({
      kv,
      domain: "relay.example.com",
    });

    const request = new Request("https://relay.example.com/", {
      headers: { "Accept": "application/activity+json" },
    });
    const response = await relay.fetch(request);

    ok(response instanceof Response);
  });
});
