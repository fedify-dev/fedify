import { entries, join, map, pipe } from "@fxts/core";
import { toMerged } from "es-toolkit";
import { replace } from "../../utils.ts";
import { readTemplate } from "../lib.ts";
import type { InitCommandData, PackageManager } from "../types.ts";

/**
 * Loads the federation configuration file content from template.
 * Reads the default federation template and replaces placeholders with actual configuration values.
 *
 * @param param0 - Configuration object containing imports, project name, KV store, message queue, and package manager
 * @returns The complete federation configuration file content as a string
 */
export const loadFederation = (
  {
    imports,
    projectName,
    kv,
    mq,
    packageManager,
  }: InitCommandData & { imports: string },
) =>
  pipe(
    "defaults/federation.ts",
    readTemplate,
    replace(/\/\* imports \*\//, imports),
    replace(/\/\* logger \*\//, JSON.stringify(projectName)),
    replace(/\/\* kv \*\//, convertEnv(kv.object, packageManager)),
    replace(/\/\* queue \*\//, convertEnv(mq.object, packageManager)),
  );

/**
 * Loads the logging configuration file content from template.
 * Reads the default logging template and replaces the project name placeholder.
 *
 * @param param0 - Destructured object containing the project name
 * @returns The complete logging configuration file content as a string
 */
export const loadLogging = ({ projectName }: InitCommandData) =>
  pipe(
    "defaults/logging.ts",
    readTemplate,
    replace(/\/\* project name \*\//, JSON.stringify(projectName)),
  );

/**
 * Generates import statements for KV store and message queue dependencies.
 * Merges imports from both KV and MQ configurations and creates proper ES module import syntax.
 *
 * @param param0 - Destructured object containing kv and mq configurations
 * @returns A multi-line string containing all necessary import statements
 */
export const getImports = ({ kv, mq }: InitCommandData) =>
  pipe(
    toMerged(kv.imports, mq.imports),
    entries,
    map(([module, { "default": defaultImport = "", ...imports }]) => //
    [module, defaultImport, getAlias(imports)]),
    map(([module, defaultImport, namedImports]) =>
      `import ${
        [defaultImport, namedImports.length > 0 ? `{ ${namedImports} }` : ""]
          .filter((x) => x.length > 0)
          .join(", ")
      } from ${JSON.stringify(module)};`
    ),
    join("\n"),
  );

/**
 * Converts import mappings to named import string with aliases.
 * Creates proper ES module named import syntax, using aliases when the import name differs from the local name.
 *
 * @param imports - A record mapping import names to their local aliases
 * @returns A comma-separated string of named imports with aliases where needed
 */
export const getAlias = (imports: Record<string, string>) =>
  pipe(
    imports,
    entries,
    map(([name, alias]) => name === alias ? name : `${name} as ${alias}`),
    join(", "),
  );

const ENV_REG_EXP = /process\.env\.(\w+)/g;
/**
 * Converts Node.js environment variable access to Deno-compatible syntax when needed.
 * Transforms `process.env.VAR_NAME` to `Deno.env.get("VAR_NAME")` for Deno projects.
 *
 * @param obj - The object string containing potential environment variable references
 * @param pm - The package manager (runtime) being used
 * @returns The converted object string with appropriate environment variable access syntax
 */
export const convertEnv = (obj: string, pm: PackageManager) =>
  pm === "deno" && ENV_REG_EXP.test(obj)
    ? obj.replaceAll(ENV_REG_EXP, (_, g1) => `Deno.env.get("${g1}")`)
    : obj;
