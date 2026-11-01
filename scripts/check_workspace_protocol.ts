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
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { fileSystem, isNotFound } from "./tooling_fs.ts";
import { isMain } from "./tooling_main.ts";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/** Walk package manifests without entering temporary codegen locks. */
export async function* walkPackageManifests(
  projectRoot: string,
): AsyncGenerator<{ path: string }> {
  try {
    for await (const entry of fileSystem.readDir(projectRoot)) {
      if (
        ["node_modules", ".git", ".vocab-codegen.lock"].includes(entry.name)
      ) {
        continue;
      }
      const path = join(projectRoot, entry.name);
      if (entry.isDirectory()) yield* walkPackageManifests(path);
      else if (entry.name === "package.json") yield { path };
    }
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

if (isMain(import.meta.url)) {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

  let found = false;
  for await (const entry of walkPackageManifests(projectRoot)) {
    let manifest: Record<string, unknown>;
    try {
      const parsed = JSON.parse(await fileSystem.readTextFile(entry.path));
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
      // typeof [] is "object", so exclude arrays explicitly before iterating.
      if (deps == null || typeof deps !== "object" || Array.isArray(deps)) {
        continue;
      }
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
    process.exitCode = 1;
  }

  if (!found) console.log("All workspace: specifiers are valid");
}
