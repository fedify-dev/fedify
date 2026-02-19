#!/usr/bin/env node --disable-warning=ExperimentalWarning
import { runWithConfig } from "@optique/config/run";
import { group, merge, message, or } from "@optique/core";
import { printError } from "@optique/run";
import { merge as deepMerge } from "es-toolkit";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { parse as parseToml } from "smol-toml";
import { configContext, tryLoadToml } from "./config.ts";
import {
  generateVocabCommand,
  runGenerateVocab,
} from "./generate-vocab/mod.ts";
import { inboxCommand, runInbox } from "./inbox.tsx";
import { initCommand, runInit } from "./init/mod.ts";
import { lookupCommand, runLookup } from "./lookup.ts";
import { nodeInfoCommand, runNodeInfo } from "./nodeinfo.ts";
import { globalOptions } from "./options.ts";
import { relayCommand, runRelay } from "./relay.ts";
import { runTunnel, tunnelCommand } from "./tunnel.ts";
import { runWebFinger, webFingerCommand } from "./webfinger/mod.ts";
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

const command = merge(
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

async function main() {
  const result = await runWithConfig(command, configContext, {
    programName: "fedify",
    load: (parsed) => {
      if (parsed.ignoreConfig) return {};

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

      return [system, user, project, custom].reduce(
        (acc, config) => deepMerge(acc, config),
        {},
      );
    },
    args: process.argv.slice(2),
    help: {
      mode: "both",
      onShow: () => process.exit(0),
      group: "Meta commands",
    },
    version: {
      mode: "both",
      value: metadata.version,
      group: "Meta commands",
    },
    completion: {
      mode: "command",
      name: "both",
      helpVisibility: "plural",
      group: "Meta commands",
    },
    onError: () => process.exit(1),
    colors: process.stdout.isTTY &&
      (process.env.NO_COLOR == null || process.env.NO_COLOR === ""),
    maxWidth: process.stdout.columns,
    showDefault: true,
    showChoices: true,
  });
  if (result.command === "init") {
    await runInit(result);
  } else if (result.command === "lookup") {
    await runLookup(result);
  } else if (result.command === "webfinger") {
    await runWebFinger(result);
  } else if (result.command === "inbox") {
    runInbox(result);
  } else if (result.command === "nodeinfo") {
    runNodeInfo(result);
  } else if (result.command === "tunnel") {
    await runTunnel(result);
  } else if (result.command === "generate-vocab") {
    await runGenerateVocab(result);
  } else if (result.command === "relay") {
    await runRelay(result);
  } else {
    // Make this branch exhaustive for type safety, even though it should never happen:
    const _exhaustiveCheck: never = result;
  }
}

await main();
