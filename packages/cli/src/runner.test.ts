import assert from "node:assert/strict";
import test from "node:test";
import { parseCliProgram, runCli, toCliProgram } from "./runner.ts";

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

test("toCliProgram runs commands with stripped values", async () => {
  let receivedValue: Record<string, unknown> | undefined;
  const program = toCliProgram(
    {
      command: "fake",
      port: 3000,
      ignoreConfig: true,
      debug: false,
      __fedifyCliSelectedCommand: { path: ["fake"] },
      __fedifyCliRunCommand: (value: Record<string, unknown>) => {
        receivedValue = value;
      },
    } as unknown as Parameters<typeof toCliProgram>[0],
  );
  await program.run();

  assert.ok(receivedValue != null);
  assert.strictEqual("__fedifyCliSelectedCommand" in receivedValue, false);
  assert.strictEqual("__fedifyCliRunCommand" in receivedValue, false);
  assert.strictEqual(receivedValue.command, "fake");
  assert.strictEqual(receivedValue.port, 3000);
  assert.strictEqual(receivedValue.ignoreConfig, true);
});
