import { bindConfig } from "@optique/config";
import {
  argument,
  command,
  constant,
  flag,
  type InferValue,
  integer,
  merge,
  message,
  multiple,
  object,
  option,
  string,
} from "@optique/core";
import { configContext } from "../config.ts";
import { debugOption, userAgentOption } from "../options.ts";

const allowPrivateAddresses = bindConfig(
  flag("-p", "--allow-private-address", {
    description: message`Allow private IP addresses in the URL.`,
  }),
  {
    context: configContext,
    key: (config) => config.webfinger?.allowPrivateAddress ?? false,
    default: false,
  },
);

const maxRedirection = bindConfig(
  option(
    "--max-redirection",
    integer({ min: 0 }),
    { description: message`Maximum number of redirections to follow.` },
  ),
  {
    context: configContext,
    key: (config) => config.webfinger?.maxRedirection as number,
    default: 0,
  },
);

export const webFingerCommand = command(
  "webfinger",
  merge(
    object({
      command: constant("webfinger"),
      resources: multiple(
        argument(string({ metavar: "RESOURCE" }), {
          description: message`WebFinger resource(s) to look up.`,
        }),
        { min: 1 },
      ),
      allowPrivateAddresses,
      maxRedirection,
    }),
    userAgentOption,
    debugOption,
  ),
  {
    brief: message`Look up WebFinger resources.`,
    description: message`Look up WebFinger resources.

The argument can be multiple.`,
  },
);

export type WebFingerCommand = InferValue<typeof webFingerCommand>;
