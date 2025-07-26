import { assertEquals, assertExists } from "@std/assert";
import { ActivityInterceptor } from "./interceptor.ts";
import { ActivityStore } from "./store.ts";
import { DebugServer } from "./server.ts";
import { delay } from "@std/async/delay";

Deno.test("Debug server integration", async (t) => {
  const interceptor = new ActivityInterceptor();
  const store = new ActivityStore(10);

  // Connect interceptor to store
  interceptor.subscribe((activity) => {
    store.insert(activity);
  });

  interceptor.start();

  const server = new DebugServer({
    port: 0, // Use random port
    interceptor,
    store,
  });

  await t.step("server starts and accepts connections", async () => {
    const port = server.start();

    // Give server time to start
    await delay(100);

    // Test API endpoint
    const response = await fetch(`http://localhost:${port}/api/stats`);
    assertEquals(response.ok, true);

    const stats = await response.json();
    assertEquals(stats.totalActivities, 0);
    assertEquals(stats.inboundCount, 0);
    assertEquals(stats.outboundCount, 0);
  });

  await t.step("interceptor captures activities and stores them", () => {
    // Simulate some activities
    const mockActivity = {
      type: "Create",
      id: "https://example.com/activity/1",
      actor: "https://example.com/actor/1",
      object: {
        type: "Note",
        content: "Hello world",
      },
    };

    interceptor.captureInbound({} as any, mockActivity as any);
    interceptor.captureOutbound({} as any, mockActivity as any);

    const stats = store.getStats();
    assertEquals(stats.totalActivities, 2);
    assertEquals(stats.inboundCount, 1);
    assertEquals(stats.outboundCount, 1);
  });

  await t.step("store retrieves activities correctly", () => {
    const activities = store.getAll();
    assertEquals(activities.length, 2);

    const inbound = activities.find((a) => a.direction === "inbound");
    assertExists(inbound);
    assertEquals(inbound.type, "Create");

    const outbound = activities.find((a) => a.direction === "outbound");
    assertExists(outbound);
    assertEquals(outbound.type, "Create");
  });

  // Cleanup
  interceptor.stop();
  await server.stop();
});

Deno.test("WebSocket message protocol", async () => {
  const interceptor = new ActivityInterceptor();
  const store = new ActivityStore(10);
  let receivedMessage: any = null;

  // Mock WebSocket behavior by subscribing to store
  const unsubscribe = store.subscribe((activity) => {
    receivedMessage = {
      type: "activity",
      activity,
      stats: store.getStats(),
    };
  });

  interceptor.subscribe((activity) => {
    store.insert(activity);
  });

  interceptor.start();

  // Capture an activity
  const mockActivity = {
    type: "Follow",
    id: "https://example.com/activity/2",
  };

  interceptor.captureInbound({} as any, mockActivity as any);

  // Wait for async operations
  await delay(10);

  // Verify the message format
  assertExists(receivedMessage);
  assertEquals(receivedMessage.type, "activity");
  assertExists(receivedMessage.activity);
  assertEquals(receivedMessage.activity.type, "Follow");
  assertExists(receivedMessage.stats);
  assertEquals(receivedMessage.stats.totalActivities, 1);

  // Cleanup
  unsubscribe();
  interceptor.stop();
});
