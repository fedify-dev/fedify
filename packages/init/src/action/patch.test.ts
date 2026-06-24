import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { message } from "@optique/core";
import type { InitCommandData } from "../types.ts";
import {
  assertNoGeneratedFileConflicts,
  GeneratedFileConflictError,
  getJsonsCacheKey,
  patchFiles,
} from "./patch.ts";

test("assertNoGeneratedFileConflicts allows unrelated files", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, "README.md"), "# Example\n");

    await assert.doesNotReject(() =>
      assertNoGeneratedFileConflicts(createInitData(dir, true))
    );
  });
});

test("assertNoGeneratedFileConflicts rejects existing generated files", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "package.json"), "{}\n");
    await writeFile(join(dir, "src", "main.ts"), "");

    await assert.rejects(
      () => assertNoGeneratedFileConflicts(createInitData(dir, true)),
      (error) => {
        assert.ok(error instanceof GeneratedFileConflictError);
        assert.deepEqual(error.conflicts, ["src/main.ts", "package.json"]);
        assert.match(error.message, /src\/main\.ts/);
        assert.match(error.message, /package\.json/);
        return true;
      },
    );
  });
});

test("assertNoGeneratedFileConflicts skips checks without allowNonEmpty", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, "package.json"), "{}\n");

    await assert.doesNotReject(() =>
      assertNoGeneratedFileConflicts(createInitData(dir, false))
    );
  });
});

test("getJsonsCacheKey stays stable across pipeline clones", () => {
  const data = createInitData("/tmp/example", true);
  const cloned = {
    ...data,
    files: { "src/main.ts": "" },
    jsons: { "package.json": {} },
  };

  assert.equal(getJsonsCacheKey(cloned), getJsonsCacheKey(data));
});

test("patchFiles merges JSONC files containing only comments", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, "package.json"), "// generated scaffold\n");

    await patchFiles(createInitData(dir, false));

    const packageJson = JSON.parse(
      await readFile(join(dir, "package.json"), "utf8"),
    ) as { type?: string };
    assert.equal(packageJson.type, "module");
  });
});

function createInitData(
  dir: string,
  allowNonEmpty: boolean,
): InitCommandData {
  const data = {
    command: "init",
    projectName: "example",
    packageManager: "npm",
    webFramework: "bare-bones",
    kvStore: "in-memory",
    messageQueue: "in-process",
    dryRun: false,
    allowNonEmpty,
    skipInstall: false,
    testMode: false,
    dir,
    initializer: {
      federationFile: "src/federation.ts",
      loggingFile: "src/logging.ts",
      instruction: message`done`,
      tasks: {},
      compilerOptions: {},
      files: {
        "src/main.ts": "",
      },
    },
    kv: {
      label: "In-Memory",
      packageManagers: ["npm"],
      imports: {},
      object: "new MemoryKvStore()",
    },
    mq: {
      label: "In-Process",
      packageManagers: ["npm"],
      imports: {},
      object: "new InProcessMessageQueue()",
    },
    env: {},
  } satisfies InitCommandData;
  return data;
}

async function withTempDir(
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "fedify-init-patch-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
