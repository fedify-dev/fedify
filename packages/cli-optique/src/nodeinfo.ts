import {
  command as OQCommand,
  constant,
  type InferValue,
  message,
  object as OQObject,
} from "@optique/core";

// FIXME: This is placeholder for development for optique

export const nodeInfoCommand = OQCommand(
  "nodeinfo",
  OQObject({
    command: constant("nodeinfo"),
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
