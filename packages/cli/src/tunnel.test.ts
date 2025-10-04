import type { Tunnel, TunnelOptions } from "@hongminhee/localtunnel";
import { run } from "@optique/run";
import { assertEquals, assertRejects } from "@std/assert";
import test from "node:test";
import type { Ora } from "ora";
import { runTunnel, tunnelCommand } from "./tunnel.ts";

test("tunnel command structure", () => {
  const testCommandWithOptions = run(tunnelCommand, {
    args: ["tunnel", "3001", "-s", "pinggy.io", "-d"],
  });
  const testCommandWithoutOptions = run(tunnelCommand, {
    args: ["tunnel", "3000"],
  });

  assertEquals(testCommandWithOptions.command, "tunnel");
  assertEquals(testCommandWithOptions.port, 3001);
  assertEquals(testCommandWithOptions.service, "pinggy.io");
  assertEquals(testCommandWithOptions.debug, true);

  assertEquals(testCommandWithoutOptions.port, 3000);
  assertEquals(testCommandWithoutOptions.service, undefined);
  assertEquals(testCommandWithoutOptions.debug, false);
});

test("tunnel successfully creates and manages tunnel", async () => {
  const mockCommand = {
    command: "tunnel" as const,
    port: 3001,
    service: "pinggy.io" as const,
    debug: true,
  };

  const mockTunnel: Tunnel = {
    url: new URL("https://droar-218-152-125-59.a.free.pinggy.link/"),
    localPort: 3001,
    pid: 123,
    close: () => Promise.resolve(),
  };

  let openTunnelCalled = false;
  let openTunnelPort;
  let openTunnelService;
  let spinnerCalled = false;
  let openTunnelSucceed = false;
  let openTunnelFailed = false;
  let spinnerMsg;

  const mockDeps = {
    openTunnel: (args: TunnelOptions) => {
      openTunnelCalled = true;
      openTunnelPort = args.port;
      openTunnelService = args.service;
      return Promise.resolve(mockTunnel);
    },
    ora: () =>
      ({
        start() {
          spinnerCalled = true;
          return this;
        },
        fail(msg: string) {
          openTunnelFailed = true;
          spinnerMsg = msg;
          return this;
        },
        succeed(msg: string) {
          openTunnelSucceed = true;
          spinnerMsg = msg;
          return this;
        },
      }) as unknown as Ora,
    exit: (): never => {
      throw new Error();
    },
  };

  try {
    await runTunnel(mockCommand, mockDeps);
  } finally {
    assertEquals(openTunnelCalled, true);
    assertEquals(openTunnelPort, 3001);
    assertEquals(openTunnelService, "pinggy.io");
    assertEquals(openTunnelSucceed, true);
    assertEquals(openTunnelFailed, false);
    assertEquals(spinnerCalled, true);
    assertEquals(
      spinnerMsg,
      `Your local server at ${mockTunnel.localPort} is now publicly accessible:\n`,
    );
  }
});

test("tunnel fails to create a secure tunnel and handles error", async () => {
  const mockCommand = {
    command: "tunnel" as const,
    port: 3001,
    service: undefined,
    debug: false,
  };

  let openTunnelCalled = false;
  let openTunnelPort;
  let openTunnelService;
  let spinnerCalled = false;
  let openTunnelSucceed = false;
  let openTunnelFailed = false;
  let spinnerMsg;

  const mockDeps = {
    openTunnel: (args: TunnelOptions) => {
      openTunnelCalled = true;
      openTunnelPort = args.port;
      openTunnelService = args.service;
      return Promise.reject();
    },
    ora: () =>
      ({
        start() {
          spinnerCalled = true;
          return this;
        },
        fail(msg: string) {
          openTunnelFailed = true;
          spinnerMsg = msg;
          return this;
        },
        succeed(msg: string) {
          openTunnelSucceed = true;
          spinnerMsg = msg;
          return this;
        },
      }) as unknown as Ora,
    exit: (): never => {
      throw new Error("Process exit called");
    },
  };

  try {
    await assertRejects(
      () => runTunnel(mockCommand, mockDeps),
      Error,
      "Process exit called",
    );
  } finally {
    assertEquals(openTunnelCalled, true);
    assertEquals(openTunnelPort, 3001);
    assertEquals(openTunnelService, undefined);
    assertEquals(openTunnelSucceed, false);
    assertEquals(openTunnelFailed, true);
    assertEquals(spinnerCalled, true);
    assertEquals(
      spinnerMsg,
      "Failed to create a secure tunnel.",
    );
  }
});
