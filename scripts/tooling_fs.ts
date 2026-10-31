import fs from "node:fs/promises";

/** Filesystem seam for scanner tests that simulate disappearing entries. */
export const fileSystem = {
  async *readDir(path: string | URL) {
    yield* await fs.readdir(path, { withFileTypes: true });
  },
  readTextFile(path: string | URL): Promise<string> {
    return fs.readFile(path, "utf8");
  },
};

/** Whether an operation failed because its path disappeared. */
export function isNotFound(error: unknown): boolean {
  return error != null && typeof error === "object" && "code" in error &&
    error.code === "ENOENT";
}
