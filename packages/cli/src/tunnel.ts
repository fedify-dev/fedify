import { openTunnel, type Tunnel } from "@hongminhee/localtunnel";
import {
  argument,
  command,
  constant,
  type InferValue,
  integer,
  merge,
  message,
  object,
} from "@optique/core";
import { print, printError } from "@optique/run";
import process from "node:process";
import ora from "ora";
import { configureLogging } from "./log.ts";
import { createTunnelServiceOption, type GlobalOptions } from "./options.ts";
import { TUNNEL_SERVICE_REGISTRY } from "./tunnelservice.ts";

export const tunnelOptions = merge(
  "Tunnel options",
  object({
    command: constant("tunnel"),
  }),
  object({
    port: argument(integer({ metavar: "PORT", min: 0, max: 65535 }), {
      description: message`The local port number to expose.`,
    }),
    service: createTunnelServiceOption([
      "-s",
      "--service",
    ]),
  }),
);

export const tunnelMetadata = {
  brief:
    message`Expose a local HTTP server to the public internet using a secure tunnel.`,
  description:
    message`Expose a local HTTP server to the public internet using a secure tunnel.

Note that the HTTP requests through the tunnel have X-Forwarded-* headers.`,
};

export const tunnelCommand = command(
  "tunnel",
  tunnelOptions,
  tunnelMetadata,
);

export interface TunnelDeps {
  readonly openTunnel: typeof openTunnel;
  readonly ora: typeof ora;
  readonly exit: typeof process.exit;
}

export async function runTunnel(
  command: InferValue<typeof tunnelCommand> & GlobalOptions,
  deps: TunnelDeps = {
    openTunnel,
    ora,
    exit: process.exit,
  },
) {
  if (command.debug) {
    await configureLogging();
  }
  const spinner = deps.ora({
    text: "Creating a secure tunnel...",
    discardStdin: false,
  }).start();
  let tunnel: Tunnel;
  try {
    tunnel = await deps.openTunnel({
      port: command.port,
      services: TUNNEL_SERVICE_REGISTRY,
      service: command.service,
    });
  } catch (error) {
    if (command.debug) {
      printError(message`${String(error)}`);
    }
    spinner.fail("Failed to create a secure tunnel.");
    deps.exit(1);
  }
  spinner.succeed(
    `Your local server at ${command.port} is now publicly accessible:\n`,
  );
  print(message`${tunnel.url.href}`);
  print(message`\nPress ^C to close the tunnel.`);
  process.on("SIGINT", async () => {
    await tunnel.close();
  });
}
