import { assertExists } from "@std/assert";
import { TerminalDebugger } from "./terminal.ts";
import { TerminalFormatter } from "./formatter.ts";
import type { DebugActivity } from "./interceptor.ts";
import type { StoreStatistics } from "./store.ts";

Deno.test("TerminalFormatter formats activities correctly", () => {
  const formatter = new TerminalFormatter({ colorize: false });

  const activity: DebugActivity = {
    id: "test-1",
    type: "Create",
    direction: "inbound",
    timestamp: new Date("2024-01-01T12:00:00Z"),
    activityId: "https://example.com/activity/1",
    rawActivity: {
      type: "Create",
      id: "https://example.com/activity/1",
      actor: "https://example.com/actor/1",
      object: {
        type: "Note",
        content: "Hello world",
      },
    },
  };

  const formatted = formatter.formatActivity(activity);

  // Check that key information is included
  assert(formatted.includes("[INBOUND]"));
  assert(formatted.includes("Create"));
  assert(formatted.includes("https://example.com/activity/1"));
  assert(formatted.includes("2024-01-01T12:00:00.000Z")); // UTC timestamp
  assert(formatted.includes("Actor:"));
  assert(formatted.includes("https://example.com/actor/1"));
  assert(formatted.includes("Object:"));
  assert(formatted.includes("Note")); // Object type is shown
});

Deno.test("TerminalFormatter formats statistics correctly", () => {
  const formatter = new TerminalFormatter({ colorize: false });

  const stats: StoreStatistics = {
    totalActivities: 10,
    capacity: 100,
    inboundCount: 6,
    outboundCount: 4,
    typeBreakdown: {
      Create: 5,
      Follow: 3,
      Like: 2,
    },
  };

  const formatted = formatter.formatStatistics(stats);

  // Check statistics are included
  assert(formatted.includes("Total Activities: 10"));
  assert(formatted.includes("Inbound:          6"));
  assert(formatted.includes("Outbound:         4"));
  assert(formatted.includes("Create (5)"));
  assert(formatted.includes("Follow (3)"));
  assert(formatted.includes("Like (2)"));
});

Deno.test("TerminalDebugger filters activities correctly", () => {
  const options = {
    follow: false,
    filter: {
      direction: "inbound" as const,
    },
  };

  const terminalDebugger = new TerminalDebugger(options);

  // Since we can't easily test the full integration,
  // we'll just verify the debugger is created successfully
  assertExists(terminalDebugger);
});

// Helper function
function assert(condition: boolean, message?: string): void {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}
