/**
 * Reading and parsing scenario suite files.
 *
 * Files may be written in YAML or JSON; because YAML is a superset of JSON, a
 * single YAML parser handles both, and YAML anchors/aliases are available for
 * in-document reuse.
 * @since 2.3.0
 * @module
 */

import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";

/**
 * Parses scenario suite text (YAML or JSON) into an untyped value.
 * @param text The file contents.
 * @returns The parsed value, to be validated with `validateSuite()`.
 */
export function parseSuiteText(text: string): unknown {
  return parseYaml(text);
}

/**
 * Reads and parses a scenario suite file.
 * @param path The path to the suite file.
 * @returns The parsed value, to be validated with `validateSuite()`.
 */
export async function loadSuiteFile(path: string): Promise<unknown> {
  return parseSuiteText(await readFile(path, { encoding: "utf-8" }));
}
