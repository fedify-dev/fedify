import { assertEquals, assertExists } from "@std/assert";
import { ActivityStore } from "./store.ts";
import type { DebugActivity } from "./interceptor.ts";

// Helper function to create test activities
function createTestActivity(
  overrides?: Partial<DebugActivity>,
): DebugActivity {
  return {
    id: "test-1",
    timestamp: new Date(),
    direction: "inbound",
    type: "Create",
    activityId: "https://example.com/activities/1",
    rawActivity: { type: "Create" },
    ...overrides,
  };
}

Deno.test("ActivityStore should create an instance with default capacity", () => {
  const store = new ActivityStore();
  assertExists(store);
});

Deno.test("ActivityStore should create an instance with custom capacity", () => {
  const store = new ActivityStore(500);
  assertExists(store);
});

Deno.test("ActivityStore should insert activities", () => {
  const store = new ActivityStore();
  const activity = createTestActivity();

  store.insert(activity);

  const retrieved = store.get(activity.id);
  assertExists(retrieved);
  assertEquals(retrieved.id, activity.id);
});

Deno.test("ActivityStore should retrieve activity by ID", () => {
  const store = new ActivityStore();
  const activity1 = createTestActivity({ id: "test-1" });
  const activity2 = createTestActivity({ id: "test-2" });

  store.insert(activity1);
  store.insert(activity2);

  const retrieved = store.get("test-2");
  assertExists(retrieved);
  assertEquals(retrieved.id, "test-2");
});

Deno.test("ActivityStore should return null for non-existent ID", () => {
  const store = new ActivityStore();
  const activity = createTestActivity();

  store.insert(activity);

  const retrieved = store.get("non-existent");
  assertEquals(retrieved, null);
});

Deno.test("ActivityStore should implement circular buffer", () => {
  const store = new ActivityStore(3); // Small capacity for testing

  const activity1 = createTestActivity({ id: "test-1" });
  const activity2 = createTestActivity({ id: "test-2" });
  const activity3 = createTestActivity({ id: "test-3" });
  const activity4 = createTestActivity({ id: "test-4" });

  store.insert(activity1);
  store.insert(activity2);
  store.insert(activity3);
  store.insert(activity4); // Should evict activity1

  assertEquals(store.get("test-1"), null); // Evicted
  assertExists(store.get("test-2"));
  assertExists(store.get("test-3"));
  assertExists(store.get("test-4"));
});

Deno.test("ActivityStore should get all activities", () => {
  const store = new ActivityStore();

  const activity1 = createTestActivity({ id: "test-1" });
  const activity2 = createTestActivity({ id: "test-2" });
  const activity3 = createTestActivity({ id: "test-3" });

  store.insert(activity1);
  store.insert(activity2);
  store.insert(activity3);

  const all = store.getAll();
  assertEquals(all.length, 3);
  assertEquals(all[0].id, "test-1");
  assertEquals(all[1].id, "test-2");
  assertEquals(all[2].id, "test-3");
});

Deno.test("ActivityStore should clear all activities", () => {
  const store = new ActivityStore();

  store.insert(createTestActivity({ id: "test-1" }));
  store.insert(createTestActivity({ id: "test-2" }));

  store.clear();

  assertEquals(store.getAll().length, 0);
  assertEquals(store.get("test-1"), null);
  assertEquals(store.get("test-2"), null);
});

Deno.test("ActivityStore should get store statistics", () => {
  const store = new ActivityStore(100);

  store.insert(createTestActivity({ id: "test-1", direction: "inbound" }));
  store.insert(createTestActivity({ id: "test-2", direction: "outbound" }));
  store.insert(createTestActivity({ id: "test-3", direction: "inbound" }));

  const stats = store.getStats();
  assertEquals(stats.totalActivities, 3);
  assertEquals(stats.capacity, 100);
  assertEquals(stats.inboundCount, 2);
  assertEquals(stats.outboundCount, 1);
});

Deno.test("ActivityStore should support subscribe/unsubscribe", () => {
  const store = new ActivityStore();
  const receivedActivities: DebugActivity[] = [];

  const unsubscribe = store.subscribe((activity) => {
    receivedActivities.push(activity);
  });

  const activity1 = createTestActivity({ id: "test-1" });
  store.insert(activity1);

  assertEquals(receivedActivities.length, 1);
  assertEquals(receivedActivities[0].id, "test-1");

  unsubscribe();

  const activity2 = createTestActivity({ id: "test-2" });
  store.insert(activity2);

  assertEquals(receivedActivities.length, 1); // Should not receive activity2
});

Deno.test("ActivityStore should handle multiple subscribers", () => {
  const store = new ActivityStore();
  const subscriber1Activities: DebugActivity[] = [];
  const subscriber2Activities: DebugActivity[] = [];

  store.subscribe((activity) => {
    subscriber1Activities.push(activity);
  });

  store.subscribe((activity) => {
    subscriber2Activities.push(activity);
  });

  const activity = createTestActivity();
  store.insert(activity);

  assertEquals(subscriber1Activities.length, 1);
  assertEquals(subscriber2Activities.length, 1);
});

Deno.test("ActivityStore should filter by direction", () => {
  const store = new ActivityStore();

  store.insert(createTestActivity({ id: "test-1", direction: "inbound" }));
  store.insert(createTestActivity({ id: "test-2", direction: "outbound" }));
  store.insert(createTestActivity({ id: "test-3", direction: "inbound" }));

  const inbound = store.search({ direction: ["inbound"] });
  assertEquals(inbound.length, 2);
  assertEquals(inbound[0].id, "test-1");
  assertEquals(inbound[1].id, "test-3");

  const outbound = store.search({ direction: ["outbound"] });
  assertEquals(outbound.length, 1);
  assertEquals(outbound[0].id, "test-2");
});

Deno.test("ActivityStore should filter by type", () => {
  const store = new ActivityStore();

  store.insert(createTestActivity({ id: "test-1", type: "Create" }));
  store.insert(createTestActivity({ id: "test-2", type: "Follow" }));
  store.insert(createTestActivity({ id: "test-3", type: "Create" }));
  store.insert(createTestActivity({ id: "test-4", type: "Like" }));

  const creates = store.search({ types: ["Create"] });
  assertEquals(creates.length, 2);

  const multiple = store.search({ types: ["Follow", "Like"] });
  assertEquals(multiple.length, 2);
});

Deno.test("ActivityStore should filter by time range", () => {
  const store = new ActivityStore();

  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  store.insert(createTestActivity({
    id: "test-1",
    timestamp: twoHoursAgo,
  }));
  store.insert(createTestActivity({
    id: "test-2",
    timestamp: hourAgo,
  }));
  store.insert(createTestActivity({
    id: "test-3",
    timestamp: now,
  }));

  const recent = store.search({
    startTime: new Date(now.getTime() - 90 * 60 * 1000), // 1.5 hours ago
  });
  assertEquals(recent.length, 2);
  assertEquals(recent[0].id, "test-2");
  assertEquals(recent[1].id, "test-3");
});

Deno.test("ActivityStore should combine multiple filters", () => {
  const store = new ActivityStore();

  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  store.insert(createTestActivity({
    id: "test-1",
    type: "Create",
    direction: "inbound",
    timestamp: hourAgo,
  }));
  store.insert(createTestActivity({
    id: "test-2",
    type: "Follow",
    direction: "inbound",
    timestamp: now,
  }));
  store.insert(createTestActivity({
    id: "test-3",
    type: "Create",
    direction: "outbound",
    timestamp: now,
  }));

  const filtered = store.search({
    types: ["Create"],
    direction: ["inbound"],
    startTime: hourAgo,
  });

  assertEquals(filtered.length, 1);
  assertEquals(filtered[0].id, "test-1");
});
