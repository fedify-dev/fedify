import { readFile, rm, writeFile } from "node:fs/promises";
import { join as joinPath } from "node:path";
import { throwUnlessNotExists } from "../lib.ts";
import type { InitCommandData, WebFrameworkInitializer } from "../types.ts";
import { formatJson } from "../utils.ts";

export async function cleanupScaffoldedFiles(
  { dir, initializer }: InitCommandData,
): Promise<void> {
  await Promise.all(
    (initializer.cleanupFiles ?? []).map((path) =>
      rm(joinPath(dir, path), { force: true, recursive: true })
    ),
  );
  await cleanupPackageJson(dir, initializer.cleanupPackageJson);
}

async function cleanupPackageJson(
  dir: string,
  cleanup: WebFrameworkInitializer["cleanupPackageJson"],
): Promise<void> {
  if (cleanup == null) return;
  const path = joinPath(dir, "package.json");
  const packageJson = await readPackageJson(path);
  if (packageJson == null) return;

  deleteKeys(packageJson.scripts, cleanup.scripts);
  deleteKeys(packageJson.dependencies, cleanup.dependencies);
  deleteKeys(packageJson.devDependencies, cleanup.devDependencies);

  await writeFile(path, formatJson(packageJson));
}

async function readPackageJson(
  path: string,
): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throwUnlessNotExists(error);
    return null;
  }
}

function deleteKeys(
  target: unknown,
  keys: readonly string[] | undefined,
): void {
  if (target == null || typeof target !== "object" || keys == null) return;
  for (const key of keys) {
    Reflect.deleteProperty(target, key);
  }
}
