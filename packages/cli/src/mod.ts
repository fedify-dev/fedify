#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { runGenerateVocab } from "./generate-vocab/mod.ts";
import { runInbox } from "./inbox.tsx";
import { runInit } from "./init/mod.ts";
import { runLookup } from "./lookup.ts";
import { runNodeInfo } from "./nodeinfo.ts";
import process from "node:process";
import { runRelay } from "./relay.ts";
import { runCli } from "./runner.ts";
import { runTunnel } from "./tunnel.ts";
import { runWebFinger } from "./webfinger/mod.ts";

async function main() {
  const result = await runCli(process.argv.slice(2));
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
