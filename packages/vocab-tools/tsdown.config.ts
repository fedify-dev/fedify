import { cp } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig } from "tsdown";

// ESM and CJS hooks run concurrently but share the same output directory.
// Serialize schema copies to avoid Windows EBUSY errors on the destination.
let schemaCopy = Promise.resolve();

export default defineConfig({
  entry: ["src/mod.ts"],
  dts: { compilerOptions: { isolatedDeclarations: true, declaration: true } },
  format: ["esm", "cjs"],
  platform: "neutral",
  deps: { neverBundle: [/^node:/] },
  hooks: {
    "build:done": async (ctx) => {
      // Each hook reports its own failure; a later watch rebuild can retry.
      schemaCopy = schemaCopy.catch(() => {}).then(() =>
        cp(
          join("src", "schema.yaml"),
          join(ctx.options.outDir, "schema.yaml"),
          { force: false, errorOnExist: false },
        )
      );
      await schemaCopy;
    },
  },
});
