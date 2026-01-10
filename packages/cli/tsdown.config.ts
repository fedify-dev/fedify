import { cp } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/mod.ts",
    "src/init/test/mod.ts",
    "src/kv.bun.ts",
    "src/kv.node.ts",
  ],
  platform: "neutral",
  unbundle: true,
  inputOptions: {
    onwarn(warning, defaultHandler) {
      if (
        warning.code === "UNRESOLVED_IMPORT" &&
        ["#kv", "bun:sqlite"].includes(warning.exporter ?? "")
      ) {
        return;
      }
      defaultHandler(warning);
    },
  },
  outputOptions(outputOptions) {
    outputOptions.intro = `
      import { Temporal } from "@js-temporal/polyfill";
    `;
    return outputOptions;
  },
  hooks: {
    "build:done": async (ctx) => {
      await cp(
        join("src", "init", "templates"),
        join(ctx.options.outDir, "init", "templates"),
        { recursive: true },
      );
    },
  },
});
