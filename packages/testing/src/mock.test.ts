import type { InboxContext } from "@fedify/fedify/federation";
import { test } from "@fedify/fixture";
import { Create, Note, Person } from "@fedify/vocab";
import { assertEquals, assertRejects } from "@std/assert";
import { createFederation } from "./mock.ts";

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
