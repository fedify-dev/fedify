import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/** Whether Node.js launched this module as its entry point. */
export function isMain(url: string): boolean {
  return process.argv[1] != null &&
    pathToFileURL(resolve(process.argv[1])).href === url;
}
