import { readFile, rm, writeFile } from "node:fs/promises";
import {
  isAbsolute,
  join as joinPath,
  relative as relativePath,
  resolve as resolvePath,
} from "node:path";
import { throwUnlessNotExists } from "../lib.ts";
import type { InitCommandData, WebFrameworkInitializer } from "../types.ts";
import { formatJson } from "../utils.ts";

export async function cleanupScaffoldedFiles(
  { dir, initializer }: InitCommandData,
): Promise<void> {
  await Promise.all(
    (initializer.cleanupFiles ?? [])
      .filter((path) => path.trim() !== "")
      .map((path) =>
        rm(resolveCleanupPath(dir, path), { force: true, recursive: true })
      ),
  );
  await cleanupPackageJson(dir, initializer.cleanupPackageJson);
}

function resolveCleanupPath(dir: string, path: string): string {
  const baseDir = resolvePath(dir);
  const targetPath = resolvePath(baseDir, path);
  const relative = relativePath(baseDir, targetPath);
  if (relative === "" || relative.startsWith("..") || isAbsolute(relative)) {
    throw new Error(`Cleanup path escapes project directory: ${path}`);
  }
  return targetPath;
}

async function cleanupPackageJson(
  dir: string,
  cleanup: WebFrameworkInitializer["cleanupPackageJson"],
): Promise<void> {
  if (cleanup == null || isEmptyPackageJsonCleanup(cleanup)) return;
  const path = joinPath(dir, "package.json");
  const packageJson = await readPackageJson(path);
  if (packageJson == null) return;

  deleteKeys(packageJson.scripts, cleanup.scripts);
  deleteKeys(packageJson.dependencies, cleanup.dependencies);
  deleteKeys(packageJson.devDependencies, cleanup.devDependencies);

  await writeFile(path, formatJson(packageJson));
}

function isEmptyPackageJsonCleanup(
  cleanup: NonNullable<WebFrameworkInitializer["cleanupPackageJson"]>,
): boolean {
  return (
    (cleanup.scripts?.length ?? 0) === 0 &&
    (cleanup.dependencies?.length ?? 0) === 0 &&
    (cleanup.devDependencies?.length ?? 0) === 0
  );
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
