import { assertEquals } from "@std/assert";
import { ActivityInterceptor } from "./interceptor.ts";
import { ActivityStore } from "./store.ts";
import { DebugServer } from "./server.ts";
import type { Activity } from "@fedify/fedify";
import type { DebugActivity } from "./interceptor.ts";
import {
  createMockActivity,
  createMockContext,
  createMockCreateActivity,
  createMockFollowActivity,
} from "./mock.ts";

Deno.test("Basic integration test", () => {
  // Test that all components can be instantiated
  const interceptor = new ActivityInterceptor();
  const store = new ActivityStore(100);

  assertEquals(typeof interceptor.start, "function");
  assertEquals(typeof interceptor.stop, "function");
  assertEquals(typeof interceptor.subscribe, "function");

  assertEquals(typeof store.insert, "function");
  assertEquals(typeof store.get, "function");
  assertEquals(typeof store.getAll, "function");

  const server = new DebugServer({
    port: 8080,
    interceptor,
    store,
  });

  assertEquals(typeof server.start, "function");
  assertEquals(typeof server.stop, "function");
});

Deno.test("Activity flow test", () => {
  const interceptor = new ActivityInterceptor();
  const store = new ActivityStore(10);
  let capturedActivity: DebugActivity | null = null;

  // Subscribe store to interceptor
  interceptor.subscribe((activity) => {
    capturedActivity = activity;
    store.insert(activity);
  });

  interceptor.start();

  // Create mock activity and context
  const mockContext = createMockContext();
  const mockActivity = createMockFollowActivity(
    "https://example.com/activity/1",
    "https://example.com/users/alice",
    "https://example.com/users/bob",
  );

  // Capture as inbound
  interceptor.captureInbound(mockContext, mockActivity);

  // Verify captured
  assertEquals(capturedActivity?.direction, "inbound");
  assertEquals(capturedActivity?.type, "Follow");
  assertEquals(store.getAll().length, 1);

  // Capture as outbound
  interceptor.captureOutbound(mockContext, mockActivity);
  assertEquals(store.getAll().length, 2);

  const stats = store.getStats();
  assertEquals(stats.totalActivities, 2);
  assertEquals(stats.inboundCount, 1);
  assertEquals(stats.outboundCount, 1);

  interceptor.stop();
});

Deno.test("Demo simulation test - multiple activity types", () => {
  const interceptor = new ActivityInterceptor();
  const store = new ActivityStore(100);
  const capturedActivities: DebugActivity[] = [];

  // Subscribe to interceptor
  interceptor.subscribe((activity) => {
    capturedActivities.push(activity);
    store.insert(activity);
  });

  interceptor.start();

  // Test data from demo.ts
  const activityTypes = [
    "Create",
    "Follow",
    "Like",
    "Announce",
    "Update",
    "Delete",
  ];
  const actors = [
    "https://example.com/users/alice",
    "https://social.example/users/bob",
    "https://mastodon.social/@carol",
  ];

  // Simulate activities like in demo.ts
  const mockContext = createMockContext();
  let activityCount = 0;

  for (let i = 0; i < 10; i++) {
    const type = activityTypes[i % activityTypes.length];
    const actor = actors[i % actors.length];
    const direction = i % 2 === 0 ? "inbound" : "outbound";

    let mockActivity: Activity;

    if (type === "Create") {
      mockActivity = createMockCreateActivity(
        `https://example.com/activities/${++activityCount}`,
        actor,
        `Test message ${activityCount}`,
      );
    } else if (type === "Follow") {
      mockActivity = createMockFollowActivity(
        `https://example.com/activities/${++activityCount}`,
        actor,
        actors[Math.floor(Math.random() * actors.length)],
      );
    } else {
      mockActivity = createMockActivity(
        type,
        `https://example.com/activities/${++activityCount}`,
        actor,
      );
    }

    if (direction === "inbound") {
      interceptor.captureInbound(mockContext, mockActivity);
    } else {
      interceptor.captureOutbound(mockContext, mockActivity);
    }
  }

  // Verify results
  assertEquals(capturedActivities.length, 10);
  assertEquals(store.getAll().length, 10);

  const stats = store.getStats();
  assertEquals(stats.totalActivities, 10);
  assertEquals(stats.inboundCount, 5);
  assertEquals(stats.outboundCount, 5);

  // Verify activity types are captured correctly
  const createActivities = capturedActivities.filter((a) =>
    a.type === "Create"
  );
  const followActivities = capturedActivities.filter((a) =>
    a.type === "Follow"
  );

  assertEquals(createActivities.length >= 1, true);
  assertEquals(followActivities.length >= 1, true);

  // Verify Create activities have object with Note
  const createWithNote = createActivities.find((a) => {
    const raw = a.rawActivity as Record<string, unknown>;
    const obj = raw?.object as Record<string, unknown> | undefined;
    return obj?.type === "Note";
  });
  assertEquals(createWithNote !== undefined, true);

  // Verify Follow activities have object
  const followWithObject = followActivities.find((a) => {
    const raw = a.rawActivity as Record<string, unknown>;
    return raw?.object !== undefined;
  });
  assertEquals(followWithObject !== undefined, true);

  interceptor.stop();
});

Deno.test("Server integration with demo components", () => {
  const interceptor = new ActivityInterceptor();
  const store = new ActivityStore(50);

  // Connect interceptor to store like in demo
  interceptor.subscribe((activity) => {
    store.insert(activity);
  });

  interceptor.start();

  // Add some test data before starting server
  const mockContext = createMockContext();

  const testActivities = [
    createMockCreateActivity(
      "https://example.com/activities/test1",
      "https://example.com/users/test",
      "Test note for server",
    ),
    createMockFollowActivity(
      "https://example.com/activities/test2",
      "https://example.com/users/test2",
      "https://example.com/users/test",
    ),
  ];

  testActivities.forEach((activity, index) => {
    if (index % 2 === 0) {
      interceptor.captureInbound(mockContext, activity);
    } else {
      interceptor.captureOutbound(mockContext, activity);
    }
  });

  // Verify data is stored
  assertEquals(store.getAll().length, 2);

  // Create server with components
  const server = new DebugServer({
    port: 0, // Use 0 for random port in tests
    interceptor,
    store,
  });

  // Verify server can be created with the connected components
  assertEquals(typeof server.start, "function");
  assertEquals(typeof server.stop, "function");

  interceptor.stop();
});
