import { concat, filter, keys, map, pipe, toArray } from "@fxts/core/index.js";
import { uniq } from "es-toolkit";
import { join as joinPath } from "node:path";
import { merge } from "../../utils.ts";
import biome from "../json/biome.json" with { type: "json" };
import vscodeSettingsForDeno from "../json/vscode-settings-for-deno.json" with {
  type: "json",
};
import vscodeSettings from "../json/vscode-settings.json" with {
  type: "json",
};
import type { InitCommandData } from "../types.ts";

/**
 * Loads Deno configuration object with compiler options, unstable features, and tasks.
 * Combines unstable features required by KV store and message queue with framework-specific options.
 *
 * @param param0 - Destructured initialization data containing KV, MQ, initializer, and directory
 * @returns Configuration object with path and Deno-specific settings
 */
export const loadDenoConfig = (
  { kv, mq, initializer, dir, testMode }: InitCommandData,
) => ({
  path: joinPath(dir, "deno.json"),
  data: {
    compilerOptions: initializer.compilerOptions,
    unstable: pipe(
      ["temporal"],
      concat(kv.denoUnstable ?? []),
      concat(mq.denoUnstable ?? []),
      toArray,
      uniq,
    ),
    tasks: initializer.tasks,
    ...(testMode ? { links: getLinks({ kv, mq, initializer }) } : {}),
  },
});

const getLinks = <
  T extends Pick<InitCommandData, "kv" | "mq" | "initializer">,
>({ kv, mq, initializer }: T) =>
  pipe(
    { "@fedify/fedify": "" },
    merge(initializer.dependencies),
    merge(kv.dependencies),
    merge(mq.dependencies),
    keys,
    filter((dep) => dep.includes("@fedify/")),
    map((dep) => dep.replace("@fedify/", "")),
    map((dep) => joinPath(PACKAGES_PATH, dep)),
    toArray,
  );

const PACKAGES_PATH = joinPath(
  import.meta.dirname!, // action
  "..", // init
  "..", // src
  "..", // cli
  "..", // packages
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
export const loadPackageJson = ({ initializer, dir }: InitCommandData) => ({
  path: joinPath(dir, "package.json"),
  data: {
    type: "module",
    scripts: initializer.tasks,
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
