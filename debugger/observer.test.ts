import { assertEquals, assertExists } from "@std/assert";
import { DebugObserver } from "./observer.ts";
import type { Context } from "../fedify/federation/mod.ts";
import { Create, Note, Person } from "../fedify/vocab/mod.ts";

// Mock context for testing
function createMockContext(): Context<void> {
  return {
    data: undefined,
    documentLoader: async () => ({ document: {} }),
    contextLoader: async () => ({ document: {} }),
    getActor: async () => null,
    getObject: async () => null,
    getNodeInfoDispatcher: () => null,
    getActorDispatcher: () => null,
    getObjectDispatcher: () => null,
    getInboxListeners: () => ({ type: null }),
    getOutboxDispatcher: () => null,
    origin: "https://example.com",
    canonicalOrigin: "https://example.com",
    host: "example.com",
  } as unknown as Context<void>;
}

Deno.test("DebugObserver - captures inbound activities", async () => {
  const observer = new DebugObserver();
  const store = observer.getStore();

  const context = createMockContext();
  const activity = new Create({
    id: new URL("https://example.com/activity/1"),
    actor: new Person({
      id: new URL("https://alice.example/actor"),
    }),
    object: new Note({
      content: "Hello world!",
    }),
  });

  await observer.onInboundActivity(context, activity);

  const activities = store.getAll();
  assertEquals(activities.length, 1);

  const captured = activities[0];
  assertEquals(captured.direction, "inbound");
  assertEquals(captured.type, "https://www.w3.org/ns/activitystreams#Create");
  assertEquals(captured.activityId, "https://example.com/activity/1");
  assertEquals(captured.actor?.id, "https://alice.example/actor");
  assertExists(captured.rawActivity);
});

Deno.test("DebugObserver - captures outbound activities", async () => {
  const observer = new DebugObserver();
  const store = observer.getStore();

  const context = createMockContext();
  const activity = new Create({
    id: new URL("https://example.com/activity/2"),
    actor: new Person({
      id: new URL("https://bob.example/actor"),
    }),
    object: new Note({
      content: "Outbound message",
    }),
  });

  await observer.onOutboundActivity(context, activity);

  const activities = store.getAll();
  assertEquals(activities.length, 1);

  const captured = activities[0];
  assertEquals(captured.direction, "outbound");
  assertEquals(captured.type, "https://www.w3.org/ns/activitystreams#Create");
  assertEquals(captured.activityId, "https://example.com/activity/2");
});

Deno.test("DebugObserver - configuration options", () => {
  // Test default options
  const defaultObserver = new DebugObserver();
  assertEquals(defaultObserver.getPath(), "/__debugger__");
  assertEquals(defaultObserver.isProduction(), false);
  assertEquals(defaultObserver.getToken(), undefined);
  assertEquals(defaultObserver.getIpAllowlist(), undefined);

  // Test custom options
  const customObserver = new DebugObserver({
    path: "/debug",
    maxActivities: 500,
    production: true,
    token: "secret-token",
    ipAllowlist: ["127.0.0.1", "192.168.1.1"],
  });

  assertEquals(customObserver.getPath(), "/debug");
  assertEquals(customObserver.isProduction(), true);
  assertEquals(customObserver.getToken(), "secret-token");
  assertEquals(customObserver.getIpAllowlist(), ["127.0.0.1", "192.168.1.1"]);
});

Deno.test("DebugObserver - activity counter", async () => {
  const observer = new DebugObserver();
  const store = observer.getStore();
  const context = createMockContext();

  // Create multiple activities
  for (let i = 0; i < 3; i++) {
    const activity = new Create({
      id: new URL(`https://example.com/activity/${i}`),
      actor: new Person({
        id: new URL("https://alice.example/actor"),
      }),
      object: new Note({
        content: `Message ${i}`,
      }),
    });

    await observer.onInboundActivity(context, activity);
  }

  const activities = store.getAll();
  assertEquals(activities.length, 3);

  // Check that IDs are unique and sequential
  assertEquals(activities[0].id, "activity-1");
  assertEquals(activities[1].id, "activity-2");
  assertEquals(activities[2].id, "activity-3");
});
