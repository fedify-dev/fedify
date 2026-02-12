import { initOptions, runInit } from "@fedify/init";
import { message, optionNames } from "@optique/core";
import { run } from "@optique/run";
import { merge } from "es-toolkit";

const result = run(initOptions, {
  programName: "@fedify/create",
  description: message`Create a new Fedify project.

Unless you specify all options (${optionNames(["-w", "--web-framework"])}, ${
    optionNames(["-p", "--package-manager"])
  }, ${optionNames(["-k", "--kv-store"])}, and ${
    optionNames(["-m", "--message-queue"])
  }), it will prompt you to select the options interactively.`,
  help: "both",
});

await runInit(merge(result, { command: "init" } as const));
