import {
  argument,
  command,
  constant,
  type InferValue,
  message,
  multiple,
  object,
  string,
} from "@optique/core";

export const webFingerCommand = command(
  "webfinger",
  object({
    command: constant("webfinger"),
    resources: multiple(argument(string({ metavar: "RESOURCE" }), {
      description: message`WebFinger resource(s) to look up.`,
    })),
  }),
  {
    description: message`Look up WebFinger resources.`,
  },
);

export function runWebFinger(
  command: InferValue<typeof webFingerCommand>,
) {
  console.debug(command);
}
