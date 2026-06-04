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
import { defaultHelpers } from "../template/helpers.ts";
import { renderTemplates } from "../template/template.ts";

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

/**
 * Expands `${{ ... }}` templates in a parsed suite.
 *
 * The context exposes `target` (its `host`, `hostname`, `port`, `origin`,
 * `href`, and `protocol`) plus the default helpers.  The target comes from the
 * `--target` override or the suite's own `target`, neither of which is
 * templated.
 * @param raw The parsed suite value.
 * @param targetOverride A target URL from `--target`, if any.
 * @returns The suite with templates expanded.
 */
export function renderSuiteTemplates(
  raw: unknown,
  targetOverride?: string,
): unknown {
  const target = targetOverride ?? suiteTarget(raw);
  const values: Record<string, unknown> = {};
  if (target != null) {
    try {
      const url = new URL(target);
      values.target = {
        host: url.host,
        hostname: url.hostname,
        port: url.port,
        origin: url.origin,
        href: url.href,
        protocol: url.protocol.replace(/:$/, ""),
      };
    } catch {
      // Leave `target` unset; `${{ target.* }}` then fails with a clear error.
    }
  }
  return renderTemplates(raw, { values, helpers: defaultHelpers() });
}

function suiteTarget(raw: unknown): string | undefined {
  if (raw != null && typeof raw === "object" && "target" in raw) {
    const target = (raw as { target?: unknown }).target;
    return typeof target === "string" ? target : undefined;
  }
  return undefined;
}
