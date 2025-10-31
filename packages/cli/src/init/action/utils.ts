import { join as joinPath } from "node:path";
import type { InitCommandData } from "../types.ts";

export const isDry = ({ dryRun }: InitCommandData) => dryRun;

export const hasCommand = (data: InitCommandData) => !!data.initializer.command;

export const isDeno = (
  { packageManager }: InitCommandData,
) => packageManager === "deno";

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
