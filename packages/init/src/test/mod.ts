import { run } from "@optique/run";
import process from "node:process";
import { testInitCommand } from "../command.ts";
import runTestInit from "./action.ts";

async function main() {
  const result = run(testInitCommand, {
    programName: "fedify-test-init",
    help: "both",
  });
  await runTestInit(result);
  // Force exit: dax's piped stdout/stderr streams keep internal async ops
  // alive after SIGKILL, preventing the event loop from draining naturally.
  process.exit(0);
}

await main();
