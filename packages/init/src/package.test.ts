import { match, ok, strictEqual } from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import astroDescription from "./webframeworks/astro.ts";

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

test(
  "Astro init uses the Bun adapter for Bun projects",
  async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(packageDir, "package.json"), "utf8"),
    );
    const result = await astroDescription.init({
      command: "init",
      dir: packageDir,
      dryRun: true,
      kvStore: "in-memory",
      messageQueue: "in-process",
      packageManager: "bun",
      projectName: "fedify-test",
      testMode: true,
      webFramework: "astro",
    });

    ok(result.dependencies != null);
    ok(result.tasks != null);
    ok(result.files != null);
    const dependencies = result.dependencies as Record<string, string>;
    const tasks = result.tasks as Record<string, string>;
    const files = result.files as Record<string, string>;

    strictEqual(dependencies["@nurodev/astro-bun"], "^2.1.2");
    strictEqual(dependencies["@fedify/astro"], packageJson.version);
    strictEqual(tasks.dev, "bunx --bun astro dev");
    strictEqual(tasks.build, "bunx --bun astro build");
    strictEqual(tasks.preview, "bun ./dist/server/entry.mjs");
    match(
      files["astro.config.ts"],
      /import bun from "@nurodev\/astro-bun";/,
    );
    match(files["astro.config.ts"], /adapter: bun\(\),/);
  },
);
