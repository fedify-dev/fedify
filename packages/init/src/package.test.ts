import { strictEqual } from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function assertTargetExists(path: string): Promise<void> {
  await access(resolve(packageDir, path));
}

test(
  "package.json entrypoints match built init files",
  async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(packageDir, "package.json"), "utf8"),
    );
    const exportMap = packageJson.exports["."];
    const targets = [
      packageJson.main,
      packageJson.types,
      exportMap.import,
      exportMap.types,
    ] as string[];
    strictEqual(packageJson.main, "./dist/mod.js");
    strictEqual(packageJson.types, "./dist/mod.d.ts");
    strictEqual(exportMap.import, "./dist/mod.js");
    strictEqual(exportMap.types, "./dist/mod.d.ts");

    for (const target of new Set(targets)) {
      await assertTargetExists(target);
    }
  },
);
