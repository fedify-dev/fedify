/**
 * This script flags `workspace:` dependency specifiers that omit a version
 * range marker (`*`, `^`, or `~`).  A bare `workspace:` is invalid for
 * publishing because pnpm cannot rewrite it to a concrete version on `pnpm
 * pack`/`publish`, so every workspace dependency must use `workspace:*`,
 * `workspace:^`, or `workspace:~`.
 *
 * It replaces the previous Bash + `find` + `jq` implementation so the check
 * runs identically on Windows, macOS, and Linux without external tools.
 */
import { walk } from "@std/fs/walk";
import { dirname, fromFileUrl, relative, resolve } from "@std/path";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

const projectRoot = resolve(dirname(fromFileUrl(import.meta.url)), "..");

let found = false;
for await (
  const entry of walk(projectRoot, {
    includeDirs: false,
    // Match the path separator with a character class so these patterns stay
    // valid on Windows too, where @std/path's SEPARATOR is a backslash and
    // would corrupt a dynamically built RegExp (e.g. `(?:^|\)package\.json$`).
    match: [/(?:^|[/\\])package\.json$/],
    skip: [/(?:^|[/\\])node_modules(?:[/\\]|$)/],
  })
) {
  let manifest: Record<string, unknown>;
  try {
    const parsed = JSON.parse(await Deno.readTextFile(entry.path));
    // A package.json could be `null`, a string, a number, or an array; skip
    // anything that is not a plain object so the field lookups below are safe.
    if (
      parsed === null || typeof parsed !== "object" || Array.isArray(parsed)
    ) {
      continue;
    }
    manifest = parsed as Record<string, unknown>;
  } catch {
    continue;
  }

  const invalid: string[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const deps = manifest[field];
    if (deps == null || typeof deps !== "object") continue;
    for (
      const [name, spec] of Object.entries(deps as Record<string, unknown>)
    ) {
      if (spec === "workspace:") invalid.push(name);
    }
  }

  if (invalid.length > 0) {
    if (!found) {
      console.error(
        "Error: Found invalid workspace: specifiers (missing *, ^, or ~):",
      );
      console.error("");
      found = true;
    }
    console.error(`${relative(projectRoot, entry.path)}:`);
    for (const name of invalid) console.error(`  ${name}`);
  }
}

if (found) {
  console.error("");
  console.error("Valid formats: workspace:*, workspace:^, workspace:~");
  Deno.exit(1);
}

console.log("All workspace: specifiers are valid");
