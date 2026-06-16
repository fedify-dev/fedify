#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { runInit } from "@fedify/init";
import process from "node:process";
import { runBench } from "./bench/mod.ts";
import { runGenerateVocab } from "./generate-vocab/mod.ts";
import { runInbox } from "./inbox.tsx";
import { runLookup } from "./lookup.ts";
import { runNodeInfo } from "./nodeinfo.ts";
import { runRelay } from "./relay.ts";
import { parseCliProgram } from "./runner.ts";
import { runTunnel } from "./tunnel.ts";
import { runWebFinger } from "./webfinger/mod.ts";

async function main() {
  const { command, value } = await parseCliProgram(process.argv.slice(2));
  switch (command.path.join(" ")) {
    case "init":
      await runInit(value as unknown as Parameters<typeof runInit>[0]);
      break;
    case "generate-vocab":
      await runGenerateVocab(
        value as unknown as Parameters<typeof runGenerateVocab>[0],
      );
      break;
    case "webfinger":
      await runWebFinger(
        value as unknown as Parameters<typeof runWebFinger>[0],
      );
      break;
    case "lookup":
      await runLookup(value as unknown as Parameters<typeof runLookup>[0]);
      break;
    case "inbox":
      await runInbox(value as unknown as Parameters<typeof runInbox>[0]);
      break;
    case "nodeinfo":
      await runNodeInfo(value as unknown as Parameters<typeof runNodeInfo>[0]);
      break;
    case "relay":
      await runRelay(value as unknown as Parameters<typeof runRelay>[0]);
      break;
    case "bench":
      await runBench(value as unknown as Parameters<typeof runBench>[0]);
      break;
    case "tunnel":
      await runTunnel(value as unknown as Parameters<typeof runTunnel>[0]);
      break;
    default:
      throw new TypeError(`Unknown command: ${command.path.join(" ")}`);
  }
}

await main();
