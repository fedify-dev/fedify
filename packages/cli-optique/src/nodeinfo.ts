import {
  argument,
  command,
  constant,
  type InferValue,
  message,
  object,
  string,
} from "@optique/core";

export const nodeInfoCommand = command(
  "nodeinfo",
  object({
    command: constant("nodeinfo"),
    resources: argument(string({ metavar: "HOST" })),
  }),
  {
    description:
      message`Get information about a remote node using the NodeInfo protocol. The argument is the hostname of the remote node, or the URL of the remote node.`,
  },
);

export function runNodeInfo(
  command: InferValue<typeof nodeInfoCommand>,
) {
  console.debug(command);
}
