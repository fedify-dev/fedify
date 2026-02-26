import {
  concat,
  filter,
  keys,
  map,
  pick,
  pipe,
  toArray,
} from "@fxts/core/index.js";
import { uniq } from "es-toolkit";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join as joinPath, relative } from "node:path";
import biome from "../json/biome.json" with { type: "json" };
import vscodeSettingsForDeno from "../json/vscode-settings-for-deno.json" with {
  type: "json",
};
import vscodeSettings from "../json/vscode-settings.json" with {
  type: "json",
};
import type { InitCommandData } from "../types.ts";
import { merge } from "../utils.ts";
import { PACKAGES_PATH } from "./const.ts";
import { getDependencies, getDevDependencies, joinDepsReg } from "./deps.ts";

/**
 * Loads Deno configuration object with compiler options, unstable features, and tasks.
 * Combines unstable features required by KV store and message queue with framework-specific options.
 *
 * @param param0 - Destructured initialization data containing KV, MQ, initializer, and directory
 * @returns Configuration object with path and Deno-specific settings
 */
export const loadDenoConfig = (
  data: InitCommandData,
) => {
  const unstable = getUnstable(data);
  return {
    path: "deno.json",
    data: {
      ...pick(["compilerOptions", "tasks"], data.initializer),
      ...(unstable.length > 0 ? { unstable } : {}),
      nodeModulesDir: "auto",
      imports: joinDepsReg("deno")(getDependencies(data)),
      lint: { plugins: ["jsr:@fedify/lint"] },
      ...(data.testMode ? { links: getLinks(data) } : {}),
    },
  };
};

const getUnstable = <T extends Pick<InitCommandData, "kv" | "mq">>({
  kv: { denoUnstable: kv = [] },
  mq: { denoUnstable: mq = [] },
}: T) =>
  pipe(
    needsUnstableTemporal() ? ["temporal"] : [],
    concat(kv),
    concat(mq),
    toArray,
    uniq,
  );

const TEMPORAL_STABLE_FROM = [2, 7, 0] as const;

const needsUnstableTemporal = (): boolean => {
  const version = getInstalledDenoVersion();
  if (version == null) return true;
  return compareVersions(version, TEMPORAL_STABLE_FROM) < 0;
};

const getInstalledDenoVersion = (): [number, number, number] | null => {
  const deno = getDenoVersionFromRuntime();
  if (deno != null) return deno;
  try {
    const output = execFileSync("deno", ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const version = output.match(/^deno\s+(\d+)\.(\d+)\.(\d+)/m);
    if (version == null) return null;
    return [Number(version[1]), Number(version[2]), Number(version[3])];
  } catch {
    return null;
  }
};

const getDenoVersionFromRuntime = (): [number, number, number] | null => {
  const deno = (globalThis as { Deno?: { version?: { deno?: string } } }).Deno
    ?.version?.deno;
  if (deno == null) return null;
  const version = deno.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (version == null) return null;
  return [Number(version[1]), Number(version[2]), Number(version[3])];
};

const compareVersions = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
};

const getLinks = <
  T extends Pick<InitCommandData, "kv" | "mq" | "initializer" | "dir">,
>({ kv, mq, initializer, dir }: T) =>
  pipe(
    { "@fedify/fedify": "" },
    merge(initializer.dependencies),
    merge(kv.dependencies),
    merge(mq.dependencies),
    keys as (obj: object) => Iterable<string>,
    filter((dep) => dep.includes("@fedify/")),
    map((dep) => dep.replace("@fedify/", "")),
    map((dep) => joinPath(PACKAGES_PATH, dep)),
    map((absolutePath) => realpathSync(absolutePath)),
    map((realAbsolutePath) => relative(realpathSync(dir), realAbsolutePath)),
    toArray,
  );

/**
 * Loads TypeScript configuration object for Node.js/Bun projects.
 * Uses compiler options from the framework initializer.
 *
 * @param param0 - Destructured initialization data containing initializer and directory
 * @returns Configuration object with path and TypeScript compiler options
 */
export const loadTsConfig = ({ initializer, dir }: InitCommandData) => ({
  path: joinPath(dir, "tsconfig.json"),
  data: {
    compilerOptions: initializer.compilerOptions,
  },
});

/**
 * Loads package.json configuration object for Node.js/Bun projects.
 * Sets up ES modules and includes framework-specific npm scripts.
 *
 * @param param0 - Destructured initialization data containing initializer and directory
 * @returns Configuration object with path and package.json settings
 */
export const loadPackageJson = (
  data: InitCommandData,
) => ({
  path: "package.json",
  data: {
    type: "module",
    scripts: data.initializer.tasks,
    dependencies: getDependencies(data),
    devDependencies: getDevDependencies(data),
  },
});

/**
 * Configuration objects for various development tool setup files.
 * Contains predefined configurations for code formatting, VS Code settings, and extensions
 * based on the project type (Node.js/Bun or Deno).
 */
export const devToolConfigs = {
  biome: {
    path: joinPath("biome.json"),
    data: biome,
  },
  vscExt: {
    path: joinPath(".vscode", "extensions.json"),
    data: { recommendations: ["biomejs.biome", "dbaeumer.vscode-eslint"] },
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
