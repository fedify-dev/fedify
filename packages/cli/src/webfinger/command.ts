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
import { getUserAgent } from "../../../vocab-runtime/src/request.ts";
import { configContext } from "../config.ts";
import { debugOption } from "../options.ts";

const userAgent = bindConfig(
  option(
    "-u",
    "--user-agent",
    string({ metavar: "USER_AGENT" }),
    { description: message`The custom User-Agent header value.` },
  ),
  {
    context: configContext,
    key: (config) => config.userAgent ?? getUserAgent(),
    default: getUserAgent(),
  },
);

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
      userAgent,
      allowPrivateAddresses,
      maxRedirection,
    }),
    debugOption,
  ),
  {
    brief: message`Look up WebFinger resources.`,
    description: message`Look up WebFinger resources.

The argument can be multiple.`,
  },
);

export type WebFingerCommand = InferValue<typeof webFingerCommand>;
