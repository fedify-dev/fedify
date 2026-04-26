import type { Tunnel, TunnelOptions } from "@hongminhee/localtunnel";
import { runSync } from "@optique/run";
import { deepEqual, rejects } from "node:assert/strict";
import test from "node:test";
import { runCli } from "./runner.ts";
import type { Ora } from "ora";
import { runTunnel, tunnelCommand } from "./tunnel.ts";

test("tunnel command structure", () => {
  const testCommandWithOptions = runSync(tunnelCommand, {
    args: ["tunnel", "3001", "-s", "pinggy.io"],
  });
  const testCommandWithoutOptions = runSync(tunnelCommand, {
    args: ["tunnel", "3000"],
  });

  deepEqual(testCommandWithOptions.command, "tunnel");
  deepEqual(testCommandWithOptions.port, 3001);
  deepEqual(testCommandWithOptions.service, "pinggy.io");

  deepEqual(testCommandWithoutOptions.port, 3000);
  deepEqual(testCommandWithoutOptions.service, undefined);
});

test("tunnel runner accepts omitted tunnel service", async () => {
  const result = await runCli(["tunnel", "3000", "--ignore-config"]);

  deepEqual(result.command, "tunnel");
  deepEqual(result.port, 3000);
  deepEqual((result as { service?: unknown }).service, undefined);
});

test("inbox runner accepts tunnel options without a tunnel service", async () => {
  const withoutTunnel = await runCli([
    "inbox",
    "--no-tunnel",
    "--ignore-config",
  ]);
  const withOtherOption = await runCli([
    "inbox",
    "--actor-name",
    "Test Inbox",
    "--ignore-config",
  ]);

  deepEqual(withoutTunnel.command, "inbox");
  deepEqual((withoutTunnel as { tunnel?: unknown }).tunnel, false);
  deepEqual(
    (withoutTunnel as { tunnelService?: unknown }).tunnelService,
    undefined,
  );
  deepEqual(withOtherOption.command, "inbox");
  deepEqual((withOtherOption as { tunnel?: unknown }).tunnel, true);
  deepEqual(
    (withOtherOption as { actorName?: unknown }).actorName,
    "Test Inbox",
  );
  deepEqual(
    (withOtherOption as { tunnelService?: unknown }).tunnelService,
    undefined,
  );
});

test("relay runner accepts tunnel options without a tunnel service", async () => {
  const result = await runCli([
    "relay",
    "--no-tunnel",
    "--ignore-config",
  ]);

  deepEqual(result.command, "relay");
  deepEqual((result as { tunnel?: unknown }).tunnel, false);
  deepEqual((result as { tunnelService?: unknown }).tunnelService, undefined);
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
