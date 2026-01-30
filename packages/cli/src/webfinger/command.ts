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
  optional,
  string,
  withDefault,
} from "@optique/core";
import { debugOption } from "../options.ts";

const userAgent = optional(option(
  "-u",
  "--user-agent",
  string({ metavar: "USER_AGENT" }),
  { description: message`The custom User-Agent header value.` },
));

const allowPrivateAddresses = optional(flag("-p", "--allow-private-address", {
  description: message`Allow private IP addresses in the URL.`,
}));

const maxRedirection = withDefault(
  option(
    "--max-redirection",
    integer({ min: 0 }),
    { description: message`Maximum number of redirections to follow.` },
  ),
  5,
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
