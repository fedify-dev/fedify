import { message } from "@optique/core";
import { printError } from "@optique/run";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { env, exit } from "node:process";
import { parse as parseToml, type TomlTable } from "smol-toml";
import {
  boolean,
  type InferOutput,
  number,
  object,
  optional,
  picklist,
  safeParse,
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
  traverse: optional(boolean()),
  suppressErrors: optional(boolean()),
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
});

/**
 * Schema for the nodeinfo command configuration.
 */
const nodeinfoSchema = object({
  userAgent: optional(string()),
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
});

/**
 * Type representing the configuration file structure.
 */
export type Config = InferOutput<typeof configSchema>;

function getUserConfigPath(): string {
  const xdgConfigHome = env.XDG_CONFIG_HOME;
  const baseDir = xdgConfigHome || join(homedir(), ".config");
  return join(baseDir, "fedify", "config.toml");
}

/**
 * Default config file paths in order of priority (lowest to highest).
 */
const CONFIG_PATHS = [
  "/etc/fedify/config.toml",
  getUserConfigPath(),
  ".fedify.toml",
];

async function loadConfigFile(configPath: string): Promise<string | null> {
  let contents: string;
  try {
    contents = await readFile(configPath, "utf-8");
  } catch {
    // silently fail when it failed to read file
    return null;
  }
  return contents;
}

function parseConfigFile(contents: string, configPath: string): Config | null {
  let toml: TomlTable;
  try {
    toml = parseToml(contents);
  } catch {
    printError(message`Invalid TOML syntax in ${configPath}`);
    return null;
  }

  const results = safeParse(configSchema, toml);
  if (!results.success) {
    printError(
      message`Invalid configuration in ${configPath}: ${
        results.issues[0].message
      }`,
    );
    return null;
  }
  return results.output;
}

function mergeSection<T>(
  target: T | undefined,
  source: T | undefined,
): T | undefined {
  if (!target) return source;
  if (!source) return target;
  return { ...target, ...source } as T;
}

function mergeConfig(target: Config, source: Config): Config {
  return {
    debug: source.debug ?? target.debug,
    lookup: mergeSection(target.lookup, source.lookup),
    webfinger: mergeSection(target.webfinger, source.webfinger),
    inbox: mergeSection(target.inbox, source.inbox),
    relay: mergeSection(target.relay, source.relay),
    nodeinfo: mergeSection(target.nodeinfo, source.nodeinfo),
  };
}

/**
 * Load and merge configuration from the standard hierarchy.
 *
 * Priority order (lowest to highest):
 *
 *  1. /etc/fedify/config.toml (system-wide)
 *  2. ~/.config/fedify/config.toml (user)
 *  3. ./.fedify.toml (project-local)
 *  4. --config PATH (explicit, if provided)
 *
 * @param explicitConfigPath - Optional explicit config path from --config option
 * @param ignoreConfig - If true, skip all config files and return empty config
 * @returns The merged configuration object
 * @exits 1 if explicit config path is provided but file can't be read or parsed
 */
export async function loadConfig(
  explicitConfigPath?: string,
  ignoreConfig: boolean = false,
): Promise<Config> {
  if (ignoreConfig) {
    return {};
  }

  let config: Config = {};

  for (const configPath of CONFIG_PATHS) {
    const contents = await loadConfigFile(configPath);
    if (!contents) {
      continue;
    }
    const loaded = parseConfigFile(contents, configPath);
    if (loaded) {
      config = mergeConfig(config, loaded);
    }
  }

  if (explicitConfigPath) {
    const contents = await loadConfigFile(explicitConfigPath);
    if (!contents) {
      printError(
        message`Failed to read config file ${explicitConfigPath}`,
      );
      exit(1);
    }
    const loaded = parseConfigFile(contents, explicitConfigPath);
    if (!loaded) {
      exit(1);
    }
    config = mergeConfig(config, loaded);
  }

  return config;
}
