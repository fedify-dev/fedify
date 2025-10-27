import {
  always,
  apply,
  entries,
  forEach,
  pipe,
  pipeLazy,
  tap,
} from "@fxts/core";
import { toMerged } from "es-toolkit";
import { readFile } from "node:fs/promises";
import { formatJson, merge, set } from "../../utils.ts";
import { createFile, throwUnlessNotExists } from "../lib.ts";
import type { InitCommandData } from "../types.ts";
import {
  devToolConfigs,
  loadDenoConfig,
  loadPackageJson,
  loadTsConfig,
} from "./configs.ts";
import {
  displayFile,
  noticeFilesToCreate,
  noticeFilesToInsert,
} from "./notice.ts";
import { getImports, loadFederation, loadLogging } from "./templates.ts";
import { joinDir, stringifyEnvs } from "./utils.ts";

/**
 * Main function that initializes the project by creating necessary files and configurations.
 * Handles both dry-run mode (recommending files) and actual file creation.
 * Orchestrates the entire file generation and writing process.
 *
 * @param data - The initialization command data containing project configuration
 * @returns A processed data object with files and JSONs ready for creation
 */
export const patchFiles = (data: InitCommandData) =>
  pipe(
    data,
    set("files", getFiles),
    set("jsons", getJsons),
    createFiles,
  );

export const recommendPatchFiles = (data: InitCommandData) =>
  pipe(
    data,
    set("files", getFiles),
    set("jsons", getJsons),
    recommendFiles,
  );

/**
 * Generates text-based files (TypeScript, environment files) for the project.
 * Creates federation configuration, logging setup, environment variables, and framework-specific files
 * by processing templates and combining them with project-specific data.
 *
 * @param data - The initialization command data
 * @returns A record of file paths to their string content
 */
const getFiles = <
  T extends InitCommandData,
>(data: T) => ({
  [data.initializer.federationFile.toString()]: loadFederation({
    imports: getImports(data),
    ...data,
  }),
  [data.initializer.loggingFile]: loadLogging(data),
  ".env": stringifyEnvs(data.env),
  ...data.initializer.files,
});

/**
 * Generates JSON configuration files based on the package manager type.
 * Creates different sets of configuration files for Deno vs Node.js/Bun environments,
 * including compiler configs, package manifests, and development tool configurations.
 *
 * @param data - The initialization command data
 * @returns A record of file paths to their JSON object content
 */
const getJsons = <
  T extends InitCommandData,
>(data: T): Record<string, object> =>
  data.packageManager === "deno"
    ? {
      "deno.json": loadDenoConfig(data).data,
      [devToolConfigs["vscSetDeno"].path]: devToolConfigs["vscSetDeno"].data,
      [devToolConfigs["vscExtDeno"].path]: devToolConfigs["vscExtDeno"].data,
    }
    : {
      "tsconfig.json": loadTsConfig(data).data,
      "package.json": loadPackageJson(data).data,
      [devToolConfigs["biome"].path]: devToolConfigs["biome"].data,
      [devToolConfigs["vscSet"].path]: devToolConfigs["vscSet"].data,
      [devToolConfigs["vscExt"].path]: devToolConfigs["vscExt"].data,
    };

/**
 * Handles dry-run mode by recommending files to be created without actually creating them.
 * Displays what files would be created and shows their content for user review.
 * This allows users to preview the initialization process before committing to it.
 *
 * @param data - The initialization command data with files and JSONs prepared
 * @returns The processed data with recommendations displayed
 */
const recommendFiles = (data: InitCommandWithFiles) =>
  pipe(
    data,
    tap(noticeFilesToCreate),
    tap(processAllFiles(displayFile)),
    tap(noticeFilesToInsert),
    set("files", ({ jsons }) => jsons),
    tap(processAllFiles(displayFile)),
  );

/**
 * Actually creates files on the filesystem during normal (non-dry-run) execution.
 * Merges text files and JSON files together and writes them to disk.
 * This performs the actual file system operations to initialize the project.
 *
 * @param data - The initialization command data with files and JSONs prepared
 * @returns The processed data after files have been created
 */
const createFiles = (data: InitCommandWithFiles) =>
  pipe(
    data,
    set("files", ({ jsons, files }) => toMerged(files, jsons)),
    tap(processAllFiles(createFile)),
  );

interface InitCommandWithFiles extends InitCommandData {
  files: Record<string, string>;
  jsons: Record<string, object>;
}

/**
 * Higher-order function that processes all files with a given processing function.
 * Takes a processing function (either display or create) and applies it to all files
 * in the target directory, handling path resolution and content patching.
 *
 * @param process - Function to process each file (either display or create)
 * @returns A function that processes all files in the given directory with the provided processor
 */
const processAllFiles = (
  process: (path: string, content: string) => void | Promise<void>,
) =>
({ dir, files }: InitCommandWithFiles) =>
  pipe(
    files,
    entries,
    forEach(
      pipeLazy(
        joinDir(dir),
        apply(patchContent),
        apply(process),
      ),
    ),
  );

/**
 * Patches file content by either merging JSON objects or appending text content.
 * Handles existing files by reading their current content and intelligently combining
 * it with new content based on the content type (JSON vs text).
 *
 * @param path - The file path to patch
 * @param content - The new content (either string or object)
 * @returns A tuple containing the file path and the final content string
 */
async function patchContent(
  path: string,
  content: string | object,
): Promise<[string, string]> {
  const prev = await readFileIfExists(path);
  const data = typeof content === "object"
    ? mergeJson(prev, content)
    : appendText(prev, content);
  return [path, data];
}

/**
 * Merges new JSON data with existing JSON content and formats the result.
 * Parses existing JSON content (if any) and deep merges it with new data,
 * then formats the result for consistent output.
 * Supports JSONC (JSON with Comments) by removing comments before parsing.
 *
 * @param prev - The previous JSON content as string
 * @param data - The new data object to merge
 * @returns Formatted JSON string with merged content
 */
const mergeJson = (prev: string, data: object): string =>
  pipe(
    prev ? JSON.parse(removeJsonComments(prev)) : {},
    merge(data),
    formatJson,
  );

/**
 * Removes single-line (//) and multi-line (/* *\/) comments from JSON string.
 * This allows parsing JSONC (JSON with Comments) files.
 *
 * @param jsonString - The JSON string potentially containing comments
 * @returns JSON string with comments removed
 */
const removeJsonComments = (jsonString: string): string => {
  // Remove single-line comments
  let result = jsonString.replace(/\/\/.*$/gm, "");
  // Remove multi-line comments
  result = result.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove trailing commas (common in JSONC)
  result = result.replace(/,(\s*[}\]])/g, "$1");
  return result;
};

/**
 * Appends new text content to existing text content line by line.
 * Concatenates new content lines with existing content lines,
 * preserving line structure and formatting.
 *
 * @param prev - The previous text content
 * @param data - The new text content to append
 * @returns Combined text content as a single string
 */
const appendText = (prev: string, data: string) =>
  prev ? `${prev}\n${data}` : data;

/**
 * Safely reads a file if it exists, returns empty string if it doesn't exist.
 * Provides error handling to distinguish between "file not found" and other
 * file system errors, throwing only for unexpected errors.
 *
 * @param path - The file path to read
 * @returns The file content as string, or empty string if file doesn't exist
 * @throws Error if file access fails for reasons other than file not existing
 */
const readFileIfExists = (path: string): Promise<string> =>
  readFile(path, "utf8")
    .catch(pipeLazy(tap(throwUnlessNotExists), always("")));
