import {
  entries,
  evolve,
  fromEntries,
  isObject,
  map,
  negate,
  pipe,
  throwIf,
} from "@fxts/core";
import { getLogger } from "@logtape/logtape";
import { toMerged } from "es-toolkit";
import { readFileSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join as joinPath } from "node:path";
import process from "node:process";
import metadata from "../deno.json" with { type: "json" };
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
import { isNotFoundError, runSubCommand } from "./utils.ts";

/** The current `@fedify/init` package version, read from *deno.json*. */
export const PACKAGE_VERSION = metadata.version;

/** Logger instance for the `fedify init` command, scoped to `["fedify", "cli", "init"]`. */
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
/**
 * KV store descriptions loaded from *json/kv.json*, enriched with the
 * appropriate `@fedify/*` dependency at the current package version.
 */
export const kvStores = addFedifyDeps(kv as KvStores);

/**
 * Message queue descriptions loaded from *json/mq.json*, enriched with the
 * appropriate `@fedify/*` dependency at the current package version.
 */
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
/**
 * Package manager descriptions loaded from *json/pm.json*, with
 * `outputPattern` strings converted to `RegExp` instances.
 */
export const packageManagers = convertPattern(pm) as PackageManagers;

/**
 * Runtime descriptions loaded from *json/rt.json*, with `outputPattern`
 * strings converted to `RegExp` instances.
 */
export const runtimes = convertPattern(rt) as Runtimes;

/** Returns the installation URL for the given package manager. */
export const getInstallUrl = (pm: PackageManager) =>
  packageManagers[pm].installUrl;

/**
 * Checks whether a package manager is installed and available on the system.
 * Runs the package manager's check command and verifies its output.
 * On Windows, also tries the `.cmd` variant of the command.
 */
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

/**
 * Reads a template file from the *templates/* directory and returns its content.
 * Appends `.tpl` to the given path before reading.
 *
 * @param templatePath - Relative path within the templates directory
 *   (e.g., `"defaults/federation.ts"`)
 * @returns The template file content as a string
 */
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

/**
 * Returns the shell command string to start the dev server for the given
 * package manager (e.g., `"deno task dev"`, `"bun dev"`, `"npm run dev"`).
 */
export const getDevCommand = (pm: PackageManager) =>
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

/**
 * Creates a file at the given path with the given content, creating
 * any necessary parent directories along the way.
 */
export async function createFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

const isNotExistsError = (e: unknown) =>
  isObject(e) && "code" in e && e.code === "ENOENT";

/**
 * Throws the given error unless it is an `ENOENT` (file not found) error.
 * Used to silently handle missing files while re-throwing other errors.
 */
export const throwUnlessNotExists = throwIf(negate(isNotExistsError));

/**
 * Checks whether a directory is empty or does not exist.
 * Returns `true` if the directory has no entries or does not exist yet.
 */
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

/** Returns `true` if the current run is in test mode. */
export const isTest: <
  T extends { testMode: boolean },
>({ testMode }: T) => boolean = ({ testMode }) => testMode;
