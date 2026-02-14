import type { Tunnel, TunnelOptions } from "@hongminhee/localtunnel";
import { run } from "@optique/run";
import { deepEqual, rejects } from "node:assert/strict";
import test from "node:test";
import type { Ora } from "ora";
import { runTunnel, tunnelCommand } from "./tunnel.ts";

test("tunnel command structure", () => {
  const testCommandWithOptions = run(tunnelCommand, {
    args: ["tunnel", "3001", "-s", "pinggy.io"],
  });
  const testCommandWithoutOptions = run(tunnelCommand, {
    args: ["tunnel", "3000"],
  });

  deepEqual(testCommandWithOptions.command, "tunnel");
  deepEqual(testCommandWithOptions.port, 3001);
  deepEqual(testCommandWithOptions.service, "pinggy.io");

  deepEqual(testCommandWithoutOptions.port, 3000);
  deepEqual(testCommandWithoutOptions.service, undefined);
});

test("tunnel successfully creates and manages tunnel", async () => {
  const mockCommand = {
    command: "tunnel" as const,
    port: 3001,
    service: "pinggy.io" as const,
    debug: true,
    ignoreConfig: false as const,
    configPath: undefined,
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
    deepEqual(openTunnelCalled, true);
    deepEqual(openTunnelPort, 3001);
    deepEqual(openTunnelService, "pinggy.io");
    deepEqual(openTunnelSucceed, true);
    deepEqual(openTunnelFailed, false);
    deepEqual(spinnerCalled, true);
    deepEqual(
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
    ignoreConfig: false as const,
    configPath: undefined,
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
    await rejects(
      () => runTunnel(mockCommand, mockDeps),
      Error,
      "Process exit called",
    );
  } finally {
    deepEqual(openTunnelCalled, true);
    deepEqual(openTunnelPort, 3001);
    deepEqual(openTunnelService, undefined);
    deepEqual(openTunnelSucceed, false);
    deepEqual(openTunnelFailed, true);
    deepEqual(spinnerCalled, true);
    deepEqual(
      spinnerMsg,
      "Failed to create a secure tunnel.",
    );
  }
});
