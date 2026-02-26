import { join as joinPath } from "node:path";
import type { InitCommandData } from "../types.ts";

/** Returns `true` if the current run is in dry-run mode. */
export const isDry = ({ dryRun }: InitCommandData) => dryRun;

/** Returns `true` if the framework initializer has a precommand to execute. */
export const hasCommand = (data: InitCommandData) => !!data.initializer.command;

/** Returns `true` if the selected package manager is Deno. */
export const isDeno = (
  { packageManager }: Pick<InitCommandData, "packageManager">,
) => packageManager === "deno";

/**
 * Returns a function that prepends the project directory to a
 * `[filename, content]` tuple, resolving the filename into an absolute path.
 */
export const joinDir =
  (dir: string) => ([filename, content]: readonly [string, string | object]) =>
    [joinPath(dir, ...filename.split("/")), content] as [
      string,
      string | object,
    ];

/**
 * Stringify an object into a valid `.env` file format.
 * From `@std/dotenv/stringify`.
 *
 * @example Usage
 * ```ts
 * import { stringifyEnvs } from "./utils.ts";
 * import { assertEquals } from "@std/assert";
 *
 * const object = { GREETING: "hello world" };
 * assertEquals(stringifyEnvs(object), "GREETING='hello world'");
 * ```
 *
 * @param object object to be stringified
 * @returns string of object
 */
export function stringifyEnvs(object: Record<string, string>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(object)) {
    let quote;

    let escapedValue = value ?? "";
    if (key.startsWith("#")) {
      // deno-lint-ignore no-console
      console.warn(
        `key starts with a '#' indicates a comment and is ignored: '${key}'`,
      );
      continue;
    } else if (escapedValue.includes("\n") || escapedValue.includes("'")) {
      // escape inner new lines
      escapedValue = escapedValue.replaceAll("\n", "\\n");
      quote = `"`;
    } else if (escapedValue.match(/\W/)) {
      quote = "'";
    }

    if (quote) {
      // escape inner quotes
      escapedValue = escapedValue.replaceAll(quote, `\\${quote}`);
      escapedValue = `${quote}${escapedValue}${quote}`;
    }
    const line = `${key}=${escapedValue}`;
    lines.push(line);
  }
  return lines.join("\n");
}
