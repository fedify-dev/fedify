import { readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Recursively read a directory, yielding the paths of all files.  File paths
 * are relative to the directory, and directories are not yielded.
 * @param dir The directory to read.
 * @returns An async iterable of file paths.
 */
export async function* readDirRecursive(dir: string): AsyncIterable<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const path = join(dir, entry.name);
      for await (const subentry of readDirRecursive(path)) {
        yield join(entry.name, subentry);
      }
    } else {
      yield entry.name;
    }
  }
}
