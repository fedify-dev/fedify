import { test } from "@fedify/fixture";
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import manifest from "../package.json" with { type: "json" };

const manifestUrl = new URL("../package.json", import.meta.url);

function collectTargets(
  value: unknown,
  path: string,
  targets: Map<string, string>,
): void {
  if (typeof value === "string") {
    targets.set(path, value);
  } else if (value != null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      collectTargets(child, `${path}.${key}`, targets);
    }
  }
}

test("package.json points to files that exist in the build", () => {
  const targets = new Map<string, string>();
  for (const field of ["main", "module", "types"] as const) {
    collectTargets(manifest[field], field, targets);
  }
  collectTargets(manifest.exports, "exports", targets);
  // Guard against the check passing vacuously after a manifest refactor.
  for (
    const key of [
      "main",
      "types",
      "exports...require.types",
      "exports...require.default",
    ]
  ) {
    ok(targets.has(key), `${key} is not declared in package.json`);
  }
  const missing = [...targets]
    .filter(([, target]) => !existsSync(new URL(target, manifestUrl)))
    .map(([key, target]) => `${key}: ${target}`);
  deepStrictEqual(missing, []);
});

test("require() loads the CommonJS entry point", () => {
  const require = createRequire(import.meta.url);
  // Node.js and Bun can also require() ESM, so check that the "require"
  // condition was the one that got selected.
  strictEqual(
    require.resolve("@fedify/nestjs"),
    fileURLToPath(new URL(manifest.exports["."].require.default, manifestUrl)),
  );
  const nestjs = require("@fedify/nestjs");
  strictEqual(typeof nestjs.integrateFederation, "function");
  strictEqual(typeof nestjs.FedifyModule, "function");
});
