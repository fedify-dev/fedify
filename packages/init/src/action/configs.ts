import {
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
import oxfmt from "../json/oxfmt.json" with { type: "json" };
import oxlint from "../json/oxlint.json" with { type: "json" };
import vscodeSettingsForDeno from "../json/vscode-settings-for-deno.json" with {
  type: "json",
};
import vscodeSettings from "../json/vscode-settings.json" with {
  type: "json",
};
import type { InitCommandData } from "../types.ts";
import { merge } from "../utils.ts";
import { getPackagesPath } from "./const.ts";
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
    ...(data.testMode && !data.dryRun ? { links: getLinks(data) } : {}),
  },
});

const getUnstable = <T extends Pick<InitCommandData, "kv" | "mq">>({
  kv: { denoUnstable: kv = [] },
  mq: { denoUnstable: mq = [] },
}: T): { unstable?: string[] } => {
  const unstable = pipe(
    needsUnstableTemporal() ? ["temporal"] : [],
    concat(kv),
    concat(mq),
    uniq,
    toArray,
  );
  return isEmpty(unstable) ? {} : { unstable };
};

type Version = [number, number, number];
const TEMPORAL_STABLE_FROM: Version = [2, 7, 0] as const;

const needsUnstableTemporal = (): boolean => {
  const version = pipe(
    getDenoVersionFromRuntime(),
    when(isNull, getDenoVersionFromCommand),
    when(isString, parseVersion),
  );
  return isArray(version)
    ? !isLaterOrEqualThan(TEMPORAL_STABLE_FROM)(version)
    : false;
};

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
    unless(isNull, ([, ...segments]) => segments.map(Number) as Version),
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
    map((dep) => joinPath(getPackagesPath(), dep)),
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

export const loadOxfmtConfig = (
  data: InitCommandData,
) => ({
  path: joinPath(".oxfmtrc.json"),
  data: withFormatIgnorePatterns(oxfmt, data),
});

export const loadOxlintConfig = (
  data: InitCommandData,
) => ({
  path: joinPath(".oxlintrc.json"),
  data: withFormatIgnorePatterns(oxlint, data),
});

export const loadVscodeSettings = (
  data: InitCommandData,
) => ({
  path: devToolConfigs.vscSet.path,
  data: data.initializer.format?.tool === "prettier"
    ? getVscodeSettingsForPrettier()
    : vscodeSettings,
});

export const loadVscodeExtensions = (
  data: InitCommandData,
) => ({
  path: devToolConfigs.vscExt.path,
  data: data.initializer.format?.tool === "prettier"
    ? {
      recommendations: [
        "astro-build.astro-vscode",
        "esbenp.prettier-vscode",
        "oxc.oxc-vscode",
      ],
    }
    : devToolConfigs.vscExt.data,
});

const withFormatIgnorePatterns = <
  T extends { ignorePatterns?: string[] },
>(
  config: T,
  data: InitCommandData,
): T => ({
  ...config,
  ignorePatterns: [
    ...new Set([
      ...(config.ignorePatterns ?? []),
      ...(data.initializer.format?.ignorePatterns ?? []),
    ]),
  ].sort(),
});

function getVscodeSettingsForPrettier(): object {
  const { "oxc.fmt.configPath": _configPath, ...settings } = vscodeSettings;
  const prettierSettings: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (key.startsWith("[") && typeof value === "object" && value != null) {
      prettierSettings[key] = {
        ...value,
        "editor.defaultFormatter": "esbenp.prettier-vscode",
      };
    } else {
      prettierSettings[key] = value;
    }
  }
  return {
    ...prettierSettings,
    "[astro]": {
      "editor.defaultFormatter": "esbenp.prettier-vscode",
      "editor.formatOnSave": true,
    },
  };
}

/**
 * Configuration objects for various development tool setup files.
 * Contains predefined configurations for code formatting, VS Code settings, and extensions
 * based on the project type (Node.js/Bun or Deno).
 */
export const devToolConfigs = {
  oxfmt: {
    path: joinPath(".oxfmtrc.json"),
    data: oxfmt,
  },
  oxlint: {
    path: joinPath(".oxlintrc.json"),
    data: oxlint,
  },
  vscExt: {
    path: joinPath(".vscode", "extensions.json"),
    data: { recommendations: ["oxc.oxc-vscode"] },
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
