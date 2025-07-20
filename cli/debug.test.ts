import { assertEquals, assertExists } from "@std/assert";
import { command } from "./debug.tsx";
import type { DebugOptions } from "./debug.tsx";

Deno.test("debug command exists", () => {
  assertExists(command);
  // Command exists and is properly exported
});

Deno.test("debug command has correct description", () => {
  const description = command.getDescription();
  assertExists(description);
  assertEquals(
    description.includes("ActivityPub debug dashboard"),
    true,
  );
});

Deno.test("debug command has required options", () => {
  const options = command.getOptions();

  // Check that we have options
  assertExists(options);
  assertEquals(options.length > 0, true);

  // Check option names exist
  const optionNames = options.map((opt) => opt.name);
  assertEquals(optionNames.includes("port"), true);
  assertEquals(optionNames.includes("no-browser"), true);
});

Deno.test("debug options interface exports correctly", () => {
  // Type check only - ensures DebugOptions interface is properly exported
  const options: DebugOptions = {
    port: 8080,
    browser: true,
  };

  assertEquals(typeof options.port, "number");
  assertEquals(typeof options.browser, "boolean");
});

Deno.test("debug command has action handler", () => {
  // Verify the command has an action handler
  const hasAction = typeof command.action === "function";
  assertEquals(hasAction, true);
});
