import { message } from "@optique/core";
import { print, printError } from "@optique/run";
import * as colors from "@std/fmt/colors";
import { flow } from "es-toolkit";
import type { RequiredNotNull } from "../../utils.ts";
import type { InitCommand } from "../command.ts";
import { logger } from "../lib.ts";
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
  options,
) =>
  logger.debug(
    "Package manager: {packageManager}; " +
      "web framework: {webFramework}; key–value store: {kvStore}; " +
      "message queue: {messageQueue}",
    options,
  );

export function noticeDry() {
  console.log(
    colors.bold(
      colors.yellow("🔍 DRY RUN MODE - No files will be created\n"),
    ),
  );
}

export function noticePrecommand({
  initializer: { command },
  dir,
}: InitCommandData) {
  console.log(colors.bold(colors.cyan("📦 Would run command:")));
  console.log(`  cd ${dir}`);
  console.log(`  ${command!.join(" ")}\n`);
}

export const recommendCreate = () =>
  console.log(colors.bold(colors.green("📄 Would create files:\n")));

export const recommendInsertJsons = () =>
  console.log(
    colors.bold(colors.green("Would create/update JSON files:\n")),
  );

export const noticeDepsIfExist = (dev = false) => () =>
  console.log(
    colors.bold(
      colors.cyan(
        `📦 Would install ${dev ? "dev " : ""}dependencies:`,
      ),
    ),
  );

export const noticeDeps = ([name, version]: [string, string]) =>
  print(message`${name}@${version}`);

export function displayFile(
  path: string,
  content: string,
  emoji: string = "📄",
  pathColor: (text: string) => string = colors.green,
) {
  console.log(pathColor(`${emoji} ${path}`));
  console.error(colors.gray("─".repeat(60)));
  console.log(content);
  console.error(colors.gray("─".repeat(60)) + "\n");
}

export const noticeConfigEnv = () =>
  printError(
    message`Note that you probably want to edit the ${".env"} file.
It currently contains the following values:\n`,
  );

export const noticeEnvKeyValue = ([key, value]: [string, string]) =>
  printError(message`  ${key}=${value}`);

export function noticeHowToRun(
  { initializer: { instruction, federationFile } }: InitCommandData,
) {
  console.error(instruction);
  console.error(`\
Start by editing the ${colors.bold(colors.blue(federationFile))} \
file to define your federation!
`);
}

export function noticeErrorWhileAddDeps(command: string[]) {
  return (error: unknown) => {
    printError(
      message`The command ${command.join(" ")} failed with the error: ${
        String(error)
      }`,
    );
    throw new Error("Failed to add dependencies.");
  };
}
