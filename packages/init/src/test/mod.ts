import { run } from "@optique/run";
import { testInitCommand } from "../command.ts";
import runTestInit from "./action.ts";

async function main() {
  console.log("Running test-init command...");
  const result = run(testInitCommand, {
    programName: "fedify-test-init",
    help: "both",
  });
  await runTestInit(result);
}

await main();
