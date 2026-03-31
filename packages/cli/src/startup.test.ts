import { match } from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
test("CLI build keeps the init bridge entrypoint", async () => {
  const entrypoint = resolve(packageDir, "dist/mod.js");
  const initBridge = resolve(packageDir, "dist/init/mod.js");
  await access(entrypoint);
  await access(initBridge);

  const bridgeSource = await readFile(initBridge, "utf8");
  match(bridgeSource, /@fedify\/init/);
});
