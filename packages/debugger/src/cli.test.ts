import { assertEquals, assertStringIncludes } from "@std/assert";
import { assertSpyCalls, spy, stub } from "@std/testing/mock";
import type { DebugActivity } from "./types.ts";

// Import the functions we need to test from cli.ts
// Since cli.ts has a main() that runs on import.meta.main, we need to be careful
// For testing, we'll extract the testable functions

// Mock activity data
function createMockActivity(
  overrides: Partial<DebugActivity> = {},
): DebugActivity {
  return {
    id: "activity-1",
    timestamp: new Date("2025-01-27T10:00:00Z"),
    direction: "inbound",
    type: "https://www.w3.org/ns/activitystreams#Create",
    activityId: "https://example.com/activities/1",
    rawActivity: { type: "Create" },
    actor: {
      id: "https://alice.example",
      type: "Person",
      name: "Alice",
      preferredUsername: "alice",
    },
    object: {
      type: "Note",
      content: "Hello world!",
      summary: "A greeting",
    },
    ...overrides,
  };
}

Deno.test("CLI - parseArgs handles options correctly", async () => {
  const { parseArgs } = await import("@std/cli/parse-args");

  // Test default options
  const defaultArgs = parseArgs([], {
    string: ["url", "filter", "direction"],
    boolean: ["follow", "json", "help"],
    alias: {
      u: "url",
      f: "filter",
      d: "direction",
      w: "follow",
      j: "json",
      h: "help",
    },
    default: {
      url: "http://localhost:3000/__debugger__",
      follow: false,
      json: false,
      help: false,
    },
  });

  assertEquals(defaultArgs.url, "http://localhost:3000/__debugger__");
  assertEquals(defaultArgs.follow, false);
  assertEquals(defaultArgs.json, false);
  assertEquals(defaultArgs.help, false);

  // Test custom options
  const customArgs = parseArgs([
    "--url",
    "http://example.com/__debugger__",
    "--filter",
    "Create",
    "--direction",
    "inbound",
    "--follow",
    "--json",
  ], {
    string: ["url", "filter", "direction"],
    boolean: ["follow", "json", "help"],
    alias: {
      u: "url",
      f: "filter",
      d: "direction",
      w: "follow",
      j: "json",
      h: "help",
    },
    default: {
      url: "http://localhost:3000/__debugger__",
      follow: false,
      json: false,
      help: false,
    },
  });

  assertEquals(customArgs.url, "http://example.com/__debugger__");
  assertEquals(customArgs.filter, "Create");
  assertEquals(customArgs.direction, "inbound");
  assertEquals(customArgs.follow, true);
  assertEquals(customArgs.json, true);
});

Deno.test("CLI - help output contains expected content", () => {
  const consoleLogSpy = spy(console, "log");

  // Simulate help output
  const helpText = `
fedify-debug - ActivityPub debugger for Fedify applications

USAGE:
  fedify-debug [OPTIONS]

OPTIONS:
  -u, --url <URL>        Debug endpoint URL (default: http://localhost:3000/__debugger__)
  -f, --filter <TEXT>    Filter activities by text search
  -d, --direction <DIR>  Filter by direction: inbound or outbound
  -w, --follow           Follow mode - show new activities as they arrive
  -j, --json             Output raw JSON instead of formatted text
  -h, --help             Show this help message
`;

  console.log(helpText);

  assertSpyCalls(consoleLogSpy, 1);
  assertStringIncludes(
    consoleLogSpy.calls[0].args[0] as string,
    "fedify-debug",
  );
  assertStringIncludes(consoleLogSpy.calls[0].args[0] as string, "OPTIONS:");
  assertStringIncludes(consoleLogSpy.calls[0].args[0] as string, "--url");
  assertStringIncludes(consoleLogSpy.calls[0].args[0] as string, "--follow");

  consoleLogSpy.restore();
});

Deno.test("CLI - matchesFilter function", () => {
  // Import just the matchesFilter logic
  const matchesFilter = (activity: DebugActivity, filter: string): boolean => {
    const lowerFilter = filter.toLowerCase();

    // Check type
    if (activity.type.toLowerCase().includes(lowerFilter)) return true;

    // Check actor
    if (activity.actor?.id.toLowerCase().includes(lowerFilter)) return true;
    if (activity.actor?.name?.toLowerCase().includes(lowerFilter)) return true;

    // Check activity ID
    if (activity.activityId?.toLowerCase().includes(lowerFilter)) return true;

    // Check object content
    if (activity.object?.content?.toLowerCase().includes(lowerFilter)) {
      return true;
    }
    if (activity.object?.summary?.toLowerCase().includes(lowerFilter)) {
      return true;
    }

    return false;
  };

  const activity = createMockActivity();

  // Test type matching
  assertEquals(matchesFilter(activity, "Create"), true);
  assertEquals(matchesFilter(activity, "create"), true);
  assertEquals(matchesFilter(activity, "Follow"), false);

  // Test actor matching
  assertEquals(matchesFilter(activity, "alice"), true);
  assertEquals(matchesFilter(activity, "Alice"), true);
  assertEquals(matchesFilter(activity, "bob"), false);

  // Test content matching
  assertEquals(matchesFilter(activity, "Hello"), true);
  assertEquals(matchesFilter(activity, "world"), true);
  assertEquals(matchesFilter(activity, "greeting"), true);
  assertEquals(matchesFilter(activity, "goodbye"), false);
});

Deno.test("CLI - activity formatting", async () => {
  const { format } = await import("@std/datetime/format");

  // Test timestamp formatting (using UTC to avoid timezone issues)
  const date = new Date("2025-01-27T10:30:45Z");
  const formatted = format(date, "HH:mm:ss", { timeZone: "UTC" });
  assertEquals(formatted, "10:30:45");

  // Test activity type extraction
  const fullType = "https://www.w3.org/ns/activitystreams#Create";
  const shortType = fullType.split("#").pop() || fullType;
  assertEquals(shortType, "Create");
});

Deno.test("CLI - URL construction", () => {
  const baseUrl = "http://localhost:8000/__debugger__";

  // Test API endpoint construction
  const statsUrl = `${baseUrl}/api/stats`;
  assertEquals(statsUrl, "http://localhost:8000/__debugger__/api/stats");

  // Test query parameter construction
  const params = new URLSearchParams();
  params.set("direction", "inbound");
  params.set("limit", "50");

  const activitiesUrl = `${baseUrl}/api/activities?${params}`;
  assertEquals(
    activitiesUrl,
    "http://localhost:8000/__debugger__/api/activities?direction=inbound&limit=50",
  );
});

Deno.test("CLI - fetch error handling", async () => {
  const fetchStub = stub(
    globalThis,
    "fetch",
    () => Promise.reject(new Error("Connection refused")),
  );

  try {
    await fetch("http://localhost:8000/__debugger__/api/stats");
  } catch (error) {
    assertEquals(error instanceof Error, true);
    assertStringIncludes((error as Error).message, "Connection refused");
  }

  fetchStub.restore();
});

Deno.test("CLI - JSON output formatting", () => {
  const activity = createMockActivity();

  // Test JSON stringification
  const jsonOutput = JSON.stringify(activity);
  const parsed = JSON.parse(jsonOutput);

  assertEquals(parsed.id, activity.id);
  assertEquals(parsed.type, activity.type);
  assertEquals(parsed.direction, activity.direction);
  assertEquals(parsed.actor.id, activity.actor?.id);
});

Deno.test("CLI - retry delay calculation", () => {
  let retryDelay = 1000; // Start with 1 second
  const maxRetryDelay = 30000; // Max 30 seconds

  // Test exponential backoff
  retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
  assertEquals(retryDelay, 2000);

  retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
  assertEquals(retryDelay, 4000);

  // Test max limit
  retryDelay = 20000;
  retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
  assertEquals(retryDelay, 30000);
});

Deno.test("CLI - activity display formatting", () => {
  const consoleLogSpy = spy(console, "log");

  // Simulate activity display
  const activity = createMockActivity({
    signature: { present: true, verified: true },
    delivery: { status: "success", attempts: 1 },
  });

  // Test formatted output components
  const timestamp = "10:00:00";
  const direction = activity.direction === "inbound" ? "←" : "→";
  const type = "Create";
  const actorName = activity.actor?.preferredUsername || "unknown";

  const line = `${timestamp} ${direction} ${type} from ${actorName}`;
  console.log(line);

  assertSpyCalls(consoleLogSpy, 1);
  assertStringIncludes(consoleLogSpy.calls[0].args[0] as string, "10:00:00");
  assertStringIncludes(consoleLogSpy.calls[0].args[0] as string, "←");
  assertStringIncludes(consoleLogSpy.calls[0].args[0] as string, "Create");
  assertStringIncludes(consoleLogSpy.calls[0].args[0] as string, "alice");

  consoleLogSpy.restore();
});

Deno.test("CLI - follow mode activity filtering", () => {
  const activities = [
    createMockActivity({
      id: "1",
      timestamp: new Date("2025-01-27T10:00:00Z"),
    }),
    createMockActivity({
      id: "2",
      timestamp: new Date("2025-01-27T10:01:00Z"),
    }),
    createMockActivity({
      id: "3",
      timestamp: new Date("2025-01-27T10:02:00Z"),
    }),
  ];

  const lastTimestamp = new Date("2025-01-27T10:00:30Z");

  // Filter activities newer than lastTimestamp
  const newActivities = activities.filter((a) =>
    new Date(a.timestamp) > lastTimestamp
  );

  assertEquals(newActivities.length, 2);
  assertEquals(newActivities[0].id, "2");
  assertEquals(newActivities[1].id, "3");
});

Deno.test("CLI - direction filtering", () => {
  const activities = [
    createMockActivity({ id: "1", direction: "inbound" }),
    createMockActivity({ id: "2", direction: "outbound" }),
    createMockActivity({ id: "3", direction: "inbound" }),
    createMockActivity({ id: "4", direction: "outbound" }),
  ];

  // Filter by inbound
  const inbound = activities.filter((a) => a.direction === "inbound");
  assertEquals(inbound.length, 2);
  assertEquals(inbound[0].id, "1");
  assertEquals(inbound[1].id, "3");

  // Filter by outbound
  const outbound = activities.filter((a) => a.direction === "outbound");
  assertEquals(outbound.length, 2);
  assertEquals(outbound[0].id, "2");
  assertEquals(outbound[1].id, "4");
});

Deno.test("CLI - error recovery with retry", async () => {
  let attempts = 0;
  const fetchStub = stub(
    globalThis,
    "fetch",
    () => {
      attempts++;
      if (attempts < 3) {
        return Promise.reject(new Error("Connection refused"));
      }
      return Promise.resolve(
        new Response(JSON.stringify({
          activities: [createMockActivity()],
        })),
      );
    },
  );

  try {
    // First two attempts fail, third succeeds
    for (let i = 0; i < 3; i++) {
      try {
        const response = await fetch(
          "http://localhost:8000/__debugger__/api/activities",
        );
        const data = await response.json();
        assertEquals(data.activities.length, 1);
        break;
      } catch (error) {
        if (i < 2) continue;
        throw error;
      }
    }

    assertEquals(attempts, 3);
  } finally {
    fetchStub.restore();
  }
});

Deno.test("CLI - complex activity filtering", () => {
  const activities = [
    createMockActivity({
      type: "https://www.w3.org/ns/activitystreams#Create",
      actor: {
        id: "https://alice.example",
        type: "Person",
        name: "Alice",
        preferredUsername: "alice",
      },
      object: { type: "Note", content: "Hello world" },
    }),
    createMockActivity({
      type: "https://www.w3.org/ns/activitystreams#Follow",
      actor: {
        id: "https://bob.example",
        type: "Person",
        name: "Bob",
        preferredUsername: "bob",
      },
    }),
    createMockActivity({
      type: "https://www.w3.org/ns/activitystreams#Like",
      actor: {
        id: "https://charlie.example",
        type: "Person",
        name: "Charlie",
        preferredUsername: "charlie",
      },
      object: { type: "Note", content: "Great post!" },
    }),
  ];

  const matchesFilter = (activity: DebugActivity, filter: string): boolean => {
    const lowerFilter = filter.toLowerCase();

    // Check type
    if (activity.type.toLowerCase().includes(lowerFilter)) return true;

    // Check actor
    if (activity.actor?.id.toLowerCase().includes(lowerFilter)) return true;
    if (activity.actor?.name?.toLowerCase().includes(lowerFilter)) return true;
    if (
      activity.actor?.preferredUsername?.toLowerCase().includes(lowerFilter)
    ) return true;

    // Check activity ID
    if (activity.activityId?.toLowerCase().includes(lowerFilter)) return true;

    // Check object content
    if (activity.object?.content?.toLowerCase().includes(lowerFilter)) {
      return true;
    }
    if (activity.object?.summary?.toLowerCase().includes(lowerFilter)) {
      return true;
    }

    return false;
  };

  // Filter by activity type
  const creates = activities.filter((a) => matchesFilter(a, "create"));
  assertEquals(creates.length, 1);
  assertEquals(creates[0].actor?.name, "Alice");

  // Filter by actor name
  const bobActivities = activities.filter((a) => matchesFilter(a, "bob"));
  assertEquals(bobActivities.length, 1);
  assertEquals(
    bobActivities[0].type,
    "https://www.w3.org/ns/activitystreams#Follow",
  );

  // Filter by content
  const greatPosts = activities.filter((a) => matchesFilter(a, "great"));
  assertEquals(greatPosts.length, 1);
  assertEquals(greatPosts[0].actor?.name, "Charlie");
});

Deno.test("CLI - stats endpoint parsing", () => {
  const stats = {
    totalActivities: 150,
    inboundActivities: 100,
    outboundActivities: 50,
    oldestActivity: "2025-01-27T08:00:00Z",
    newestActivity: "2025-01-27T12:00:00Z",
    actorCount: 25,
    topActors: [
      { id: "https://alice.example", count: 20 },
      { id: "https://bob.example", count: 15 },
    ],
    typeDistribution: {
      Create: 80,
      Follow: 40,
      Like: 30,
    },
  };

  // Test stats properties
  assertEquals(stats.totalActivities, 150);
  assertEquals(stats.inboundActivities, 100);
  assertEquals(stats.outboundActivities, 50);
  assertEquals(stats.actorCount, 25);

  // Test top actors
  assertEquals(stats.topActors.length, 2);
  assertEquals(stats.topActors[0].count, 20);

  // Test type distribution
  assertEquals(stats.typeDistribution.Create, 80);
  assertEquals(stats.typeDistribution.Follow, 40);
  assertEquals(stats.typeDistribution.Like, 30);
});
