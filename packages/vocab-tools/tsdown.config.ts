import { cp } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/mod.ts"],
  dts: { compilerOptions: { isolatedDeclarations: true, declaration: true } },
  format: ["esm", "cjs"],
  platform: "neutral",
  external: [/^node:/],
  hooks: {
    "build:done": async (ctx) => {
      await cp(
        join("src", "schema.yaml"),
        join(ctx.options.outDir, "schema.yaml"),
        { force: true },
      );
    },
  },
});
