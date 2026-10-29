import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Whether Node.js launched this module as its entry point. */
export function isMain(url: string): boolean {
  const entry = process.argv[1];
  if (entry == null) return false;
  try {
    return realpathSync(resolve(entry)) === realpathSync(fileURLToPath(url));
  } catch {
    return pathToFileURL(resolve(entry)).href === url;
  }
}
