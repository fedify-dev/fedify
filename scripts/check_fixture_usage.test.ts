import { deepStrictEqual, rejects } from "node:assert/strict";
import { it, mock } from "node:test";
import { join } from "@std/path";
import { checkFixtureUsage } from "./check_fixture_usage.ts";

async function withProject(run: (root: string, src: string) => Promise<void>) {
  const root = await Deno.makeTempDir();
  const src = join(root, "packages", "vocab", "src");
  await Deno.mkdir(src, { recursive: true });
  await Deno.writeTextFile(
    join(src, "violation.ts"),
    'import "@fedify/fixture";',
  );
  try {
    await run(root, src);
  } finally {
    mock.restoreAll();
    await Deno.remove(root, { recursive: true });
  }
}

it("skips the codegen lock directory", async () => {
  await withProject(async (root) => {
    const lock = join(root, "packages", "vocab", ".vocab-codegen.lock");
    await Deno.mkdir(join(lock, "src"), { recursive: true });
    await Deno.writeTextFile(
      join(lock, "src", "ignored.ts"),
      'import "@fedify/fixture";',
    );
    const readDir = Deno.readDir;
    mock.method(Deno, "readDir", (path: string | URL) => {
      if (path === lock) throw new Error("Lock must not be traversed");
      return readDir(path);
    });
    deepStrictEqual(await checkFixtureUsage(root), [
      join("packages", "vocab", "src", "violation.ts"),
    ]);
  });
});

it("continues after a directory disappears before descent", async () => {
  await withProject(async (root) => {
    const parent = join(root, "packages", "vocab");
    const gone = join(parent, "gone");
    await Deno.mkdir(gone);
    const readDir = Deno.readDir;
    mock.method(Deno, "readDir", async function* (path: string | URL) {
      if (path === parent) {
        const entries = Array.fromAsync(readDir(path));
        for (
          const entry of (await entries).sort((a, b) =>
            Number(b.name === "gone") - Number(a.name === "gone")
          )
        ) {
          if (entry.name === "gone") await Deno.remove(gone);
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
    await Deno.writeTextFile(gone, "");
    const readDir = Deno.readDir;
    mock.method(Deno, "readDir", async function* (path: string | URL) {
      if (path === src) {
        const entries = await Array.fromAsync(readDir(path));
        for (
          const entry of entries.sort((a) =>
            a.name === "vocab-temporary.ts" ? -1 : 1
          )
        ) {
          if (entry.name === "vocab-temporary.ts") await Deno.remove(gone);
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
      const error = new Deno.errors.PermissionDenied("denied");
      mock.method(Deno, operation, () => {
        throw error;
      });
      await rejects(checkFixtureUsage(root), (actual) => actual === error);
    });
  });
}
