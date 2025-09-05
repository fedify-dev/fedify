import {
  argument,
  command,
  constant,
  type InferValue,
  merge,
  message,
  object,
} from "@optique/core";
import { path } from "@optique/run";
import { debugOption } from "./globals.ts";

export const initCommand = command(
  "init",
  merge(
    debugOption,
    object({
      command: constant("init"),
      resources: argument(path({ metavar: "DIR" })),
    }),
  ),
  {
    description: message`Initialize a new Fedify project directory.`,
  },
);

export function runInit(
  command: InferValue<typeof initCommand>,
) {
  console.debug(command);
}
