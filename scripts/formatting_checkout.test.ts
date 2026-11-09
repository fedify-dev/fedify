import { deepStrictEqual, equal } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { it } from "node:test";

it("keeps text checkouts in LF with autocrlf enabled without changing binaries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify-format-checkout-"));
  const env = { ...process.env };
  // Hooks may export repository-local paths; keep this fixture independent.
  for (const key of [
    "GIT_DIR",
    "GIT_COMMON_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_PREFIX",
    "GIT_SHALLOW_FILE",
  ])
    delete env[key];
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-c",
        "core.autocrlf=true",
        "-c",
        "core.eol=crlf",
        "-c",
        "core.safecrlf=false",
        "-c",
        `core.hooksPath=${join(dir, "no-hooks")}`,
        ...args,
      ],
      { cwd: dir, env, encoding: "utf8", timeout: 10_000 },
    );
  const source = "export const value = 42;\n";
  const binary = new Uint8Array([0, 13, 10, 10, 255]);
  try {
    await writeFile(
      join(dir, ".gitattributes"),
      await readFile(new URL("../.gitattributes", import.meta.url)),
    );
    await writeFile(join(dir, "source.ts"), source);
    await writeFile(join(dir, "sample.bin"), binary);
    git("init", "--quiet");
    git("add", "--", ".gitattributes", "source.ts", "sample.bin");
    await rm(join(dir, "source.ts"));
    await rm(join(dir, "sample.bin"));
    git("checkout-index", "--force", "--all");
    equal(await readFile(join(dir, "source.ts"), "utf8"), source);
    deepStrictEqual(
      new Uint8Array(await readFile(join(dir, "sample.bin"))),
      binary,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
