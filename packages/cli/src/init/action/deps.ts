import {
  always,
  entries,
  filter,
  fromEntries,
  map,
  pipe,
  toArray,
  when,
} from "@fxts/core";
import { join as joinPath } from "node:path";
import { merge, replace } from "../../utils.ts";
import { PACKAGE_VERSION } from "../lib.ts";
import type { InitCommandData, PackageManager } from "../types.ts";
import { PACKAGES_PATH } from "./const.ts";
import { isDeno } from "./utils.ts";

type Deps = Record<string, string>;

/**
 * Gathers all dependencies required for the project based on the initializer,
 * key-value store, and message queue configurations.
 *
 * @param data - Web Framework initializer, key-value store and
 *               message queue descriptions
 * @returns A record of dependencies with their versions
 */
export const getDependencies = (
  { initializer, kv, mq, testMode, packageManager }: Pick<
    InitCommandData,
    "initializer" | "kv" | "mq" | "packageManager" | "testMode"
  >,
): Deps =>
  pipe(
    {
      "@fedify/fedify": PACKAGE_VERSION,
      "@logtape/logtape": "^1.1.0",
    },
    merge(initializer.dependencies),
    merge(kv.dependencies),
    merge(mq.dependencies),
    when(
      always(testMode),
      isDeno({ packageManager }) ? removeFedifyDeps : addLocalFedifyDeps,
    ),
    normalizePackageNames(packageManager),
  );

const removeFedifyDeps = (deps: Deps): Deps =>
  pipe(
    deps,
    entries,
    filter(([name]) => !name.includes("@fedify")),
    fromEntries,
  );

const addLocalFedifyDeps = (deps: Deps): Deps =>
  pipe(
    deps,
    entries,
    map(when(
      ([name]) => name.includes("@fedify/"),
      (
        [name, _version],
      ): [string, string] => [name, convertFedifyToLocal(name)],
    )),
    fromEntries,
  );

const convertFedifyToLocal = (name: string): string =>
  pipe(
    name,
    replace("@fedify/", ""),
    (pkg) => joinPath(PACKAGES_PATH, pkg),
  );

/** Gathers all devDependencies required for the project based on the
 * initializer, key-value store, and message queue configurations,
 * including Biome for linting/formatting.
 *
 * @param data - Web Framework initializer, key-value store
 *               and message queue descriptions
 * @returns A record of devDependencies with their versions
 */
export const getDevDependencies = (
  { initializer, kv, mq, packageManager }: Pick<
    InitCommandData,
    "initializer" | "kv" | "mq" | "packageManager"
  >,
): Deps =>
  pipe(
    {
      "@biomejs/biome": "^2.2.4",
    },
    merge(initializer.devDependencies),
    merge(kv.devDependencies),
    merge(mq.devDependencies),
    normalizePackageNames(packageManager),
  );

/**
 * Generates the command-line arguments needed to add dependencies
 * or devDependencies using the specified package manager.
 * If it is devDependencies, the '-D' flag is included.
 *
 * @param param0 - Object containing the package manager and a boolean
 *                 indicating if dev dependencies are to be added
 * @yields The command-line arguments as strings
 */
export function* getAddDepsArgs<
  T extends { packageManager: PackageManager; dev?: boolean },
>({ packageManager, dev = false }: T): Generator<string> {
  yield packageManager;
  yield "add";
  if (dev) yield "-D";
}

/**
 * Joins package names with their versions for installation dependencies.
 * For Deno, it prefixes packages with 'jsr:'
 * unless they already start with 'npm:' or 'jsr:'.
 *
 * @param data - Package manager and dependencies to be joined with versions
 * @returns \{ name: `${registry}:${package}@${version}` } for deno
 */
export const joinDepsReg = (pm: PackageManager) => //
(dependencies: Deps): Deps =>
  pipe(
    dependencies,
    entries,
    map(([name, version]): [string, string] => [
      name,
      `${name}@${getPackageVersion(pm, version)}`,
    ]),
    fromEntries,
  );

const getPackageVersion = (pm: PackageManager, version: string) =>
  pm !== "deno" && version.includes("+")
    ? version.substring(0, version.indexOf("+"))
    : version;

const normalizePackageNames = (pm: PackageManager) => (deps: Deps): Deps =>
  pipe(
    deps,
    entries,
    map(([name, version]): [string, string] => [
      getPackageName(pm, name),
      version,
    ]),
    fromEntries,
  );

const getPackageName = (pm: PackageManager, name: string) =>
  pm !== "deno"
    ? name.startsWith("npm:")
      ? name.replace("npm:", "") // not deno, have npm: prefix, remove it
      : name // not deno, no prefix, keep it
    : name.startsWith("npm:")
    ? name // deno, have npm: prefix, keep it
    : `jsr:${name}` // deno, no prefix, add jsr: prefix
;
