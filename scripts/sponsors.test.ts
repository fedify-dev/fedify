import { deepStrictEqual, rejects } from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { overwriteExistingFile } from "./sponsors.ts";

test("sponsor overwrite truncates existing content and preserves Unicode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fedify-sponsors-"));
  const path = join(directory, "sponsor file.md");
  try {
    await writeFile(path, "old content that must be completely replaced");
    await overwriteExistingFile(path, "새 후원자\n");
    deepStrictEqual(await readFile(path, "utf8"), "새 후원자\n");
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("sponsor overwrite rejects a missing destination without creating it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fedify-sponsors-"));
  const path = join(directory, "missing.md");
  try {
    await rejects(overwriteExistingFile(path, "new content"), {
      code: "ENOENT",
    });
    await rejects(access(path), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true });
  }
});
