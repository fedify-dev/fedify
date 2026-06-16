import { bindConfig } from "@optique/config";
import {
  argument,
  choice,
  command,
  constant,
  flag,
  float,
  integer,
  map,
  merge,
  message,
  multiple,
  object,
  option,
  optional,
  optionNames,
  or,
  string,
  withDefault,
} from "@optique/core";
import { path } from "@optique/run";
import { configContext } from "../config.ts";
import { createTunnelServiceOption, userAgentOption } from "../options.ts";

export const IN_REPLY_TO_IRI =
  "https://www.w3.org/ns/activitystreams#inReplyTo";
export const QUOTE_IRI = "https://w3id.org/fep/044f#quote";
export const QUOTE_URL_IRI = "https://www.w3.org/ns/activitystreams#quoteUrl";
export const MISSKEY_QUOTE_IRI = "https://misskey-hub.net/ns#_misskey_quote";
export const FEDIBIRD_QUOTE_IRI = "http://fedibird.com/ns#quoteUri";
export const recurseProperties = [
  "replyTarget",
  "quote",
  "quoteUrl",
  IN_REPLY_TO_IRI,
  QUOTE_IRI,
  QUOTE_URL_IRI,
  MISSKEY_QUOTE_IRI,
  FEDIBIRD_QUOTE_IRI,
] as const;
export type RecurseProperty = typeof recurseProperties[number];

const suppressErrorsOption = bindConfig(
  flag("-S", "--suppress-errors", {
    description:
      message`Suppress partial errors during traversal or recursion.`,
  }),
  {
    context: configContext,
    key: (config) => config.lookup?.suppressErrors ?? false,
    default: false,
  },
);

const allowPrivateAddressOption = bindConfig(
  flag("-p", "--allow-private-address", {
    description: message`Allow private IP addresses for URLs discovered \
during traversal or recursive object fetches. Recursive JSON-LD \
context URLs always remain blocked. URLs explicitly provided on the \
command line always allow private addresses.`,
  }),
  {
    context: configContext,
    key: (config) => config.lookup?.allowPrivateAddress ?? false,
    default: false,
  },
);

export const authorizedFetchOption = withDefault(
  object("Authorized fetch options", {
    authorizedFetch: bindConfig(
      map(
        flag("-a", "--authorized-fetch", {
          description: message`Sign the request with an one-time key.`,
        }),
        () => true as const,
      ),
      {
        context: configContext,
        key: (config) => config.lookup?.authorizedFetch ? true : undefined,
      },
    ),
    firstKnock: bindConfig(
      option(
        "--first-knock",
        choice(["draft-cavage-http-signatures-12", "rfc9421"]),
        {
          description: message`The first-knock spec for ${
            optionNames(["-a", "--authorized-fetch"])
          }. It is used for the double-knocking technique.`,
        },
      ),
      {
        context: configContext,
        key: (config) =>
          config.lookup?.firstKnock ?? "draft-cavage-http-signatures-12",
        default: "draft-cavage-http-signatures-12" as const,
      },
    ),
    tunnelService: optional(createTunnelServiceOption()),
  }),
  {
    authorizedFetch: false as const,
    firstKnock: undefined,
    tunnelService: undefined,
  } as const,
);

const lookupModeOption = withDefault(
  or(
    object("Recurse options", {
      traverse: constant(false as const),
      recurse: bindConfig(
        option(
          "--recurse",
          choice(recurseProperties, { metavar: "PROPERTY" }),
          {
            description: message`Recursively follow a relationship property.`,
          },
        ),
        {
          context: configContext,
          key: (config) => config.lookup?.recurse,
        },
      ),
      recurseDepth: bindConfig(
        option(
          "--recurse-depth",
          integer({ min: 1, metavar: "DEPTH" }),
          {
            description: message`Maximum recursion depth for ${
              optionNames(["--recurse"])
            }.`,
          },
        ),
        {
          context: configContext,
          key: (config) => config.lookup?.recurseDepth,
          default: 20,
        },
      ),
      suppressErrors: suppressErrorsOption,
    }),
    object("Traverse options", {
      traverse: bindConfig(
        flag("-t", "--traverse", {
          description:
            message`Traverse the given collection(s) to fetch all items.`,
        }),
        {
          context: configContext,
          key: (config) => config.lookup?.traverse ?? false,
          default: false,
        },
      ),
      recurse: constant(undefined),
      recurseDepth: constant(undefined),
      suppressErrors: suppressErrorsOption,
    }),
  ),
  {
    traverse: false,
    recurse: undefined,
    recurseDepth: undefined,
    suppressErrors: false,
  } as const,
);

export const lookupOptions = merge(
  object({ command: constant("lookup") }),
  lookupModeOption,
  authorizedFetchOption,
  merge(
    "Network options",
    userAgentOption,
    object({
      allowPrivateAddress: allowPrivateAddressOption,
      timeout: optional(
        bindConfig(
          option(
            "-T",
            "--timeout",
            float({ min: 0, metavar: "SECONDS" }),
            {
              description:
                message`Set timeout for network requests in seconds.`,
            },
          ),
          {
            context: configContext,
            key: (config) => config.lookup?.timeout,
          },
        ),
      ),
    }),
  ),
  object("Arguments", {
    urls: multiple(
      argument(string({ metavar: "URL_OR_HANDLE" }), {
        description: message`One or more URLs or handles to look up.`,
      }),
      { min: 1 },
    ),
  }),
  object("Output options", {
    reverse: bindConfig(
      flag("--reverse", {
        description:
          message`Reverse the output order of fetched objects or items.`,
      }),
      {
        context: configContext,
        key: (config) => config.lookup?.reverse ?? false,
        default: false,
      },
    ),
    format: bindConfig(
      optional(
        or(
          map(
            flag("-r", "--raw", {
              description: message`Print the fetched JSON-LD document as is.`,
            }),
            () => "raw" as const,
          ),
          map(
            flag("-C", "--compact", {
              description: message`Compact the fetched JSON-LD document.`,
            }),
            () => "compact" as const,
          ),
          map(
            flag("-e", "--expand", {
              description: message`Expand the fetched JSON-LD document.`,
            }),
            () => "expand" as const,
          ),
        ),
      ),
      {
        context: configContext,
        key: (config) => config.lookup?.defaultFormat ?? "default",
        default: "default",
      },
    ),
    separator: bindConfig(
      option("-s", "--separator", string({ metavar: "SEPARATOR" }), {
        description:
          message`Specify the separator between adjacent output objects or collection items.`,
      }),
      {
        context: configContext,
        key: (config) => config.lookup?.separator ?? "----",
        default: "----",
      },
    ),
    output: optional(option(
      "-o",
      "--output",
      path({
        metavar: "OUTPUT_PATH",
        type: "file",
        allowCreate: true,
      }),
      { description: message`Specify the output file path.` },
    )),
  }),
);

export const lookupMetadata = {
  brief: message`Look up Activity Streams objects.`,
  description: message`Look up Activity Streams objects by URL or actor handle.

The arguments can be either URLs or actor handles (e.g., ${"@username@domain"}), and they can be multiple.`,
};

export const lookupCommand = command(
  "lookup",
  lookupOptions,
  lookupMetadata,
);
