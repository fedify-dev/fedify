import { text } from "@optique/core";
import { flow } from "es-toolkit";
import type { InitCommand } from "../command.ts";
import type { InitCommandData } from "../types.ts";
import {
  colors,
  printErrorMessage,
  printMessage,
  type RequiredNotNull,
} from "../utils.ts";

/** Prints the Feddy ASCII art banner to stderr. */
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

/** Prints the user's selected initialization options to stdout. */
export const noticeOptions: <T extends RequiredNotNull<InitCommand>>(
  options: T,
) => void = (
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

/** Prints a dry-run mode notice indicating no files will be created. */
export const noticeDry = () =>
  printMessage`🔍 DRY RUN MODE - No files will be created\n`;

/**
 * Prints the precommand that would be run in dry-run mode,
 * showing the directory and command to execute.
 */
export function noticePrecommand({
  initializer: { command },
  dir,
}: InitCommandData) {
  printMessage`📦 Would run command:`;
  printMessage`  cd ${dir}`;
  printMessage`  ${command!.join(" ")}\n`;
}

/** Prints a header indicating that text files would be created. */
export const noticeFilesToCreate = () =>
  //
  printMessage`📄 Would create files:\n`;

/** Prints a header indicating that JSON files would be created or updated. */
export const noticeFilesToInsert = () =>
  printMessage`Would create/update JSON files:\n`;

/** Prints a header indicating that dependencies would be installed. */
export const noticeDepsIfExist = () =>
  printMessage`📦 Would install dependencies:`;

/** Prints a header indicating that dev dependencies would be installed. */
export const noticeDevDepsIfExist = () =>
  printMessage`📦 Would install dev dependencies:`;

/** Prints a single dependency name and version. */
export const noticeDeps = ([name, version]: [string, string]) =>
  printMessage`${name}@${version}`;

/**
 * Displays a file's path and content with a horizontal rule separator,
 * used in dry-run mode to preview generated files.
 */
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

/** Prints a notice recommending the user edit the `.env` file. */
export const noticeConfigEnv = () =>
  printMessage`Note that you probably want to edit the ${".env"} file.
It currently contains the following values:\n`;

/** Prints a single environment variable key-value pair. */
export const noticeEnvKeyValue = ([key, value]: [string, string]) => {
  printMessage`${text(`  ${key}='${value}'`)}`;
};

/**
 * Prints the post-initialization instructions, showing how to start
 * the dev server and where to edit the federation configuration.
 */
export const noticeHowToRun = (
  { initializer: { instruction, federationFile } }: InitCommandData,
) =>
  printMessage`
${instruction}
    
Start by editing the ${text(federationFile)} file to define your federation!
`;

/**
 * Returns an error handler that prints a formatted error message when
 * a dependency installation command fails, then throws.
 */
export function noticeErrorWhileAddDeps(command: string[]) {
  return (error: unknown) => {
    printErrorMessage`The command ${command.join(" ")} failed with the error: ${
      String(error)
    }`;
    throw new Error("Failed to add dependencies.");
  };
}
