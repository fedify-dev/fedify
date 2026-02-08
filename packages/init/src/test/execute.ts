import { run } from "@optique/run";
import runInit from "../action/mod.ts";
import { initCommand } from "../command.ts";

export default async function executeInit() {
  await runInit(run(initCommand, {
    programName: "fedify-init",
    help: "both",
  }));
}

await executeInit();
