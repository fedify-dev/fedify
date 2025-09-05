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
import { debugOption } from "./globals.ts";

export const tunnelCommand = command(
  "tunnel",
  merge(
    object({
      command: constant("tunnel"),
      port: argument(integer({ metavar: "PORT", min: 0, max: 65_535 })),
    }),
    debugOption,
  ),
  {
    description:
      message`Expose a local HTTP server to the public internet using a secure tunnel.`,
  },
);

export function runTunnel(
  command: InferValue<typeof tunnelCommand>,
) {
  console.debug(command);
}
