import { deepStrictEqual, rejects } from "node:assert/strict";
import { it, mock } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileSystem } from "./tooling_fs.ts";
import { checkFixtureUsage } from "./check_fixture_usage.ts";

async function withProject(run: (root: string, src: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "fedify-scanner-"));
  const src = join(root, "packages", "vocab", "src");
  await mkdir(src, { recursive: true });
  await writeFile(
    join(src, "violation.ts"),
    'import "@fedify/fixture";',
  );
  try {
    await run(root, src);
  } finally {
    mock.restoreAll();
    await rm(root, { recursive: true });
  }
}

it("skips the codegen lock directory", async () => {
  await withProject(async (root) => {
    const lock = join(root, "packages", "vocab", ".vocab-codegen.lock");
    await mkdir(join(lock, "src"), { recursive: true });
    await writeFile(
      join(lock, "src", "ignored.ts"),
      'import "@fedify/fixture";',
    );
    const readDir = fileSystem.readDir;
    mock.method(fileSystem, "readDir", (path: string | URL) => {
      if (path === lock) throw new Error("Lock must not be traversed");
      return readDir(path);
    });
    deepStrictEqual(await checkFixtureUsage(root), [
      join("packages", "vocab", "src", "violation.ts"),
    ]);
  });
});

it("exempts tests, benchmarks and the existing fixture allowlist", async () => {
  await withProject(async (root, src) => {
    for (const name of ["allowed.test.ts", "allowed.bench.ts"]) {
      await writeFile(join(src, name), 'import "@fedify/fixture";');
    }
    const testing = join(root, "packages", "fedify", "src", "testing");
    await mkdir(testing, { recursive: true });
    // This filename is already included in the repository's wildcard allowlist.
    await writeFile(join(testing, "context.ts"), 'import "@fedify/fixture";');
    deepStrictEqual(await checkFixtureUsage(root), [
      join("packages", "vocab", "src", "violation.ts"),
    ]);
  });
});

it("continues after a directory disappears before descent", async () => {
  await withProject(async (root) => {
    const parent = join(root, "packages", "vocab");
    const gone = join(parent, "gone");
    await mkdir(gone);
    const readDir = fileSystem.readDir;
    mock.method(fileSystem, "readDir", async function* (path: string | URL) {
      if (path === parent) {
        const entries = Array.fromAsync(readDir(path));
        for (
          const entry of (await entries).sort((a, b) =>
            Number(b.name === "gone") - Number(a.name === "gone")
          )
        ) {
          if (entry.name === "gone") await rm(gone, { recursive: true });
          yield entry;
        }
      } else {
        yield* readDir(path);
      }
    });
    deepStrictEqual(await checkFixtureUsage(root), [
      join("packages", "vocab", "src", "violation.ts"),
    ]);
  });
});

it("continues after a temporary source file disappears before reading", async () => {
  await withProject(async (root, src) => {
    const gone = join(src, "vocab-temporary.ts");
    await writeFile(gone, "");
    const readDir = fileSystem.readDir;
    mock.method(fileSystem, "readDir", async function* (path: string | URL) {
      if (path === src) {
        const entries = await Array.fromAsync(readDir(path));
        for (
          const entry of entries.sort((a) =>
            a.name === "vocab-temporary.ts" ? -1 : 1
          )
        ) {
          if (entry.name === "vocab-temporary.ts") await rm(gone);
          yield entry;
        }
      } else {
        yield* readDir(path);
      }
    });
    deepStrictEqual(await checkFixtureUsage(root), [
      join("packages", "vocab", "src", "violation.ts"),
    ]);
  });
});

for (const operation of ["readDir", "readTextFile"] as const) {
  it(`propagates errors other than NotFound from ${operation}`, async () => {
    await withProject(async (root) => {
      const error = Object.assign(new Error("denied"), { code: "EACCES" });
      mock.method(fileSystem, operation, () => {
        throw error;
      });
      await rejects(checkFixtureUsage(root), (actual) => actual === error);
    });
  });
}
