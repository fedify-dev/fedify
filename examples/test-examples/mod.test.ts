/**
 * Registry-consistency tests for the example test runner.
 *
 * Every example directory under examples/ must be registered in exactly one
 * of the registries in mod.ts (SERVER_EXAMPLES, SCRIPT_EXAMPLES,
 * MULTI_HANDLE_EXAMPLES, or SKIPPED_EXAMPLES).  These tests fail when a new
 * example is added without being registered, so it cannot silently miss
 * automated checks.
 *
 * Usage (from repository root):
 *   mise run test:tooling
 */
import { fileURLToPath } from "node:url";
import { readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import process from "node:process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandOutput } from "../../scripts/tooling_process.ts";

import { getRegisteredExampleNames, scanUnregisteredExamples } from "./mod.ts";

const EXAMPLES_DIR = fileURLToPath(new URL("../", import.meta.url));

test("Every example in the examples/ directory is registered in test-examples", async () => {
  const unregistered = await scanUnregisteredExamples();
  assert.deepEqual(
    unregistered,
    [],
    `Unregistered example directories found: ${unregistered.join(", ")}`,
  );
});

test("Every registered example has a matching examples/ directory", async () => {
  const directories = new Set<string>();
  for (const entry of await readdir(EXAMPLES_DIR, { withFileTypes: true })) {
    if (entry.isDirectory()) directories.add(entry.name);
  }
  const unmatchedExamples = [...getRegisteredExampleNames()]
    .filter((name) => !directories.has(name))
    .sort();

  assert.deepEqual(
    unmatchedExamples,
    [],
    `Registered examples without a matching directory found: ${
      unmatchedExamples.join(", ")
    }`,
  );
});

test("missing server executables fail each selected example and retain the summary", async () => {
  const bin = await mkdtemp(join(tmpdir(), "fedify empty PATH "));
  const node = process.versions.deno != null || process.versions.bun != null
    ? "node"
    : process.execPath;
  // Resolve Node before hiding PATH so the fixture only loses its pnpm command.
  const executable = node === "node"
    ? JSON.parse(new TextDecoder().decode(
      (await commandOutput("node", [
        "-p",
        "JSON.stringify(process.execPath)",
      ])).stdout,
    )) as string
    : node;
  try {
    const result = await commandOutput(executable, [
      "--experimental-strip-types",
      fileURLToPath(new URL("./mod.ts", import.meta.url)),
      "express",
      "koa",
    ], { env: { PATH: bin } });
    const output = new TextDecoder().decode(result.stdout);
    assert.equal(result.code, 1);
    assert.match(output, /\[express\]/);
    assert.match(output, /\[koa\]/);
    assert.match(output, /Summary/);
    assert.match(output, /Failed : 2/);
  } finally {
    await rm(bin, { recursive: true, force: true });
  }
});
