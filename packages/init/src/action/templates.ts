import { concat, entries, join, map, pipe, when } from "@fxts/core";
import { toMerged } from "es-toolkit";
import { readTemplate } from "../lib.ts";
import type { InitCommandData, PackageManager } from "../types.ts";
import { replace } from "../utils.ts";
import { needsDenoDotenv } from "./utils.ts";

/**
 * Loads the federation configuration file content from template.
 * Reads the default federation template and replaces placeholders with actual
 * configuration values.
 *
 * @param param0 - Configuration object containing imports, project name,
 * KV store, message queue, and package manager
 * @returns The complete federation configuration file content as a string
 */
export const loadFederation = async (
  {
    imports,
    projectName,
    kv,
    mq,
    packageManager,
  }: InitCommandData & { imports: string },
) =>
  pipe(
    await readTemplate("defaults/federation.ts"),
    replace(/\/\* imports \*\//, imports),
    replace(/\/\* logger \*\//, JSON.stringify(projectName)),
    replace(/\/\* kv \*\//, convertEnv(kv.object, packageManager)),
    replace(/\/\* queue \*\//, convertEnv(mq.object, packageManager)),
  );

/**
 * Loads logging configuration file content for the initializer.
 *
 * `loadLogging` accepts the full {@link InitCommandData} so it can read the
 * project name and the framework initializer.  It uses {@link readTemplate} to
 * read `initializer.loggingTemplate` when provided, or falls back to
 * *defaults/logging.ts*, then replaces the project name placeholder.
 *
 * @param param0 - {@link InitCommandData} containing `projectName` and
 *   `initializer`; `initializer.loggingTemplate` selects a framework-specific
 *   logging template when present.
 * @returns The complete logging configuration file content as a string
 */
export const loadLogging = async (
  { projectName, initializer }: InitCommandData,
) =>
  pipe(
    await readTemplate(initializer.loggingTemplate ?? "defaults/logging.ts"),
    replace(/\/\* project name \*\//, JSON.stringify(projectName)),
  );

/**
 * Generates import statements for KV store and message queue dependencies.
 * Merges imports from both KV and MQ configurations and creates proper
 * ES module import syntax.
 *
 * Destructured parameters:
 * - kv: KV store configuration, including module import mappings
 * - mq: Message queue configuration, including module import mappings
 * - packageManager: Package manager used for environment-specific handling
 * - env: Environment variable setup used to determine loading requirements
 *
 * @param param0 - InitCommandData containing kv, mq, packageManager, and env
 * @returns A multi-line string containing all necessary import statements
 */
export const getImports = ({ kv, mq, packageManager, env }: InitCommandData) =>
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
    when(
      () => needsDenoDotenv({ packageManager, env }),
      concat(['import "@std/dotenv/load";']),
    ),
    join("\n"),
  );

/**
 * Converts import mappings to named import string with aliases.
 * Creates proper ES module named import syntax, using aliases when the import
 * name differs from the local name.
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
 * Converts Node.js environment variable access to Deno-compatible syntax when
 * needed.
 * Transforms `process.env.VAR_NAME` to `Deno.env.get("VAR_NAME")` for Deno
 * projects.
 *
 * @param obj - The object string containing potential environment variable
 * references
 * @param pm - The package manager (runtime) being used
 * @returns The converted object string with appropriate environment variable
 * access syntax
 */
export const convertEnv = (obj: string, pm: PackageManager) =>
  pm === "deno" && ENV_REG_EXP.test(obj)
    ? obj.replaceAll(ENV_REG_EXP, (_, g1) => `Deno.env.get("${g1}")`)
    : obj;
