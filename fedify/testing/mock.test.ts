import { assertEquals, assertRejects } from "@std/assert";
import { test } from "./mod.ts";
import { MockContext, MockFederation } from "./mock.ts";
import { Create, Note } from "../vocab/vocab.ts";
import { Person } from "../vocab/vocab.ts";

test("getSentActivities returns sent activities", async () => {
  const mockFederation = new MockFederation<void>();
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
  const sentActivities = mockFederation.getSentActivities();
  assertEquals(sentActivities.length, 1);
  assertEquals(sentActivities[0], activity);
});

test("clearSentActivities clears sent activities", async () => {
  const mockFederation = new MockFederation<void>();
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
  assertEquals(mockFederation.getSentActivities().length, 1);

  // Clear sent activities
  mockFederation.clearSentActivities();

  // Verify they were cleared
  assertEquals(mockFederation.getSentActivities().length, 0);
});

test("receiveActivity triggers inbox listeners", async () => {
  // Provide contextData through constructor
  const mockFederation = new MockFederation<{ test: string }>({
    contextData: { test: "data" },
  });
  let receivedActivity: Create | null = null;

  // Set up an inbox listener
  mockFederation
    .setInboxListeners("/users/{identifier}/inbox")
    .on(Create, async (_ctx, activity) => {
      receivedActivity = activity;
    });

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
  const mockFederation = new MockFederation<void>();
  const mockContext = new MockContext({
    url: new URL("https://example.com"),
    data: undefined,
    federation: mockFederation,
  });

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

  // Check that the activity was recorded in the context
  const contextSentActivities = mockContext.getSentActivities();
  assertEquals(contextSentActivities.length, 1);
  assertEquals(contextSentActivities[0].activity, activity);

  // Check that it was also recorded in the federation
  const federationSentActivities = mockFederation.getSentActivities();
  assertEquals(federationSentActivities.length, 1);
  assertEquals(federationSentActivities[0], activity);
});

test("MockContext URI methods should work correctly", () => {
  const mockFederation = new MockFederation<void>();
  const mockContext = new MockContext({
    url: new URL("https://example.com"),
    data: undefined,
    federation: mockFederation,
  });

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

test("receiveActivity throws error when contextData not initialized", async () => {
  const mockFederation = new MockFederation<void>();

  // Set up an inbox listener without initializing contextData
  mockFederation
    .setInboxListeners("/users/{identifier}/inbox")
    .on(Create, async (_ctx, _activity) => {
      /* should not happen */
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
  const mockFederation = new MockFederation<void>();

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
  const sentDetails = mockFederation.getSentActivityDetails();
  const sentActivities = mockFederation.getSentActivities();

  assertEquals(sentActivities.length, 2);
  assertEquals(sentActivities[0], activity1);
  assertEquals(sentActivities[1], activity2);

  // Both should be marked as sent via queue
  assertEquals(sentDetails.length, 2);
  assertEquals(sentDetails[0].sentVia, "queue");
  assertEquals(sentDetails[1].sentVia, "queue");
  assertEquals(sentDetails[0].queueType, "outbox");
  assertEquals(sentDetails[1].queueType, "outbox");
});

test("MockFederation without queue sends all activities immediately", async () => {
  const mockFederation = new MockFederation<void>();
  // Do NOT start the queue - activities should be sent immediately

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
  const sentDetails = mockFederation.getSentActivityDetails();
  const sentActivities = mockFederation.getSentActivities();

  assertEquals(sentActivities.length, 1);
  assertEquals(sentActivities[0], activity);

  // Should be marked as sent immediately
  assertEquals(sentDetails.length, 1);
  assertEquals(sentDetails[0].sentVia, "immediate");
  assertEquals(sentDetails[0].queueType, undefined);
});
