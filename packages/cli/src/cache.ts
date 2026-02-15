import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";

/**
 * Returns the default cache directory path.
 * - Linux/macOS: `$XDG_CACHE_HOME/fedify` (default: ~/.cache/fedify)
 * - Windows: `%LOCALAPPDATA%\fedify`
 */
function getDefaultCacheDir(): string {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ||
      join(homedir(), "AppData", "Local");
    return join(localAppData, "fedify");
  }
  const xdgCacheHome = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(xdgCacheHome, "fedify");
}

export const DEFAULT_CACHE_DIR = getDefaultCacheDir();

let currentCacheDir: string = DEFAULT_CACHE_DIR;

export async function getCacheDir(): Promise<string> {
  await mkdir(currentCacheDir, { recursive: true });
  return currentCacheDir;
}

export function setCacheDir(dir: string): Promise<void> {
  currentCacheDir = dir;
  return Promise.resolve();
}
