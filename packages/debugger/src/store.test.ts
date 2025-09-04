import { assertEquals, assertNotEquals } from "@std/assert";
import { delay } from "@std/async";
import { ActivityStore } from "../src/store.ts";
import type { DebugActivity } from "./types.ts";

function createMockActivity(
  overrides: Partial<DebugActivity> = {},
): DebugActivity {
  return {
    id: `activity-${Math.random()}`,
    timestamp: new Date(),
    direction: "inbound",
    type: "Create",
    activityId: `https://example.com/activity/${Math.random()}`,
    rawActivity: { type: "Create" },
    ...overrides,
  };
}

Deno.test("ActivityStore - basic operations", () => {
  const store = new ActivityStore(5);

  // Test insert and get
  const activity1 = createMockActivity({ id: "act-1" });
  store.insert(activity1);

  const retrieved = store.get("act-1");
  assertEquals(retrieved, activity1);

  // Test getAll
  const activity2 = createMockActivity({ id: "act-2" });
  store.insert(activity2);

  const all = store.getAll();
  assertEquals(all.length, 2);
  assertEquals(all[0], activity1);
  assertEquals(all[1], activity2);
});

Deno.test("ActivityStore - circular buffer behavior", () => {
  const store = new ActivityStore(3);

  // Fill the buffer
  const activities = Array.from(
    { length: 5 },
    (_, i) => createMockActivity({ id: `act-${i}` }),
  );

  for (const activity of activities) {
    store.insert(activity);
  }

  // Should only have the last 3 activities
  const all = store.getAll();
  assertEquals(all.length, 3);
  assertEquals(all[0].id, "act-2");
  assertEquals(all[1].id, "act-3");
  assertEquals(all[2].id, "act-4");

  // First two should be evicted
  assertEquals(store.get("act-0"), null);
  assertEquals(store.get("act-1"), null);
  assertNotEquals(store.get("act-2"), null);
});

Deno.test("ActivityStore - search with filters", () => {
  const store = new ActivityStore(10);

  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  // Add various activities
  store.insert(createMockActivity({
    id: "act-1",
    type: "Create",
    direction: "inbound",
    timestamp: twoHoursAgo,
    actor: { id: "https://alice.example", type: "Person" },
  }));

  store.insert(createMockActivity({
    id: "act-2",
    type: "Follow",
    direction: "outbound",
    timestamp: hourAgo,
    actor: { id: "https://bob.example", type: "Person" },
    signature: { present: true, verified: true },
  }));

  store.insert(createMockActivity({
    id: "act-3",
    type: "Create",
    direction: "inbound",
    timestamp: now,
    actor: { id: "https://alice.example", type: "Person" },
    signature: { present: true, verified: false },
  }));

  // Test type filter
  const creates = store.search({ types: ["Create"] });
  assertEquals(creates.length, 2);

  // Test direction filter
  const inbound = store.search({ direction: ["inbound"] });
  assertEquals(inbound.length, 2);

  // Test time range filter
  const recent = store.search({ startTime: hourAgo });
  assertEquals(recent.length, 2);

  // Test actor filter
  const aliceActivities = store.search({ actors: ["https://alice.example"] });
  assertEquals(aliceActivities.length, 2);

  // Test signature status filter
  const verified = store.search({ signatureStatus: "verified" });
  assertEquals(verified.length, 1);
  assertEquals(verified[0].id, "act-2");

  // Test combined filters
  const combined = store.search({
    types: ["Create"],
    direction: ["inbound"],
    startTime: hourAgo,
  });
  assertEquals(combined.length, 1);
  assertEquals(combined[0].id, "act-3");

  // Test sorting
  const sortedAsc = store.search({ sortOrder: "asc" });
  assertEquals(sortedAsc[0].id, "act-1");
  assertEquals(sortedAsc[sortedAsc.length - 1].id, "act-3");

  // Test pagination
  const paginated = store.search({ limit: 2, offset: 1 });
  assertEquals(paginated.length, 2);
  assertEquals(paginated[0].id, "act-2");
});

Deno.test("ActivityStore - text search", () => {
  const store = new ActivityStore(10);

  store.insert(createMockActivity({
    id: "act-1",
    activityId: "https://example.com/note/123",
    actor: {
      id: "https://alice.example",
      type: "Person",
      name: "Alice Smith",
      preferredUsername: "alice",
    },
    object: {
      type: "Note",
      content: "Hello world from Alice!",
      summary: "A greeting",
    },
  }));

  store.insert(createMockActivity({
    id: "act-2",
    type: "Follow",
    actor: {
      id: "https://bob.example",
      type: "Person",
      name: "Bob Jones",
      preferredUsername: "bobby",
    },
  }));

  // Search by actor name
  const aliceResults = store.searchText("alice");
  assertEquals(aliceResults.length, 1);
  assertEquals(aliceResults[0].id, "act-1");

  // Search by content
  const helloResults = store.searchText("hello");
  assertEquals(helloResults.length, 1);

  // Search by type
  const followResults = store.searchText("follow");
  assertEquals(followResults.length, 1);
  assertEquals(followResults[0].id, "act-2");

  // Search by username
  const bobbyResults = store.searchText("bobby");
  assertEquals(bobbyResults.length, 1);
});

Deno.test("ActivityStore - statistics", () => {
  const store = new ActivityStore(10);

  // Add various activities
  store.insert(createMockActivity({
    type: "Create",
    direction: "inbound",
    signature: { present: true, verified: true },
  }));

  store.insert(createMockActivity({
    type: "Create",
    direction: "outbound",
  }));

  store.insert(createMockActivity({
    type: "Follow",
    direction: "inbound",
    signature: { present: true, verified: false },
  }));

  store.insert(createMockActivity({
    type: "Like",
    direction: "inbound",
    signature: { present: true, verified: true },
  }));

  const stats = store.getStats();

  assertEquals(stats.totalActivities, 4);
  assertEquals(stats.inboundActivities, 3);
  assertEquals(stats.outboundActivities, 1);
  assertEquals(stats.activityTypes["Create"], 2);
  assertEquals(stats.activityTypes["Follow"], 1);
  assertEquals(stats.activityTypes["Like"], 1);
  assertEquals(stats.signatureStats.verified, 2);
  assertEquals(stats.signatureStats.failed, 1);
  assertEquals(stats.signatureStats.none, 1);
});

Deno.test("ActivityStore - subscriptions", async () => {
  const store = new ActivityStore(5);
  const received: DebugActivity[] = [];

  // Subscribe to new activities
  const unsubscribe = store.subscribe((activity) => {
    received.push(activity);
  });

  // Insert some activities
  const activity1 = createMockActivity({ id: "sub-1" });
  const activity2 = createMockActivity({ id: "sub-2" });

  store.insert(activity1);
  store.insert(activity2);

  // Allow async processing
  await delay(10);

  assertEquals(received.length, 2);
  assertEquals(received[0], activity1);
  assertEquals(received[1], activity2);

  // Unsubscribe and insert another
  unsubscribe();
  store.insert(createMockActivity({ id: "sub-3" }));

  await delay(10);

  // Should still be 2
  assertEquals(received.length, 2);
});

Deno.test("ActivityStore - clear", () => {
  const store = new ActivityStore(5);

  // Add some activities
  store.insert(createMockActivity({ id: "clear-1" }));
  store.insert(createMockActivity({ id: "clear-2" }));

  assertEquals(store.getAll().length, 2);
  assertNotEquals(store.get("clear-1"), null);

  // Clear the store
  store.clear();

  assertEquals(store.getAll().length, 0);
  assertEquals(store.get("clear-1"), null);
  assertEquals(store.get("clear-2"), null);

  // Should work normally after clear
  store.insert(createMockActivity({ id: "clear-3" }));
  assertEquals(store.getAll().length, 1);
});
