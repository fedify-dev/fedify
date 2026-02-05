import { createConfigContext } from "@optique/config";
import { readFileSync } from "node:fs";
import { parse as parseToml } from "smol-toml";
import {
  boolean,
  type InferOutput,
  number,
  object,
  optional,
  picklist,
  string,
} from "valibot";

/**
 * Schema for the webfinger command configuration.
 */
const webfingerSchema = object({
  userAgent: optional(string()),
  allowPrivateAddress: optional(boolean()),
  maxRedirection: optional(number()),
});

/**
 * Schema for the lookup command configuration.
 */
const lookupSchema = object({
  authorizedFetch: optional(boolean()),
  firstKnock: optional(
    picklist(["draft-cavage-http-signatures-12", "rfc9421"]),
  ),
  traverse: optional(boolean()),
  suppressErrors: optional(boolean()),
  defaultFormat: optional(picklist(["default", "raw", "compact", "expand"])),
  separator: optional(string()),
  userAgent: optional(string()),
  timeout: optional(number()),
});

/**
 * Schema for the inbox command configuration.
 */
const inboxSchema = object({
  tunnel: optional(boolean()),
  tunnelService: optional(
    picklist(["localhost.run", "serveo.net", "pinggy.io"]),
  ),
  actorName: optional(string()),
  actorSummary: optional(string()),
  authorizedFetch: optional(boolean()),
});

/**
 * Schema for the relay command configuration.
 */
const relaySchema = object({
  protocol: optional(picklist(["mastodon", "litepub"])),
  port: optional(number()),
  name: optional(string()),
  tunnel: optional(boolean()),
  tunnelService: optional(
    picklist(["localhost.run", "serveo.net", "pinggy.io"]),
  ),
  persistent: optional(string()),
  acceptFollow: optional(string()),
  rejectFollow: optional(string()),
});

/**
 * Schema for the nodeinfo command configuration.
 */
const nodeinfoSchema = object({
  userAgent: optional(string()),
  raw: optional(boolean()),
  bestEffort: optional(boolean()),
  noFavicon: optional(boolean()),
  metadata: optional(boolean()),
});

/**
 * Schema for the tunnel command configuration.
 */
const tunnelSchema = object({
  service: optional(picklist(["localhost.run", "serveo.net", "pinggy.io"])),
});

/**
 * Schema for the complete configuration file.
 */
export const configSchema = object({
  // Global settings
  debug: optional(boolean()),

  // Command-specific sections
  webfinger: optional(webfingerSchema),
  lookup: optional(lookupSchema),
  inbox: optional(inboxSchema),
  relay: optional(relaySchema),
  nodeinfo: optional(nodeinfoSchema),
  tunnel: optional(tunnelSchema),
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
 * Returns an empty object if the file doesn't exist or fails to parse.
 */
export function tryLoadToml(path: string): Record<string, unknown> {
  try {
    return parseToml(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}
