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
  option,
  optional,
} from "@optique/core";
import { choice } from "@optique/core/valueparser";
import { print } from "@optique/run";
import process from "node:process";
import ora from "ora";
import { configureLogging, debugOption } from "./globals.ts";

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
      service: optional(
        option(
          "-s",
          "--service",
          choice(["localhost.run", "serveo.net", "pinggy.io"]),
          {
            description: message`The localtunnel service to use.`,
          },
        ),
      ),
    }),
    debugOption,
  ),
  {
    description:
      message`Expose a local HTTP server to the public internet using a secure tunnel.\nNote that the HTTP requests through the tunnel have X-Forwarded-* headers.`,
  },
);

export async function runTunnel(
  command: InferValue<typeof tunnelCommand>,
) {
  if (command.debug) {
    await configureLogging();
  }
  const spinner = ora({
    text: "Creating a secure tunnel...",
    discardStdin: false,
  }).start();
  let tunnel: Tunnel;
  try {
    tunnel = await openTunnel({ port: command.port, service: command.service });
  } catch {
    spinner.fail("Failed to create a secure tunnel.");
    process.exit(1);
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
