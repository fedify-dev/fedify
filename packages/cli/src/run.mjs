#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isFile, main as install } from "./install.mjs";

async function main() {
  const filename = fileURLToPath(import.meta.url);
  const dirName = dirname(filename);
  const binPath = join(
    dirName,
    "bin",
    process.platform === "win32" ? "fedify.exe" : "fedify",
  );
  if (!await isFile(binPath)) await install();
  const result = spawnSync(binPath, process.argv.slice(2), {
    stdio: "inherit",
  });
  process.exit(result.status);
}

await main();
