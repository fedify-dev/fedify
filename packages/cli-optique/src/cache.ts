import { dir } from "@cross/dir";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

export const DEFAULT_CACHE_DIR = join(await dir("cache", true), "fedify");

let currentCacheDir: string = DEFAULT_CACHE_DIR;

export async function getCacheDir(): Promise<string> {
  await ensureDir(currentCacheDir);
  return currentCacheDir;
}

export function setCacheDir(dir: string): Promise<void> {
  currentCacheDir = dir;
  return Promise.resolve();
}
