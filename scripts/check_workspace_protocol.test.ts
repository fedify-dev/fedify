import { deepStrictEqual } from "node:assert/strict";
import { it, mock } from "node:test";
import { join } from "@std/path";
import { walkPackageManifests } from "./check_workspace_protocol.ts";

async function withProject(
  run: (root: string, parent: string, lock: string) => Promise<void>,
) {
  const root = await Deno.makeTempDir();
  const parent = join(root, "packages", "vocab");
  const lock = join(parent, ".vocab-codegen.lock");
  try {
    await Deno.mkdir(lock, { recursive: true });
    await Deno.writeTextFile(
      join(parent, "package.json"),
      JSON.stringify({ dependencies: { "@fedify/fedify": "workspace:" } }),
    );
    await run(root, parent, lock);
  } finally {
    mock.restoreAll();
    await Deno.remove(root, { recursive: true });
  }
}

it("skips codegen locks while still yielding real package manifests", async () => {
  await withProject(async (root, parent, lock) => {
    await Deno.writeTextFile(join(lock, "package.json"), "{}");
    const readDir = Deno.readDir;
    mock.method(Deno, "readDir", (path: string | URL) => {
      if (path === lock) throw new Error("Lock must not be traversed");
      return readDir(path);
    });
    const entries = await Array.fromAsync(walkPackageManifests(root));
    deepStrictEqual(entries.map((entry) => entry.path), [
      join(parent, "package.json"),
    ]);
  });
});

it("continues checking manifests after codegen releases its lock", async () => {
  await withProject(async (root, parent, lock) => {
    const readDir = Deno.readDir;
    let released = false;
    mock.method(Deno, "readDir", async function* (path: string | URL) {
      if (path !== parent) {
        yield* readDir(path);
        return;
      }
      const entries = await Array.fromAsync(readDir(path));
      // Visit the disappearing lock before the real manifest deterministically.
      entries.sort((a, b) =>
        Number(b.name === ".vocab-codegen.lock") -
        Number(a.name === ".vocab-codegen.lock")
      );
      for (const entry of entries) {
        if (entry.name === ".vocab-codegen.lock") {
          await Deno.remove(lock, { recursive: true });
          released = true;
        }
        yield entry;
      }
    });
    const entries = await Array.fromAsync(walkPackageManifests(root));
    deepStrictEqual(released, true);
    deepStrictEqual(entries.map((entry) => entry.path), [
      join(parent, "package.json"),
    ]);
  });
});
