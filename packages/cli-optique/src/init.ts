import {
  argument,
  command,
  constant,
  type InferValue,
  message,
  object,
} from "@optique/core";
import { path } from "@optique/run";

export const initCommand = command(
  "init",
  object({
    command: constant("init"),
    resources: argument(path({ metavar: "DIRECTORY" })),
  }),
  {
    description: message`Initialize a new Fedify project directory.`,
  },
);

export function runInit(
  command: InferValue<typeof initCommand>,
) {
  console.debug(command);
}
