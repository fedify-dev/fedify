import { mockDocumentLoader, test } from "@fedify/fixture";
import { type Activity, Create, Follow, Person } from "@fedify/vocab";
import { assertEquals } from "@std/assert";
import { signObject } from "../sig/proof.ts";
import {
  ed25519Multikey,
  ed25519PrivateKey,
  ed25519PublicKey,
} from "../testing/keys.ts";
import type { Federation, FederationOptions } from "./federation.ts";
import { MemoryKvStore } from "./kv.ts";
import { createFederation } from "./middleware.ts";

const kv = new MemoryKvStore();

const federationOptions: FederationOptions<void> = {
  kv,
  documentLoaderFactory: () => mockDocumentLoader,
  authenticatedDocumentLoaderFactory: () => mockDocumentLoader,
};

function createTestFederation(): Federation<void> {
  const federation = createFederation(federationOptions);
  federation
    .setActorDispatcher(
      "/users/{identifier}",
      (_, identifier) => identifier === "john" ? new Person({}) : null,
    )
    .setKeyPairsDispatcher(() => [{
      privateKey: ed25519PrivateKey,
      publicKey: ed25519PublicKey.publicKey!,
    }]);
  return federation;
}

test("Federation.setInboxListeners().withIdempotency() - per-origin strategy", async () => {
  const federation = createTestFederation();
  const processedActivities: [string | null, Activity][] = [];

  federation
    .setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .withIdempotency("per-origin") // Explicit per-origin strategy
    .on(Create, (ctx, activity) => {
      processedActivities.push([ctx.recipient, activity]);
    });

  const activity = new Create({
    id: new URL("https://example.com/activities/1"),
    actor: new URL("https://example.com/person2"),
  });
  const signedActivity = await signObject(
    activity,
    ed25519PrivateKey,
    ed25519Multikey.id!,
  );
  const body = JSON.stringify(
    await signedActivity.toJsonLd({ contextLoader: mockDocumentLoader }),
  );

  // Send to first inbox
  let response = await federation.fetch(
    new Request("https://example.com/users/john/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body,
    }),
    { contextData: undefined },
  );
  assertEquals(response.status, 202);
  assertEquals(processedActivities.length, 1);
  assertEquals(processedActivities[0][0], "john");

  // Send to second inbox with same activity ID - should be deduplicated (per-origin)
  response = await federation.fetch(
    new Request("https://example.com/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body,
    }),
    { contextData: undefined },
  );
  assertEquals(response.status, 202);
  assertEquals(processedActivities.length, 1); // Should still be 1, deduplicated

  // Clear KV to reset cache
  await kv.delete([
    "_fedify",
    "activityIdempotence",
    "https://example.com:https://example.com/activities/1",
  ]);
});

test("Federation.setInboxListeners().withIdempotency() - per-inbox strategy", async () => {
  const federation = createTestFederation();
  const processedActivities: [string | null, Activity][] = [];

  federation
    .setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .withIdempotency("per-inbox") // Per-inbox strategy
    .on(Create, (ctx, activity) => {
      processedActivities.push([ctx.recipient, activity]);
    });

  const activity = new Create({
    id: new URL("https://example.com/activities/2"),
    actor: new URL("https://example.com/person2"),
  });
  const signedActivity = await signObject(
    activity,
    ed25519PrivateKey,
    ed25519Multikey.id!,
  );
  const body = JSON.stringify(
    await signedActivity.toJsonLd({ contextLoader: mockDocumentLoader }),
  );

  // Send to first inbox
  let response = await federation.fetch(
    new Request("https://example.com/users/john/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body,
    }),
    { contextData: undefined },
  );
  assertEquals(response.status, 202);
  assertEquals(processedActivities.length, 1);
  assertEquals(processedActivities[0][0], "john");

  // Send to second inbox (shared) with same activity ID - should NOT be deduplicated
  response = await federation.fetch(
    new Request("https://example.com/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body,
    }),
    { contextData: undefined },
  );
  assertEquals(response.status, 202);
  assertEquals(processedActivities.length, 2); // Should be 2, not deduplicated
  assertEquals(processedActivities[1][0], null);

  // Send to same inbox again - should be deduplicated
  response = await federation.fetch(
    new Request("https://example.com/users/john/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body,
    }),
    { contextData: undefined },
  );
  assertEquals(response.status, 202);
  assertEquals(processedActivities.length, 2); // Should still be 2
});

test("Federation.setInboxListeners().withIdempotency() - global strategy", async () => {
  const federation = createTestFederation();
  const processedActivities: [string | null, Activity][] = [];

  federation
    .setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .withIdempotency("global") // Global strategy
    .on(Create, (ctx, activity) => {
      processedActivities.push([ctx.recipient, activity]);
    });

  const activity = new Create({
    id: new URL("https://example.com/activities/3"),
    actor: new URL("https://example.com/person2"),
  });
  const signedActivity = await signObject(
    activity,
    ed25519PrivateKey,
    ed25519Multikey.id!,
  );
  const body = JSON.stringify(
    await signedActivity.toJsonLd({ contextLoader: mockDocumentLoader }),
  );

  // Send to first inbox
  let response = await federation.fetch(
    new Request("https://example.com/users/john/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body,
    }),
    { contextData: undefined },
  );
  assertEquals(response.status, 202);
  assertEquals(processedActivities.length, 1);

  // Send to second inbox - should be deduplicated globally
  response = await federation.fetch(
    new Request("https://example.com/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body,
    }),
    { contextData: undefined },
  );
  assertEquals(response.status, 202);
  assertEquals(processedActivities.length, 1); // Should still be 1
});

test("Federation.setInboxListeners().withIdempotency() - custom callback", async () => {
  const federation = createTestFederation();
  const processedActivities: [string | null, Activity][] = [];

  federation
    .setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .withIdempotency((ctx, activity) => {
      // Skip idempotency for Follow activities
      if (activity instanceof Follow) return null;
      // Use per-inbox for other activities
      const inboxId = ctx.recipient ?? "shared";
      return `${ctx.origin}:${activity.id?.href}:${inboxId}`;
    })
    .on(Create, (ctx, activity) => {
      processedActivities.push([ctx.recipient, activity]);
    })
    .on(Follow, (ctx, activity) => {
      processedActivities.push([ctx.recipient, activity]);
    });

  // Test Create activity with idempotency
  const createActivity = new Create({
    id: new URL("https://example.com/activities/4"),
    actor: new URL("https://example.com/person2"),
  });
  const signedCreate = await signObject(
    createActivity,
    ed25519PrivateKey,
    ed25519Multikey.id!,
  );
  const createBody = JSON.stringify(
    await signedCreate.toJsonLd({ contextLoader: mockDocumentLoader }),
  );

  let response = await federation.fetch(
    new Request("https://example.com/users/john/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body: createBody,
    }),
    { contextData: undefined },
  );
  assertEquals(response.status, 202);
  assertEquals(processedActivities.length, 1);

  // Send Create again - should be deduplicated
  response = await federation.fetch(
    new Request("https://example.com/users/john/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body: createBody,
    }),
    { contextData: undefined },
  );
  assertEquals(response.status, 202);
  assertEquals(processedActivities.length, 1); // Still 1

  // Test Follow activity without idempotency (returns null)
  const followActivity = new Follow({
    id: new URL("https://example.com/activities/5"),
    actor: new URL("https://example.com/person2"),
  });
  const signedFollow = await signObject(
    followActivity,
    ed25519PrivateKey,
    ed25519Multikey.id!,
  );
  const followBody = JSON.stringify(
    await signedFollow.toJsonLd({ contextLoader: mockDocumentLoader }),
  );

  response = await federation.fetch(
    new Request("https://example.com/users/john/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body: followBody,
    }),
    { contextData: undefined },
  );
  assertEquals(response.status, 202);
  assertEquals(processedActivities.length, 2);

  // Send Follow again - should NOT be deduplicated (callback returns null)
  response = await federation.fetch(
    new Request("https://example.com/users/john/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body: followBody,
    }),
    { contextData: undefined },
  );
  assertEquals(response.status, 202);
  assertEquals(processedActivities.length, 3); // Should be 3, not deduplicated
});

test("Federation.setInboxListeners() - default strategy is per-inbox", async () => {
  const federation = createTestFederation();
  const processedActivities: [string | null, Activity][] = [];

  federation
    .setInboxListeners("/users/{identifier}/inbox", "/inbox")
    // No .withIdempotency() call - should default to "per-inbox"
    .on(Create, (ctx, activity) => {
      processedActivities.push([ctx.recipient, activity]);
    });

  const activity = new Create({
    id: new URL("https://example.com/activities/6"),
    actor: new URL("https://example.com/person2"),
  });
  const signedActivity = await signObject(
    activity,
    ed25519PrivateKey,
    ed25519Multikey.id!,
  );
  const body = JSON.stringify(
    await signedActivity.toJsonLd({ contextLoader: mockDocumentLoader }),
  );

  // Send to first inbox
  let response = await federation.fetch(
    new Request("https://example.com/users/john/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body,
    }),
    { contextData: undefined },
  );
  assertEquals(response.status, 202);
  assertEquals(processedActivities.length, 1);
  assertEquals(processedActivities[0][0], "john");

  // Send to second inbox (shared) with same activity ID - should NOT be deduplicated (per-inbox behavior)
  response = await federation.fetch(
    new Request("https://example.com/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body,
    }),
    { contextData: undefined },
  );
  assertEquals(response.status, 202);
  assertEquals(processedActivities.length, 2); // Should be 2, not deduplicated
  assertEquals(processedActivities[1][0], null);

  // Send to same inbox again - should be deduplicated (per-inbox behavior)
  response = await federation.fetch(
    new Request("https://example.com/users/john/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body,
    }),
    { contextData: undefined },
  );
  assertEquals(response.status, 202);
  assertEquals(processedActivities.length, 2); // Should still be 2
});
