import { cp } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/mod.ts"],
  dts: true,
  format: ["esm", "cjs"],
  platform: "node",
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
