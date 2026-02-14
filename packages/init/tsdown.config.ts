import { cp } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/mod.ts", "src/test/mod.ts"],
  platform: "node",
  unbundle: true,
  external: [/^node:/],
  hooks: {
    "build:done": async (ctx) => {
      await cp(
        join("src", "templates"),
        join(ctx.options.outDir, "templates"),
        { recursive: true },
      );
      await cp(
        join("src", "json"),
        join(ctx.options.outDir, "json"),
        { recursive: true },
      );
    },
  },
});
