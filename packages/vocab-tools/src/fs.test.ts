import { deepStrictEqual } from "node:assert";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readDirRecursive } from "./fs.ts";

test("readDirRecursive()", async () => {
  // Create a temporary directory that has fixtures in it:
  const dir = await mkdtemp(join(tmpdir(), "fedify-test-"));
  await mkdir(join(dir, "a"));
  await writeFile(join(dir, "a", "aa.txt"), "aa");
  await writeFile(join(dir, "a", "ab.txt"), "aa");
  await mkdir(join(dir, "a", "aa"));
  await writeFile(join(dir, "a", "aa", "aaa.txt"), "aaa");
  await mkdir(join(dir, "b"));
  await writeFile(join(dir, "b", "ba.txt"), "ba");
  await writeFile(join(dir, "b", "bb.txt"), "bb");

  // Read the directory recursively:
  deepStrictEqual(
    new Set(await Array.fromAsync(readDirRecursive(dir))),
    new Set([
      join("a", "aa", "aaa.txt"),
      join("a", "aa.txt"),
      join("a", "ab.txt"),
      join("b", "ba.txt"),
      join("b", "bb.txt"),
    ]),
  );
});
