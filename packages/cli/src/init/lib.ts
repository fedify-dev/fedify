import {
  entries,
  evolve,
  fromEntries,
  isObject,
  map,
  negate,
  pipe,
  throwIf,
  when,
} from "@fxts/core";
import { getLogger } from "@logtape/logtape";
import type { Message } from "@optique/core";
import { commandLine, message } from "@optique/core/message";
import { toMerged } from "es-toolkit";
import { readFileSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join as joinPath } from "node:path";
import process from "node:process";
import metadata from "../../deno.json" with { type: "json" };
import { isNotFoundError, runSubCommand } from "../utils.ts";
import kv from "./json/kv.json" with { type: "json" };
import mq from "./json/mq.json" with { type: "json" };
import pm from "./json/pm.json" with { type: "json" };
import rt from "./json/rt.json" with { type: "json" };
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
    joinPath(
      import.meta.dirname!,
      "templates",
      ...(templatePath + ".tpl").split("/"),
    ),
    "utf8",
  );

export const getInstruction: (
  packageManager: PackageManager,
) => Message = (pm) =>
  message`
To start the server, run the following command:

  ${commandLine(getDevCommand(pm))}

Then, try look up an actor from your server:

  ${commandLine("fedify lookup http://localhost:8000/users/john")}

`;

const getDevCommand = (pm: PackageManager) =>
  pm === "deno" ? "deno task dev" : pm === "bun" ? "bun dev" : `${pm} run dev`;

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

export async function createFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

const isNotExistsError = (e: unknown) =>
  isObject(e) && "code" in e && e.code === "ENOENT";

export const throwUnlessNotExists = throwIf(negate(isNotExistsError));

export const isDirectoryEmpty = async (
  path: string,
): Promise<boolean> => {
  try {
    const files = await readdir(path);
    return files.length === 0;
  } catch (e) {
    throwUnlessNotExists(e);
    return true;
  }
};

export const getNextInitCommand = (
  pm: PackageManager,
): string[] => [...createNextAppCommand(pm), ".", "--yes"];

const createNextAppCommand = (pm: PackageManager): string[] =>
  pm === "deno"
    ? ["deno", "-Ar", "npm:create-next-app@latest"]
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

export const isTest: <
  T extends { testMode: boolean },
>({ testMode }: T) => boolean = ({ testMode }) => testMode;
