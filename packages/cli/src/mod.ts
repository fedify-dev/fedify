#!/usr/bin/env node
import { or } from "@optique/core";
import { run } from "@optique/run";
import {
  generateVocabCommand,
  runGenerateVocab,
} from "./generate-vocab/mod.ts";
import { inboxCommand, runInbox } from "./inbox.tsx";
import { initCommand, runInit } from "./init/mod.ts";
import { lookupCommand, runLookup } from "./lookup.ts";
import { nodeInfoCommand, runNodeInfo } from "./nodeinfo.ts";
import { runTunnel, tunnelCommand } from "./tunnel.ts";
import { runWebFinger, webFingerCommand } from "./webfinger/mod.ts";

const command = or(
  initCommand,
  webFingerCommand,
  lookupCommand,
  inboxCommand,
  nodeInfoCommand,
  tunnelCommand,
  generateVocabCommand,
);

async function main() {
  const result = run(command, {
    programName: "fedify",
    help: "both",
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
}

await main();
