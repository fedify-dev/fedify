import { assertEquals } from "@std/assert";
import { type InboxOptions, TunnelConfig } from "./inbox.tsx";

Deno.test("handles --no-tunnel flag correctly", () => {
  const optionsWithNoTunnel: InboxOptions = {
    tunnel: false,
    follow: undefined,
    acceptFollow: undefined,
  };
  assertEquals(
    TunnelConfig.shouldDisableTunnel(optionsWithNoTunnel),
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
    TunnelConfig.shouldDisableTunnel(optionsWithT),
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
    TunnelConfig.shouldDisableTunnel(optionsDefault),
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
    TunnelConfig.shouldDisableTunnel(optionsBothFlags),
    true,
    "Both flags should disable tunnel",
  );
});

Deno.test("Various InboxOptions combinations", () => {
  const validOptions: InboxOptions[] = [
    { tunnel: true },
    { tunnel: false },
    { tunnel: true, noTunnel: true },
    { tunnel: false, noTunnel: false },
    { tunnel: true, follow: ["@user@example.com"] },
    { tunnel: true, acceptFollow: ["*"] },
    { tunnel: true, follow: [], acceptFollow: [] },
  ];

  for (const options of validOptions) {
    const result = TunnelConfig.shouldDisableTunnel(options);
    assertEquals(
      typeof result,
      "boolean",
      "shouldDisableTunnel must return boolean",
    );
  }
});
