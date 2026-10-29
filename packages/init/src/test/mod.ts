import { run } from "@optique/run";
import process from "node:process";
import { isMain } from "../../../../scripts/tooling_main.ts";
import { testInitCommand } from "../command.ts";
import runTestInit from "./action.ts";
import { TestInterruptedError } from "./cancel.ts";

export async function main(action: typeof runTestInit = runTestInit) {
  const result = run(testInitCommand, {
    programName: "fedify-test-init",
    help: "both",
  });
  try {
    process.exitCode = await action(result) ? 0 : 1;
  } catch (error) {
    if (!(error instanceof TestInterruptedError)) throw error;
    process.exitCode = error.exitCode;
  }
}

if (isMain(import.meta.url)) {
  await main();
}
