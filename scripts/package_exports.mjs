import { ok } from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Nest.js currently declares CommonJS paths that its build does not emit.
// The declaration mismatch is also tracked in check_types.ts. Keep this
// exception limited to those exact targets until that separate fix lands.
const knownMissingBuildTargets = new Map([
  ["@fedify/nestjs", new Set(["dist/index.d.ts", "dist/index.js"])],
]);

function exportTargets(value) {
  if (typeof value === "string")
    return value.startsWith("./") ? [value.slice(2)] : [];
  return value == null ? [] : Object.values(value).flatMap(exportTargets);
}

/** Parse archive entries printed by tar on Unix or Windows. */
export function parseTarFileList(output) {
  return output
    .trim()
    .split(/\r?\n/)
    .filter((file) => !file.endsWith("/"))
    .map((file) => file.replace(/^package\//, ""));
}

/** Check build targets and packed exports, allowing only known build defects. */
export function checkExports(name, files, manifest, builtDirectory) {
  for (const target of new Set(exportTargets(manifest.exports))) {
    if (target.includes("*")) continue;
    if (builtDirectory && !existsSync(join(builtDirectory, target))) {
      ok(
        knownMissingBuildTargets.get(name)?.has(target),
        `${name}: export missing from build: ${target}`,
      );
      console.warn(`${name}: known export missing from build: ${target}`);
      continue;
    }
    ok(files.includes(target), `${name}: missing export ${target}`);
  }
  for (const target of Object.values(
    typeof manifest.bin === "string"
      ? { bin: manifest.bin }
      : (manifest.bin ?? {}),
  )) {
    ok(
      files.includes(target.replace(/^\.\//, "")),
      `${name}: missing binary ${target}`,
    );
  }
}
