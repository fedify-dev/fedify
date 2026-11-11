import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Return deterministic imports for the Workers test bundle. */
export async function discoverTestImports(baseDir: string): Promise<string[]> {
  const paths: string[] = [];

  async function visit(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      // As with the previous glob, an absent output directory has no matches.
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.name.endsWith(".test.js")) {
        // Directory links are not traversed, matching expandGlob's default.
        paths.push(`./${relative(baseDir, path).split(sep).join("/")}`);
      }
    }
  }

  await visit(join(baseDir, "dist"));
  return paths.sort().map((path) => `import ${JSON.stringify(path)};`);
}

if (import.meta.main) {
  const baseDir = fileURLToPath(new URL("../src/cfworkers/", import.meta.url));
  for (const line of await discoverTestImports(baseDir)) console.log(line);
}
