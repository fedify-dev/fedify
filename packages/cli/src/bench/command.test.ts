import { parse } from "@optique/core/parser";
import assert from "node:assert/strict";
import test from "node:test";
import { benchCommand } from "./command.ts";

const COMMAND = "bench";
const FILE = "suite.yaml";

test("benchCommand - scenario file only", () => {
  const result = parse(benchCommand, [COMMAND, FILE]);
  assert.ok(result.success);
  if (result.success) {
    assert.strictEqual(result.value.command, COMMAND);
    if (result.value.mode !== "run") assert.fail("Expected run mode.");
    assert.strictEqual(result.value.scenario, FILE);
    assert.strictEqual(result.value.target, undefined);
    assert.strictEqual(result.value.format, "text");
    assert.strictEqual(result.value.output, undefined);
    assert.strictEqual(result.value.dryRun, false);
    assert.strictEqual(result.value.allowUnsafeTarget, false);
    // userAgent has a dynamic default value from getUserAgent().
    assert.ok(result.value.userAgent?.startsWith("Fedify/"));
  }
});

test("benchCommand - with all options", () => {
  const result = parse(benchCommand, [
    COMMAND,
    FILE,
    "--target",
    "http://localhost:3000",
    "--format",
    "json",
    "--output",
    "report.json",
    "--dry-run",
    "--allow-unsafe-target",
    "-u",
    "MyAgent/1.0",
  ]);
  assert.ok(result.success);
  if (result.success) {
    if (result.value.mode !== "run") assert.fail("Expected run mode.");
    assert.strictEqual(result.value.scenario, FILE);
    assert.strictEqual(result.value.target, "http://localhost:3000");
    assert.strictEqual(result.value.format, "json");
    assert.strictEqual(result.value.output, "report.json");
    assert.strictEqual(result.value.dryRun, true);
    assert.strictEqual(result.value.allowUnsafeTarget, true);
    assert.strictEqual(result.value.userAgent, "MyAgent/1.0");
  }
});

test("benchCommand - missing scenario file fails", () => {
  const result = parse(benchCommand, [COMMAND]);
  assert.ok(!result.success);
});

test("benchCommand - compare mode", () => {
  const result = parse(benchCommand, [
    COMMAND,
    "compare",
    "--base",
    "origin/main",
    "--head",
    "HEAD",
    "--file",
    FILE,
    "--start-command",
    "pnpm dev",
    "--ready-url",
    "http://127.0.0.1:3000/health",
    "--ready-timeout",
    "45s",
    "--max-regression",
    "15%",
    "--format",
    "markdown",
    "--target",
    "http://127.0.0.1:3000",
    "--allow-unsafe-target",
    "-u",
    "MyAgent/1.0",
  ]);
  assert.ok(result.success);
  if (result.success) {
    assert.strictEqual(result.value.command, COMMAND);
    if (result.value.mode !== "compare") {
      assert.fail("Expected compare mode.");
    }
    assert.strictEqual(result.value.base, "origin/main");
    assert.strictEqual(result.value.head, "HEAD");
    assert.strictEqual(result.value.file, FILE);
    assert.strictEqual(result.value.startCommand, "pnpm dev");
    assert.strictEqual(
      result.value.readyUrl,
      "http://127.0.0.1:3000/health",
    );
    assert.strictEqual(result.value.readyTimeout, "45s");
    assert.strictEqual(result.value.maxRegression, "15%");
    assert.strictEqual(result.value.format, "markdown");
    assert.strictEqual(result.value.target, "http://127.0.0.1:3000");
    assert.strictEqual(result.value.allowUnsafeTarget, true);
    assert.strictEqual(result.value.userAgent, "MyAgent/1.0");
  }
});

test("benchCommand - compare mode requires refs", () => {
  const result = parse(benchCommand, [
    COMMAND,
    "compare",
    "--file",
    FILE,
    "--start-command",
    "pnpm dev",
    "--ready-url",
    "http://127.0.0.1:3000/health",
  ]);
  assert.ok(!result.success);
});

test("benchCommand - bare compare subcommand fails", () => {
  const result = parse(benchCommand, [COMMAND, "compare"]);
  assert.ok(!result.success);
});

test("benchCommand - invalid format value fails", () => {
  const result = parse(benchCommand, [COMMAND, FILE, "--format", "xml"]);
  assert.ok(!result.success);
});

test("benchCommand - unknown option fails", () => {
  const result = parse(benchCommand, [COMMAND, FILE, "-Q"]);
  assert.ok(!result.success);
});
