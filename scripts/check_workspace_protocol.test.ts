import { deepStrictEqual } from "node:assert/strict";
import { it, mock } from "node:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileSystem } from "./tooling_fs.ts";
import { walkPackageManifests } from "./check_workspace_protocol.ts";

async function withProject(
  run: (root: string, parent: string, lock: string) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "fedify-scanner-"));
  const parent = join(root, "packages", "vocab");
  const lock = join(parent, ".vocab-codegen.lock");
  try {
    await mkdir(lock, { recursive: true });
    await writeFile(
      join(parent, "package.json"),
      JSON.stringify({ dependencies: { "@fedify/fedify": "workspace:" } }),
    );
    await run(root, parent, lock);
  } finally {
    mock.restoreAll();
    await rm(root, { recursive: true });
  }
}

it("skips codegen locks while still yielding real package manifests", async () => {
  await withProject(async (root, parent, lock) => {
    await writeFile(join(lock, "package.json"), "{}");
    const readDir = fileSystem.readDir;
    mock.method(fileSystem, "readDir", (path: string | URL) => {
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
    const readDir = fileSystem.readDir;
    let released = false;
    mock.method(fileSystem, "readDir", async function* (path: string | URL) {
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
          await rm(lock, { recursive: true });
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

it("excludes dependency and Git directories without following directory links", async () => {
  await withProject(async (root, parent) => {
    for (const name of ["node_modules", ".git"]) {
      const dir = join(root, name);
      await mkdir(dir);
      await writeFile(join(dir, "package.json"), "{}");
    }
    await symlink(root, join(parent, "loop"), "junction");
    const entries = await Array.fromAsync(walkPackageManifests(root));
    deepStrictEqual(entries.map((entry) => entry.path), [
      join(parent, "package.json"),
    ]);
  });
});
