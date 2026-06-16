import assert from "node:assert/strict";
import test from "node:test";
import { parseCliProgram, runCli } from "./runner.ts";

test("parseCliProgram keeps the selected static command", async () => {
  const program = await parseCliProgram([
    "tunnel",
    "3000",
    "--ignore-config",
  ]);

  assert.deepStrictEqual(program.command.path, ["tunnel"]);
  assert.strictEqual(program.value.command, "tunnel");
  assert.strictEqual(program.value.port, 3000);
  assert.strictEqual(program.value.ignoreConfig, true);
});

test("runCli does not expose the selected static command marker", async () => {
  const result = await runCli(["tunnel", "3000", "--ignore-config"]);

  assert.strictEqual("__fedifyCliSelectedCommand" in result, false);
  assert.strictEqual(result.command, "tunnel");
});
