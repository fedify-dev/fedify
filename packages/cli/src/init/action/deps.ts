import { entries, map, pipe, toArray } from "@fxts/core";
import { merge } from "../../utils.ts";
import { PACKAGE_VERSION } from "../lib.ts";
import type { InitCommandData, PackageManager } from "../types.ts";

type Deps = Record<string, string>;

export const getDependencies = (
  { initializer, kv, mq }: InitCommandData,
): Deps =>
  pipe(
    {
      "@fedify/fedify": PACKAGE_VERSION,
      "@logtape/logtape": "^1.1.0",
    },
    merge(initializer.dependencies),
    merge(kv.dependencies),
    merge(mq.dependencies),
  );

export const getDevDependencies = (
  { initializer, kv, mq }: InitCommandData,
): Deps =>
  pipe(
    {
      "@biomejs/biome": "^1.8.3",
    },
    merge(initializer.devDependencies),
    merge(kv.devDependencies),
    merge(mq.devDependencies),
  );

export function* getAddDepsArgs<
  T extends { packageManager: PackageManager; dev?: boolean },
>({ packageManager, dev = false }: T) {
  yield packageManager;
  yield "add";
  if (dev) yield "-D";
}

export const joinDepsVer = <
  T extends { packageManager: PackageManager; dependencies: Deps },
>({ packageManager: pm, dependencies }: T) =>
  pipe(
    dependencies,
    entries,
    map(([name, version]) =>
      `${getPackageName(pm, name)}@${getPackageVersion(pm, version)}`
    ),
    toArray,
  );

const getPackageName = (pm: PackageManager, name: string) =>
  pm !== "deno" && name.startsWith("npm:")
    ? name.substring(4)
    : !name.startsWith("npm:")
    ? `jsr:${name}`
    : name;

const getPackageVersion = (pm: PackageManager, version: string) =>
  pm !== "deno" && version.includes("+")
    ? version.substring(0, version.indexOf("+"))
    : version;
