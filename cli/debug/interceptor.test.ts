import { assertEquals, assertExists } from "@std/assert";
import type { Activity, Context } from "@fedify/fedify";
import { ActivityInterceptor, type DebugActivity } from "./interceptor.ts";

// Define a minimal context data type for testing
type TestContextData = Record<string, unknown>;

Deno.test("DebugActivity interface should have required fields", () => {
  const activity: DebugActivity = {
    id: "test-123",
    timestamp: new Date(),
    direction: "inbound",
    type: "Create",
    activityId: "https://example.com/activities/1",
    rawActivity: { type: "Create" },
  };

  assertEquals(activity.id, "test-123");
  assertEquals(activity.direction, "inbound");
  assertEquals(activity.type, "Create");
  assertExists(activity.timestamp);
  assertExists(activity.rawActivity);
});

Deno.test("ActivityInterceptor should create an instance", () => {
  const interceptor = new ActivityInterceptor();
  assertExists(interceptor);
});

Deno.test("ActivityInterceptor should start and stop", () => {
  const interceptor = new ActivityInterceptor();

  // Should not throw
  interceptor.start();
  interceptor.stop();
});

Deno.test("ActivityInterceptor should capture inbound activities", () => {
  const interceptor = new ActivityInterceptor();
  interceptor.start();

  const capturedActivities: DebugActivity[] = [];
  interceptor.subscribe((activity) => {
    capturedActivities.push(activity);
  });

  // Mock activity
  const mockActivity = {
    id: "https://example.com/activities/1",
    type: "Create",
  } as unknown as Activity;

  // Mock context
  const mockContext = {} as Context<TestContextData>;

  interceptor.captureInbound(mockContext, mockActivity);

  assertEquals(capturedActivities.length, 1);
  assertEquals(capturedActivities[0].direction, "inbound");
  assertEquals(capturedActivities[0].type, "Create");
  assertEquals(
    capturedActivities[0].activityId,
    "https://example.com/activities/1",
  );

  interceptor.stop();
});

Deno.test("ActivityInterceptor should capture outbound activities", () => {
  const interceptor = new ActivityInterceptor();
  interceptor.start();

  const capturedActivities: DebugActivity[] = [];
  interceptor.subscribe((activity) => {
    capturedActivities.push(activity);
  });

  // Mock activity
  const mockActivity = {
    id: "https://example.com/activities/2",
    type: "Follow",
  } as unknown as Activity;

  // Mock context
  const mockContext = {} as Context<TestContextData>;

  interceptor.captureOutbound(mockContext, mockActivity);

  assertEquals(capturedActivities.length, 1);
  assertEquals(capturedActivities[0].direction, "outbound");
  assertEquals(capturedActivities[0].type, "Follow");
  assertEquals(
    capturedActivities[0].activityId,
    "https://example.com/activities/2",
  );

  interceptor.stop();
});

Deno.test("ActivityInterceptor should handle activities without ID", () => {
  const interceptor = new ActivityInterceptor();
  interceptor.start();

  const capturedActivities: DebugActivity[] = [];
  interceptor.subscribe((activity) => {
    capturedActivities.push(activity);
  });

  // Mock activity without ID
  const mockActivity = {
    type: "Like",
  } as unknown as Activity;

  const mockContext = {} as Context<TestContextData>;

  interceptor.captureInbound(mockContext, mockActivity);

  assertEquals(capturedActivities.length, 1);
  assertEquals(capturedActivities[0].type, "Like");
  assertEquals(capturedActivities[0].activityId, undefined);

  interceptor.stop();
});

Deno.test("ActivityInterceptor should support multiple subscribers", () => {
  const interceptor = new ActivityInterceptor();
  interceptor.start();

  const subscriber1Activities: DebugActivity[] = [];
  const subscriber2Activities: DebugActivity[] = [];

  interceptor.subscribe((activity) => {
    subscriber1Activities.push(activity);
  });

  interceptor.subscribe((activity) => {
    subscriber2Activities.push(activity);
  });

  const mockActivity = {
    id: "https://example.com/activities/3",
    type: "Announce",
  } as unknown as Activity;

  const mockContext = {} as Context<TestContextData>;

  interceptor.captureInbound(mockContext, mockActivity);

  assertEquals(subscriber1Activities.length, 1);
  assertEquals(subscriber2Activities.length, 1);
  assertEquals(subscriber1Activities[0].type, "Announce");
  assertEquals(subscriber2Activities[0].type, "Announce");

  interceptor.stop();
});

Deno.test("ActivityInterceptor should unsubscribe correctly", () => {
  const interceptor = new ActivityInterceptor();
  interceptor.start();

  const capturedActivities: DebugActivity[] = [];
  const unsubscribe = interceptor.subscribe((activity) => {
    capturedActivities.push(activity);
  });

  const mockActivity1 = {
    type: "Create",
  } as unknown as Activity;

  const mockActivity2 = {
    type: "Update",
  } as unknown as Activity;

  const mockContext = {} as Context<TestContextData>;

  // First activity should be captured
  interceptor.captureInbound(mockContext, mockActivity1);
  assertEquals(capturedActivities.length, 1);

  // Unsubscribe
  unsubscribe();

  // Second activity should not be captured
  interceptor.captureOutbound(mockContext, mockActivity2);
  assertEquals(capturedActivities.length, 1); // Still 1, not 2

  interceptor.stop();
});

Deno.test("ActivityInterceptor should not capture activities when stopped", () => {
  const interceptor = new ActivityInterceptor();

  const capturedActivities: DebugActivity[] = [];
  interceptor.subscribe((activity) => {
    capturedActivities.push(activity);
  });

  const mockActivity = {
    type: "Delete",
  } as unknown as Activity;

  const mockContext = {} as Context<TestContextData>;

  // Should not capture when not started
  interceptor.captureInbound(mockContext, mockActivity);
  assertEquals(capturedActivities.length, 0);

  interceptor.start();
  interceptor.captureInbound(mockContext, mockActivity);
  assertEquals(capturedActivities.length, 1);

  interceptor.stop();
  interceptor.captureInbound(mockContext, mockActivity);
  assertEquals(capturedActivities.length, 1); // Still 1, not 2
});
