import {
  concat,
  entries,
  evolve,
  fromEntries,
  join,
  map,
  pipe,
  when,
} from "@fxts/core";
import { getLogger } from "@logtape/logtape";
import * as colors from "@std/fmt/colors";
import { dirname, join as joinPath } from "@std/path";
import { curry, flow, toMerged, uniq } from "es-toolkit";
import { readFileSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import metadata from "../../deno.json" with { type: "json" };
import {
  formatJson,
  isNotFoundError,
  merge,
  type RequiredNotNull,
  runSubCommand,
} from "../utils.ts";
import type { InitCommand } from "./command.ts";
import biome from "./templates/json/biome.json" with { type: "json" };
import kv from "./templates/json/kv.json" with { type: "json" };
import mq from "./templates/json/mq.json" with { type: "json" };
import pm from "./templates/json/pm.json" with { type: "json" };
import rt from "./templates/json/rt.json" with { type: "json" };
import vscodeSettingsForDeno from "./templates/json/vscode-settings-for-deno.json" with {
  type: "json",
};
import vscodeSettings from "./templates/json/vscode-settings.json" with {
  type: "json",
};
import type {
  KvStores,
  MessageQueues,
  PackageManager,
  PackageManagers,
  Runtimes,
} from "./types.ts";
import webFrameworks from "./webframeworks.ts";

export const PACKAGE_VERSION = metadata.version;
export const logger = getLogger(["fedify", "cli", "init"]);

const addFedifyDeps = <T extends object>(json: T): T =>
  Object.fromEntries(
    Object.entries(json).map(([key, value]) => [
      key,
      toMerged(value, {
        dependencies: {
          [`@fedify/${key}`]: PACKAGE_VERSION,
        },
      }),
    ]),
  ) as T;
export const kvStores = addFedifyDeps(kv as KvStores);
export const messageQueues = addFedifyDeps(mq as MessageQueues);
const toRegExp = (str: string): RegExp => new RegExp(str);
const convertPattern = <K extends string, T extends { outputPattern: string }>(
  obj: Record<K, T>,
): Record<K, Omit<T, "outputPattern"> & { outputPattern: RegExp }> =>
  pipe(
    obj,
    entries as (obj: Record<K, T>) => Generator<[K, T]>,
    map(([key, value]: [K, T]) =>
      [key, evolve({ outputPattern: toRegExp })(value)] as const
    ),
    fromEntries,
  ) as Record<K, Omit<T, "outputPattern"> & { outputPattern: RegExp }>;
const packageManagers = convertPattern(pm) as PackageManagers;
const runtimes = convertPattern(rt) as Runtimes;

export const getLabel = (name: string) =>
  pipe(
    name,
    whenHasLabel(webFrameworks),
    whenHasLabel(packageManagers),
    whenHasLabel(messageQueues),
    whenHasLabel(kvStores),
    whenHasLabel(runtimes),
  );
const whenHasLabel = <T extends Record<string, { label: string }>>(desc: T) =>
  when((name: string) => name in desc, (name) => desc[name as keyof T].label);

export const getInstallUrl = (pm: PackageManager) =>
  packageManagers[pm].installUrl;

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
export const logOptions: (options: RequiredNotNull<InitCommand>) => void = (
  options,
) =>
  logger.debug(
    "Package manager: {packageManager}; " +
      "web framework: {webFramework}; key–value store: {kvStore}; " +
      "message queue: {messageQueue}",
    options,
  );

export async function isPackageManagerAvailable(
  pm: PackageManager,
): Promise<boolean> {
  if (await isCommandAvailable(packageManagers[pm])) return true;
  if (process.platform !== "win32") return false;
  const cmd: [string, ...string[]] = [
    packageManagers[pm].checkCommand[0] + ".cmd",
    ...packageManagers[pm].checkCommand.slice(1),
  ];
  if (
    await isCommandAvailable({
      ...packageManagers[pm],
      checkCommand: cmd,
    })
  ) return true;
  return false;
}

export const readTemplate: (templatePath: string) => string = (
  templatePath,
) =>
  readFileSync(
    joinPath(import.meta.dirname!, "templates", ...templatePath.split("/")),
    "utf8",
  );

export const getInstruction: (
  packageManager: PackageManager,
) => string = (pm) => `
To start the server, run the following command:

  ${getDevCommand(pm)}

Then, try look up an actor from your server:

  ${
  colors.bold(colors.green(
    "fedify lookup http://localhost:8000/users/john",
  ))
}

`;
export const mergeVscSettings = curry(toMerged)(vscodeSettings);

const getDevCommand = (pm: PackageManager) =>
  colors.bold(
    colors.green(
      pm === "deno"
        ? "deno task dev"
        : pm === "bun"
        ? "bun dev"
        : `${pm} run dev`,
    ),
  );

async function isCommandAvailable(
  { checkCommand, outputPattern }: {
    checkCommand: [string, ...string[]];
    outputPattern: RegExp;
  },
): Promise<boolean> {
  try {
    const { stdout } = await runSubCommand(checkCommand, {
      stdio: [null, "pipe", null],
    });
    logger.debug(
      "The stdout of the command {command} is: {stdout}",
      { command: checkCommand, stdout },
    );
    return outputPattern.exec(stdout.trim()) ? true : false;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    logger.debug(
      "The command {command} failed with the error: {error}",
      { command: checkCommand, error },
    );
    throw error;
  }
}

export async function addDependencies(
  pm: PackageManager,
  dir: string,
  dependencies: Record<string, string>,
  dev: boolean = false,
): Promise<void> {
  const deps = Object.entries(dependencies)
    .map(([name, version]) =>
      `${
        pm !== "deno" && name.startsWith("npm:")
          ? name.substring(4)
          : pm === "deno" && !name.startsWith("npm:")
          ? `jsr:${name}`
          : name
      }@${
        pm !== "deno" && version.includes("+")
          ? version.substring(0, version.indexOf("+"))
          : version
      }`
    );
  if (deps.length < 1) return;

  const command = [
    pm,
    "add",
    ...(dev ? [pm === "bun" || pm === "yarn" ? "--dev" : "--save-dev"] : []),
    ...uniq(deps),
  ];

  try {
    await runSubCommand(command, {
      cwd: dir,
      stdio: "inherit",
    });
  } catch (_error) {
    throw new Error("Failed to add dependencies.");
  }
}

export async function rewriteFile(
  path: string,
  content: string | object,
): Promise<[string, string]> {
  const prev = await readFileIfExists(path);
  const data = typeof content === "object"
    ? formatJson(mergeJson(prev, content))
    : appendText(prev, content);
  return [path, data];
}

const mergeJson = (prev: string, data: object): string =>
  pipe(prev ? JSON.parse(prev) : {}, merge(data), formatJson);

const appendText = (prev: string, data: string) =>
  pipe(data.split("\n"), concat(prev.split("\n")), join("\n"));

async function readFileIfExists(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return "";
  }
}

export async function createFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

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

export const rewriters = {
  biome: {
    path: joinPath("biome.json"),
    data: biome,
  },
  vscExt: {
    path: joinPath(".vscode", "extensions.json"),
    data: { recommendations: ["biomejs.biome"] },
  },
  vscSet: {
    path: joinPath(".vscode", "settings.json"),
    data: vscodeSettings,
  },
  vscSetDeno: {
    path: joinPath(".vscode", "settings.json"),
    data: vscodeSettingsForDeno,
  },
  vscExtDeno: {
    path: joinPath(".vscode", "extensions.json"),
    data: { recommendations: ["denoland.vscode-deno"] },
  },
} as const;

export const isDirectoryEmpty = async (
  path: string,
): Promise<boolean> => {
  try {
    const files = await readdir(path);
    return files.length === 0;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      throw e;
    }
    return true;
  }
};

export const getNextInitCommand = (
  pm: PackageManager,
): string[] => [
  ...createNextAppCommand(pm),
  ".",
  "--ts",
  "--app",
  "--skip-install",
];
const createNextAppCommand = (pm: PackageManager): string[] =>
  pm === "deno"
    ? ["deno", "run", "-A", "npm:create-next-app@latest"]
    : pm === "bun"
    ? ["bun", "create", "next-app"]
    : pm === "npm"
    ? ["npx", "create-next-app"]
    : [pm, "dlx", "create-next-app"];
export const getNitroInitCommand = (
  pm: PackageManager,
): string[] => [
  ...createNitroAppCommand(pm),
  pm === "deno" ? "npm:giget@latest" : "giget@latest",
  "nitro",
  ".",
];
const createNitroAppCommand = (pm: PackageManager): string[] =>
  pm === "deno"
    ? ["deno", "run", "-A"]
    : pm === "bun"
    ? ["bunx"]
    : pm === "npm"
    ? ["npx"]
    : [pm, "dlx"];
