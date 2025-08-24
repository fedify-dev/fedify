import { argument, command, constant, message, object } from "@optique/core";
import { path } from "@optique/run";
import { InferValue } from "@optique/core/parser";

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
