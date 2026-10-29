import { run } from "@optique/run";
import process from "node:process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
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

if (
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
