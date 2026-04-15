import { group, merge, message, or } from "@optique/core";
import { printError, run } from "@optique/run";
import { merge as deepMerge } from "es-toolkit";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { parse as parseToml } from "smol-toml";
import { configContext, tryLoadToml } from "./config.ts";
import { generateVocabCommand } from "./generate-vocab/mod.ts";
import { inboxCommand } from "./inbox/command.ts";
import { initCommand } from "./init/mod.ts";
import { lookupCommand } from "./lookup.ts";
import { nodeInfoCommand } from "./nodeinfo.ts";
import { globalOptions } from "./options.ts";
import { relayCommand } from "./relay/command.ts";
import { tunnelCommand } from "./tunnel.ts";
import { webFingerCommand } from "./webfinger/mod.ts";
import metadata from "../deno.json" with { type: "json" };

/**
 * Returns the system-wide configuration file paths.
 * - Linux/macOS: Searches `$XDG_CONFIG_DIRS` (default: /etc/xdg)
 * - Windows: Uses `%ProgramData%` (default: C:\ProgramData)
 */
function getSystemConfigPaths(): string[] {
  if (process.platform === "win32") {
    const programData = process.env.ProgramData || "C:\\ProgramData";
    return [join(programData, "fedify", "config.toml")];
  }
  return (process.env.XDG_CONFIG_DIRS || "/etc/xdg")
    .split(":")
    .map((dir) => join(dir, "fedify", "config.toml"));
}

/**
 * Returns the user-level configuration file path.
 * - Linux/macOS: `$XDG_CONFIG_HOME/fedify/config.toml` (default: ~/.config)
 * - Windows: `%APPDATA%\fedify\config.toml`
 */
function getUserConfigPath(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ||
      join(homedir(), "AppData", "Roaming");
    return join(appData, "fedify", "config.toml");
  }
  const xdgConfigHome = process.env.XDG_CONFIG_HOME ||
    join(homedir(), ".config");
  return join(xdgConfigHome, "fedify", "config.toml");
}

export const command = merge(
  or(
    group(
      "Generating code",
      or(
        initCommand,
        generateVocabCommand,
      ),
    ),
    group(
      "ActivityPub tools",
      or(
        webFingerCommand,
        lookupCommand,
        inboxCommand,
        nodeInfoCommand,
        relayCommand,
      ),
    ),
    group(
      "Network tools",
      tunnelCommand,
    ),
  ),
  globalOptions,
);

type ConfigOptions = {
  ignoreConfig: boolean;
  configPath?: string;
};

export function loadConfig(
  parsed: ConfigOptions,
): { config: Record<string, unknown>; meta: undefined } | undefined {
  if (parsed.ignoreConfig) return undefined;

  // Load system-wide configs (XDG_CONFIG_DIRS on Linux/macOS, ProgramData on Windows)
  const systemConfigs = getSystemConfigPaths().map(tryLoadToml);
  const system = systemConfigs.reduce(
    (acc, config) => deepMerge(acc, config),
    {},
  );
  const user = tryLoadToml(getUserConfigPath());
  const project = tryLoadToml(join(process.cwd(), ".fedify.toml"));

  // Custom config via --config exits with error if file is missing or invalid
  let custom: Record<string, unknown> = {};
  if (parsed.configPath) {
    try {
      custom = parseToml(readFileSync(parsed.configPath, "utf-8"));
    } catch (error) {
      printError(
        message`Could not load config file at ${parsed.configPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      process.exit(1);
    }
  }

  return {
    config: [system, user, project, custom].reduce(
      (acc, config) => deepMerge(acc, config),
      {},
    ),
    meta: undefined,
  };
}

/**
 * Runs the Fedify CLI with the given command-line arguments.
 * @param args Command-line arguments, usually `process.argv.slice(2)`.
 * @returns The parsed command result from Optique's runner.
 */
export function runCli(args: string[]) {
  return run(command, {
    contexts: [configContext],
    contextOptions: { load: loadConfig },
    programName: "fedify",
    args,
    help: {
      command: { group: "Meta commands" },
      option: { group: "Meta commands" },
    },
    version: {
      value: metadata.version,
      command: { group: "Meta commands" },
      option: { group: "Meta commands" },
    },
    completion: {
      command: {
        names: ["completions", "completion"],
        group: "Meta commands",
      },
    },
    colors: process.stdout.isTTY &&
      (process.env.NO_COLOR == null || process.env.NO_COLOR === ""),
    maxWidth: process.stdout.columns,
    showDefault: true,
    showChoices: true,
  });
}
