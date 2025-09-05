import { or } from "@optique/core";
import { run } from "@optique/run";
import { inboxCommand, runInbox } from "./inbox.ts";
import { initCommand, runInit } from "./init.ts";
import { lookupCommand, runLookup } from "./lookup.ts";
import { nodeInfoCommand, runNodeInfo } from "./nodeinfo.ts";
import { runTunnel, tunnelCommand } from "./tunnel.ts";
import { runWebFinger, webFingerCommand } from "./webfinger.ts";

const command = or(
  initCommand,
  webFingerCommand,
  lookupCommand,
  inboxCommand,
  nodeInfoCommand,
  tunnelCommand,
);

async function main() {
  const result = run(command, {
    programName: "fedify",
    help: "both",
  });
  if (result.command === "init") {
    runInit(result);
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
    runTunnel(result);
  }
}

await main();
