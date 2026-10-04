import { access, glob } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import process from "node:process";

const sources = await Array.fromAsync(glob("src/**/*.test.ts"));
if (sources.length === 0) throw new Error("No vocab-runtime tests found.");

const tests = sources.map((source) =>
  source.replaceAll("\\", "/").replace(/^src\//, "dist/tests/")
    .replace(/\.ts$/, ".mjs")
).sort();
for (const test of tests) await access(test);

const result = spawnSync("bun", ["test", "--timeout", "60000", ...tests], {
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
