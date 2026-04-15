import { createConfigContext } from "@optique/config";
import { message } from "@optique/core";
import { printError } from "@optique/run";
import { readFileSync } from "node:fs";
import { parse as parseToml } from "smol-toml";
import {
  array,
  boolean,
  check,
  forward,
  type InferOutput,
  integer,
  minValue,
  number,
  object,
  optional,
  picklist,
  pipe,
  string,
} from "valibot";

/**
 * Schema for the webfinger command configuration.
 */
const webfingerSchema = object({
  allowPrivateAddress: optional(boolean()),
  maxRedirection: optional(number()),
});

/**
 * Schema for the lookup command configuration.
 */
const lookupSchema = pipe(
  object({
    authorizedFetch: optional(boolean()),
    firstKnock: optional(
      picklist(["draft-cavage-http-signatures-12", "rfc9421"]),
    ),
    allowPrivateAddress: optional(boolean()),
    traverse: optional(boolean()),
    recurse: optional(
      picklist([
        "replyTarget",
        "quote",
        "quoteUrl",
        "https://www.w3.org/ns/activitystreams#inReplyTo",
        "https://w3id.org/fep/044f#quote",
        "https://www.w3.org/ns/activitystreams#quoteUrl",
        "https://misskey-hub.net/ns#_misskey_quote",
        "http://fedibird.com/ns#quoteUri",
      ]),
    ),
    recurseDepth: optional(pipe(number(), integer(), minValue(1))),
    suppressErrors: optional(boolean()),
    reverse: optional(boolean()),
    defaultFormat: optional(picklist(["default", "raw", "compact", "expand"])),
    separator: optional(string()),
    timeout: optional(number()),
  }),
  forward(
    check(
      (input) => !(input.traverse === true && input.recurse != null),
      "lookup.traverse and lookup.recurse cannot be used together.",
    ),
    ["recurse"],
  ),
  forward(
    check(
      (input) => input.recurse != null || input.recurseDepth == null,
      "lookup.recurseDepth requires lookup.recurse.",
    ),
    ["recurseDepth"],
  ),
);

/**
 * Schema for the inbox command configuration.
 */
const inboxSchema = object({
  actorName: optional(string()),
  actorSummary: optional(string()),
  authorizedFetch: optional(boolean()),
  noTunnel: optional(boolean()),
  follow: optional(array(string())),
  acceptFollow: optional(array(string())),
});

/**
 * Schema for the relay command configuration.
 */
const relaySchema = object({
  protocol: optional(picklist(["mastodon", "litepub"])),
  port: optional(number()),
  name: optional(string()),
  persistent: optional(string()),
  noTunnel: optional(boolean()),
  acceptFollow: optional(array(string())),
  rejectFollow: optional(array(string())),
});

/**
 * Schema for the nodeinfo command configuration.
 */
const nodeinfoSchema = object({
  raw: optional(boolean()),
  bestEffort: optional(boolean()),
  showFavicon: optional(boolean()),
  showMetadata: optional(boolean()),
});

/**
 * Schema for the complete configuration file.
 */
export const configSchema = object({
  // Global settings
  debug: optional(boolean()),
  userAgent: optional(string()),
  tunnelService: optional(
    picklist(["localhost.run", "serveo.net", "pinggy.io"]),
  ),

  // Command-specific sections
  webfinger: optional(webfingerSchema),
  lookup: optional(lookupSchema),
  inbox: optional(inboxSchema),
  relay: optional(relaySchema),
  nodeinfo: optional(nodeinfoSchema),
});

/**
 * Type representing the configuration file structure.
 */
export type Config = InferOutput<typeof configSchema>;

/**
 * Config context for use with bindConfig().
 */
export const configContext = createConfigContext({ schema: configSchema });

/**
 * Try to load and parse a TOML config file.
 * Returns an empty object if the file doesn't exist.
 * Logs a warning and returns empty object for other errors (parsing, permissions).
 */
export function tryLoadToml(filePath: string): Record<string, unknown> {
  try {
    return parseToml(readFileSync(filePath, "utf-8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {}; // File not found, which is fine.
    }
    // For other errors (e.g., parsing, permissions), warn the user.
    printError(
      message`Could not load or parse config file at ${filePath}. It will be ignored.`,
    );
    return {};
  }
}
