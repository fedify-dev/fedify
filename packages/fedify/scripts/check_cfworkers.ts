import { test } from "@fedify/fixture";
import { match, strictEqual } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

// Run after bundling server.ts. Probe the real client in separate processes so
// a missing process.exitCode cannot be hidden by the parent test runner.
test("Workers client exit status", async (t) => {
  const client = fileURLToPath(
    new URL("../src/cfworkers/client.ts", import.meta.url),
  );
  const cases: [string[], number, string][] = [
    [["pass"], 0, "1 passed, 0 failed, 0 skipped"],
    [["ignored test"], 0, "0 passed, 0 failed, 1 skipped"],
    [["ignored step"], 0, "1 passed, 0 failed, 0 skipped"],
    [[], 1, "2 passed, 9 failed, 1 skipped"],
    ...["throw", "step", "nested"].flatMap((kind) =>
      [0, 1, 2].map((
        i,
      ): [string[], number, string] => [
        [`${kind} ${i}`],
        1,
        "0 passed, 1 failed, 0 skipped",
      ])
    ),
  ];
  for (const [filters, status, summary] of cases) {
    await t.step(filters.join(", ") || "mixed results", () => {
      const env: Record<string, string | undefined> = {
        ...process.env,
        NO_COLOR: "1",
      };
      delete env.NODE_TEST_CONTEXT;
      delete env.NODE_OPTIONS;
      const result = spawnSync(process.execPath, [
        "--import=tsx",
        client,
        "--selftest",
        ...filters,
      ], {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env,
        encoding: "utf8",
        timeout: 30_000,
      });
      if (result.error) throw result.error;
      const output = result.stdout + result.stderr;
      strictEqual(result.signal, null, output);
      strictEqual(result.status, status, output);
      match(output, new RegExp(`Tests completed: ${summary}\\.`));
    });
  }
});

// cSpell: ignore SELFTEST
