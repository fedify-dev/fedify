import { or } from "@optique/core";
import { run } from "@optique/run";
import { lookupCommand, runLookup } from "./lookup.ts";
import { runWebFinger, webFingerCommand } from "./webfinger.ts";

const command = or(
  lookupCommand,
  webFingerCommand,
);

async function main() {
  const result = run(command, {
    programName: "fedify",
    help: "both",
  });
  if (result.command === "lookup") {
    await runLookup(result);
  }
  if (result.command === "webfinger") {
    runWebFinger(result);
  }
}

await main();
