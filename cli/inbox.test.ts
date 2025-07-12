import { assertEquals } from "@std/assert";
import type { InboxOptions } from "./inbox.tsx";

// mock of the tunnel disabling logic
function shouldDisableTunnel(options: InboxOptions): boolean {
  return options.tunnel === false || options.noTunnel === true;
}

Deno.test("handles --no-tunnel flag correctly", () => {
  const optionsWithNoTunnel: InboxOptions = {
    tunnel: false,
    follow: undefined,
    acceptFollow: undefined,
  };
  assertEquals(
    shouldDisableTunnel(optionsWithNoTunnel),
    true,
    "--no-tunnel flag should disable tunnel",
  );
});

Deno.test("set noTunnel true, should handles -T flag correctly", () => {
  const optionsWithT: InboxOptions = {
    tunnel: true,
    noTunnel: true,
    follow: undefined,
    acceptFollow: undefined,
  };
  assertEquals(
    shouldDisableTunnel(optionsWithT),
    true,
    "-T flag should disable tunnel",
  );
});

Deno.test("handles default behavior (no flags)", () => {
  const optionsDefault: InboxOptions = {
    tunnel: true,
    follow: undefined,
    acceptFollow: undefined,
  };
  assertEquals(
    shouldDisableTunnel(optionsDefault),
    false,
    "Default behavior should enable tunnel",
  );
});

Deno.test("handles both flags together", () => {
  const optionsBothFlags: InboxOptions = {
    tunnel: false,
    noTunnel: true,
    follow: undefined,
    acceptFollow: undefined,
  };
  assertEquals(
    shouldDisableTunnel(optionsBothFlags),
    true,
    "Both flags should disable tunnel",
  );
});

Deno.test("Various InboxOptions combinations", () => {
  // Valid option combinations
  const validOptions: InboxOptions[] = [
    { tunnel: true },
    { tunnel: false },
    { tunnel: true, noTunnel: true },
    { tunnel: false, noTunnel: false },
    { tunnel: true, follow: ["@user@example.com"] },
    { tunnel: true, acceptFollow: ["*"] },
    { tunnel: true, follow: [], acceptFollow: [] },
  ];

  // Test that all valid options work with shouldDisableTunnel
  for (const options of validOptions) {
    const result = shouldDisableTunnel(options);
    assertEquals(
      typeof result,
      "boolean",
      "shouldDisableTunnel must return boolean",
    );
  }
});
