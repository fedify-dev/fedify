import {
  argument,
  command,
  constant,
  type InferValue,
  message,
  object,
  string,
} from "@optique/core";

export const tunnelCommand = command(
  "tunnel",
  object({
    command: constant("tunnel"),
    resources: argument(string({ metavar: "PORT" })),
  }),
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
