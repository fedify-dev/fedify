import { openTunnel, type Tunnel } from "@hongminhee/localtunnel";
import { bindConfig } from "@optique/config";
import {
  argument,
  command,
  constant,
  type InferValue,
  integer,
  merge,
  message,
  object,
  option,
  optional,
  valueSet,
} from "@optique/core";
import { choice } from "@optique/core/valueparser";
import { print, printError } from "@optique/run";
import process from "node:process";
import ora from "ora";
import { configContext } from "./config.ts";
import { configureLogging } from "./log.ts";
import { debugOption, TUNNEL_SERVICES } from "./options.ts";
export const tunnelCommand = command(
  "tunnel",
  merge(
    "Tunnel options",
    object({
      command: constant("tunnel"),
    }),
    object({
      port: argument(integer({ metavar: "PORT", min: 0, max: 65535 }), {
        description: message`The local port number to expose.`,
      }),
      service: bindConfig(
        optional(
          option(
            "-s",
            "--service",
            "--tunnel-service",
            choice(TUNNEL_SERVICES, {
              metavar: "SERVICE",
            }),
            {
              description: message`The tunneling service to use: ${
                valueSet(TUNNEL_SERVICES)
              }.`,
            },
          ),
        ),
        {
          context: configContext,
          key: (config) => config.tunnel?.service,
        },
      ),
    }),
    debugOption,
  ),
  {
    brief:
      message`Expose a local HTTP server to the public internet using a secure tunnel.`,
    description:
      message`Expose a local HTTP server to the public internet using a secure tunnel.

Note that the HTTP requests through the tunnel have X-Forwarded-* headers.`,
  },
);

export async function runTunnel(
  command: InferValue<typeof tunnelCommand>,
  deps: {
    openTunnel: typeof openTunnel;
    ora: typeof ora;
    exit: typeof process.exit;
  } = {
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
