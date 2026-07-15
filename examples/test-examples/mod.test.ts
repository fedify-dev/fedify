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
 *   deno test --allow-all examples/test-examples
 */
import { fromFileUrl } from "@std/path";
import assert from "node:assert/strict";
import test from "node:test";

import { getRegisteredExampleNames, scanUnregisteredExamples } from "./mod.ts";

const EXAMPLES_DIR = fromFileUrl(new URL("../", import.meta.url));

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
  for await (const entry of Deno.readDir(EXAMPLES_DIR)) {
    if (entry.isDirectory) directories.add(entry.name);
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
