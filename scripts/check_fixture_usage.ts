/**
 * This script flags `import`/`export ... from "@fedify/fixture"` statements
 * in non-`*.test.ts` files under `packages/<pkg>/src/`.  It exists to catch
 * accidental leaks of the private `@fedify/fixture` package into shipped
 * code.
 *
 * It can be intentionally bypassed in many ways that this scan does not
 * cover.  As a simple example, this script doesn't even catch cases where a
 * `*.test.ts` file that imports `@fedify/fixture` is being exported.
 * Reviewers must NOT treat a passing run as proof of safety; code
 * review and the published package contents remain the source of truth.
 */
import { walk } from "@std/fs/walk";
import {
  dirname,
  fromFileUrl,
  join,
  relative,
  resolve,
  SEPARATOR,
} from "@std/path";

/**
 * Files exempt from the "@fedify/fixture imports must live in *.test.ts"
 * rule.  Every entry MUST be accompanied by an inline comment explaining
 * why the exception is justified, so other contributors can decide whether
 * necessary or not.
 */
const ALLOWLIST: readonly string[] = [
  // cfworkers test harness re-exports `mockDocumentLoader`; bundled in via
  // tsdown `noExternal` so consumers never resolve `@fedify/fixture` at
  // runtime.
  "packages/fedify/src/testing/context.ts",
  // cfworkers test harness re-exports `testDefinitions`; bundled in via
  // tsdown `noExternal` so consumers never resolve `@fedify/fixture` at
  // runtime.
  "packages/fedify/src/testing/mod.ts",
  // JSDoc `@example` block mentions `import { test } from "@fedify/fixture"`
  // as documentation; not a real runtime import.
  "packages/testing/src/mq-tester.ts",
].map((path) => join(...path.split("/") as [string, ...string[]]));

const projectRoot = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const packagesDir = resolve(projectRoot, "packages");

/**
 * Statement-level pattern for any `import` or `export ... from`
 * referring to `@fedify/fixture` (or one of its subpath exports such as
 * `@fedify/fixture/fixtures/foo.json`).
 *
 * Forms reliably matched:
 *
 *  -  Default import: `import x from "@fedify/fixture"`
 *  -  Namespace import: `import * as x from "@fedify/fixture"`
 *  -  Named import: `import { a, b } from "@fedify/fixture"`
 *  -  Mixed import: `import x, { a } from "@fedify/fixture"`
 *  -  Type-only default: `import type Y from "@fedify/fixture"`
 *  -  Type-only named: `import type { Y } from "@fedify/fixture"`
 *  -  Multi-line named imports (line breaks inside the brace list)
 *  -  Subpath specifiers: `"@fedify/fixture/<path>"`
 *  -  Side-effect import: `import "@fedify/fixture"`
 *  -  Re-exports: `export { a } from "@fedify/fixture"`,
 *     `export * from "@fedify/fixture"`,
 *     `export type { Y } from "@fedify/fixture"`
 *
 * Not detected (intentional limits of a textual scan):
 *
 *  -  Dynamic `import("@fedify/fixture")` and CJS `require()`
 *  -  Indirect re-exports laundered through another module
 *  -  Mentions inside line/block comments (the regex still matches
 *     them, but such cases should be handled via {@link ALLOWLIST})
 */
const IMPORT_PATTERN =
  /(?:import|export)\b[^;]*?["']@fedify\/fixture(?:\/[^"']*)?["']/;

const allowed = new Set(ALLOWLIST);
let hasViolation = false;

for await (
  const entry of walk(packagesDir, {
    includeDirs: false,
    exts: [".ts"],
    match: [new RegExp(`${SEPARATOR}src${SEPARATOR}`)],
    skip: [new RegExp(`^packages${SEPARATOR}fixture`)],
  })
) {
  const rel = relative(projectRoot, entry.path);
  if (rel.endsWith(".test.ts") || rel.endsWith(".bench.ts")) continue;
  if (allowed.has(rel)) continue;

  const content = await Deno.readTextFile(entry.path);
  if (IMPORT_PATTERN.test(content)) {
    console.error(rel);
    hasViolation = true;
  }
}

if (hasViolation) Deno.exit(1);
