import { strictEqual } from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test(
  "package.json entrypoints match built create CLI",
  async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(packageDir, "package.json"), "utf8"),
    );
    const binTarget = packageJson.bin["@fedify/create"] as string;
    const exportTarget = packageJson.exports as string;
    strictEqual(binTarget, "./dist/mod.js");
    strictEqual(exportTarget, "./dist/mod.js");
    await access(resolve(packageDir, binTarget));
    await access(resolve(packageDir, exportTarget));
  },
);
