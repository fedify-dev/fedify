#!/usr/bin/env node
import { runWithConfig } from "@optique/config/run";
import { merge, message, or } from "@optique/core";
import { printError } from "@optique/run";
import { merge as deepMerge } from "es-toolkit";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
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
    initCommand,
    webFingerCommand,
    lookupCommand,
    inboxCommand,
    nodeInfoCommand,
    tunnelCommand,
    generateVocabCommand,
    relayCommand,
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
    },
  });
  if (result.command === "init") {
    await runInit(result);
  }
  if (result.command === "lookup") {
    await runLookup(result);
  }
  if (result.command === "webfinger") {
    await runWebFinger(result);
  }
  if (result.command === "inbox") {
    runInbox(result);
  }
  if (result.command === "nodeinfo") {
    runNodeInfo(result);
  }
  if (result.command === "tunnel") {
    await runTunnel(result);
  }
  if (result.command === "generate-vocab") {
    await runGenerateVocab(result);
  }
  if (result.command === "relay") {
    await runRelay(result);
  }
}

await main();
