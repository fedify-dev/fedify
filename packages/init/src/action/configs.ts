import {
  always,
  cases,
  concat,
  filter,
  head,
  isArray,
  isEmpty,
  isNull,
  isString,
  keys,
  map,
  pick,
  pipe,
  prop,
  toArray,
  uniq,
  unless,
  when,
  zip,
} from "@fxts/core/index.js";
import { getLogger } from "@logtape/logtape";
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

const logger = getLogger(["fedify", "init", "action", "configs"]);

/**
 * Loads Deno configuration object with compiler options, unstable features, and tasks.
 * Combines unstable features required by KV store and message queue with framework-specific options.
 *
 * @param param0 - Destructured initialization data containing KV, MQ, initializer, and directory
 * @returns Configuration object with path and Deno-specific settings
 */
export const loadDenoConfig = (data: InitCommandData) => ({
  path: "deno.json",
  data: {
    ...pick(["compilerOptions", "tasks"], data.initializer),
    ...getUnstable(data),
    nodeModulesDir: "auto",
    imports: joinDepsReg("deno")(getDependencies(data)),
    lint: { plugins: ["jsr:@fedify/lint"] },
    ...(data.testMode ? { links: getLinks(data) } : {}),
  },
});

const getUnstable = <T extends Pick<InitCommandData, "kv" | "mq">>({
  kv: { denoUnstable: kv = [] },
  mq: { denoUnstable: mq = [] },
}: T): { unstable?: string[] } =>
  pipe(
    needsUnstableTemporal() ? ["temporal"] : [],
    concat(kv),
    concat(mq),
    uniq,
    toArray,
    cases(isEmpty, always({}), (unstable) => ({ unstable })),
  ) as { unstable?: string[] };

type Version = [number, number, number];
const TEMPORAL_STABLE_FROM: Version = [2, 7, 0] as const;

const needsUnstableTemporal = (): boolean =>
  pipe(
    getDenoVersionFromRuntime(),
    when(isNull, getDenoVersionFromCommand),
    when(isString, parseVersion),
    cases(isArray, isLaterOrEqualThan(TEMPORAL_STABLE_FROM), always(true)),
  );

const getDenoVersionFromCommand = (): string | null => {
  try {
    return execFileSync("deno", ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    logger.debug(
      "Failed to get Deno version by executing `deno --version`: {error}",
      { error },
    );
    return null;
  }
};

const getDenoVersionFromRuntime = (): string | null =>
  pipe(
    globalThis,
    prop("Deno"),
    prop("version"),
    prop("deno"),
  );

const parseVersion: (match: string) => Version | null = (deno: string) =>
  pipe(
    deno.match(/^(\d+)\.(\d+)\.(\d+)/),
    unless(isNull, (arr) => arr.map(Number) as Version),
  );

const isLaterOrEqualThan = (basis: Version) => (target: Version): boolean =>
  pipe(
    zip(basis, target),
    filter(([b, t]) => t !== b),
    head,
    (a) => a ? a[0] < a[1] : true,
  );

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
    map(realpathSync as (path: string) => string),
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
