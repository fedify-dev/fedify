import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { message } from "@optique/core";
import type { InitCommandData } from "../types.ts";
import {
  assertNoGeneratedFileConflicts,
  GeneratedFileConflictError,
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
