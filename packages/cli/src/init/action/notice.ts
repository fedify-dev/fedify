import { text } from "@optique/core";
import { flow } from "es-toolkit";
import {
  colors,
  printErrorMessage,
  printMessage,
  type RequiredNotNull,
} from "../../utils.ts";
import type { InitCommand } from "../command.ts";
import type { InitCommandData } from "../types.ts";

export function drawDinosaur() {
  const d = flow(colors.bgBlue, colors.black);
  const f = colors.blue;
  console.error(`\
${d("             ___   ")}  ${f(" _____        _ _  __")}
${d("            /'_')  ")}  ${f("|  ___|__  __| (_)/ _|_   _")}
${d("     .-^^^-/  /    ")}  ${f("| |_ / _ \\/ _` | | |_| | | |")}
${d("   __/       /     ")}  ${f("|  _|  __/ (_| | |  _| |_| |")}
${d("  <__.|_|-|_|      ")}  ${f("|_|  \\___|\\__,_|_|_|  \\__, |")}
${d("                   ")}  ${f("                      |___/")}
`);
}

export const noticeOptions: (options: RequiredNotNull<InitCommand>) => void = (
  {
    packageManager,
    webFramework,
    kvStore,
    messageQueue,
  },
) =>
  printMessage`
  Package manager: ${packageManager};
  Web framework: ${webFramework};
  Key–value store: ${kvStore};
  Message queue: ${messageQueue};
`;

export const noticeDry = () =>
  printMessage`🔍 DRY RUN MODE - No files will be created\n`;

export function noticePrecommand({
  initializer: { command },
  dir,
}: InitCommandData) {
  printMessage`📦 Would run command:`;
  printMessage`  cd ${dir}`;
  printMessage`  ${command!.join(" ")}\n`;
}

export const noticeFilesToCreate = () =>
  //
  printMessage`📄 Would create files:\n`;

export const noticeFilesToInsert = () =>
  printMessage`Would create/update JSON files:\n`;

export const noticeDepsIfExist = () =>
  printMessage`📦 Would install dependencies:`;

export const noticeDevDepsIfExist = () =>
  printMessage`📦 Would install dev dependencies:`;

export const noticeDeps = ([name, version]: [string, string]) =>
  printMessage`${name}@${version}`;

export function displayFile(
  path: string,
  content: string,
  emoji: string = "📄",
) {
  printMessage`${emoji} ${path}`;
  printMessage`${"─".repeat(60)}`;
  printMessage`${content}`;
  printMessage`${"─".repeat(60)}\n`;
}

export const noticeConfigEnv = () =>
  printMessage`Note that you probably want to edit the ${".env"} file.
It currently contains the following values:\n`;

export const noticeEnvKeyValue = ([key, value]: [string, string]) => {
  printMessage`${text(`  ${key}='${value}'`)}`;
};

export const noticeHowToRun = (
  { initializer: { instruction, federationFile } }: InitCommandData,
) =>
  printMessage`
${instruction}
    
Start by editing the ${federationFile} file to define your federation!
`;

export function noticeErrorWhileAddDeps(command: string[]) {
  return (error: unknown) => {
    printErrorMessage`The command ${command.join(" ")} failed with the error: ${
      String(error)
    }`;
    throw new Error("Failed to add dependencies.");
  };
}
