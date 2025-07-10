import { assertEquals } from "@std/assert";
import { test } from "./mod.ts";
import { MockFederation } from "./mock.ts";
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
  const mockFederation = new MockFederation<void>({ contextData: undefined });
  let receivedActivity: Create | null = null;

  // Set up an inbox listener
  mockFederation
    .setInboxListeners("/users/{identifier}/inbox")
    .on(Create, async (ctx, activity) => {
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

test("Check the interface is implemented properly", () => {
  const mockFederation = new MockFederation<void>();

  assertEquals(typeof mockFederation.setNodeInfoDispatcher, "function");
  assertEquals(typeof mockFederation.setActorDispatcher, "function");
  assertEquals(typeof mockFederation.setObjectDispatcher, "function");
  assertEquals(typeof mockFederation.setInboxDispatcher, "function");
  assertEquals(typeof mockFederation.setOutboxDispatcher, "function");
  assertEquals(typeof mockFederation.setInboxListeners, "function");
  assertEquals(typeof mockFederation.startQueue, "function");
  assertEquals(typeof mockFederation.createContext, "function");
  assertEquals(typeof mockFederation.fetch, "function");
});
