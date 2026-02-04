#!/usr/bin/env node
import { createConfigContext } from "@optique/config";
import { runWithConfig } from "@optique/config/run";
import { merge, or } from "@optique/core";
import envPaths from "env-paths";
import { merge as deepMerge } from "es-toolkit";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { parse as parseToml } from "smol-toml";
import { configSchema, tryLoadToml } from "./config.ts";
import {
  generateVocabCommand,
  runGenerateVocab,
} from "./generate-vocab/mod.ts";
import { inboxCommand, runInbox } from "./inbox.tsx";
import { initCommand, runInit } from "./init/mod.ts";
import { lookupCommand, runLookup } from "./lookup.ts";
import { nodeInfoCommand, runNodeInfo } from "./nodeinfo.ts";
import { configOption } from "./options.ts";
import { relayCommand, runRelay } from "./relay.ts";
import { runTunnel, tunnelCommand } from "./tunnel.ts";
import { runWebFinger, webFingerCommand } from "./webfinger/mod.ts";

const configContext = createConfigContext({ schema: configSchema });

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
  configOption,
);

async function main() {
  const result = await runWithConfig(command, configContext, {
    programName: "fedify",
    load: (parsed) => {
      if (parsed.ignoreConfig) return {};

      const userConfigDir = envPaths("fedify", { suffix: "" }).config;
      const system = tryLoadToml("/etc/fedify/config.toml");
      const user = tryLoadToml(join(userConfigDir, "config.toml"));
      const project = tryLoadToml(join(process.cwd(), ".fedify.toml"));

      // Custom config via --config throws on error (required file)
      const custom = parsed.configPath
        ? parseToml(readFileSync(parsed.configPath, "utf-8"))
        : {};

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
