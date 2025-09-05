import {
  command as Command,
  constant,
  type InferValue,
  merge,
  message,
  object,
} from "@optique/core";
import { createJimp } from "@jimp/core";
import webp from "@jimp/wasm-webp";
import { defaultFormats, defaultPlugins } from "jimp";
import { debugOption } from "./globals.ts";

export const Jimp = createJimp({
  formats: [...defaultFormats, webp],
  plugins: defaultPlugins,
});

export const nodeInfoCommand = Command(
  "nodeinfo",
  merge(
    object({
      command: constant("nodeinfo"),
    }),
    debugOption,
  ),
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
