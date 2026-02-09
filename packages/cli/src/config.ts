import { createConfigContext } from "@optique/config";
import { readFileSync } from "node:fs";
import { parse as parseToml } from "smol-toml";
import {
  array,
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
  timeout: optional(number()),
});

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
  logFile: optional(string()),
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
 * Returns an empty object if the file doesn't exist or fails to parse.
 */
export function tryLoadToml(path: string): Record<string, unknown> {
  try {
    return parseToml(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}
