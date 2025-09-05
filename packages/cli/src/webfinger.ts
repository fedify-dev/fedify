import {
  argument,
  command,
  constant,
  type InferValue,
  merge,
  message,
  multiple,
  object,
  string,
} from "@optique/core";
import { debugOption } from "./globals.ts";

export const webFingerCommand = command(
  "webfinger",
  merge(
    object({
      command: constant("webfinger"),
      resources: multiple(argument(string({ metavar: "RESOURCE" }), {
        description: message`WebFinger resource(s) to look up.`,
      })),
    }),
    debugOption,
  ),
  {
    description: message`Look up WebFinger resources.`,
  },
);

export function runWebFinger(
  command: InferValue<typeof webFingerCommand>,
) {
  console.debug(command);
}
