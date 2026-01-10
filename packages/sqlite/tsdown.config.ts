import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/mod.ts", "src/kv.ts", "src/sqlite.node.ts", "src/sqlite.bun.ts"],
  dts: true,
  unbundle: true,
  format: ["esm", "cjs"],
  platform: "neutral",
  inputOptions: {
    onwarn(warning, defaultHandler) {
      if (
        warning.code === "UNRESOLVED_IMPORT" &&
        ["#sqlite", "bun:sqlite"].includes(warning.exporter ?? "")
      ) {
        return;
      }
      defaultHandler(warning);
    },
  },
  outputOptions(outputOptions, format) {
    if (format === "cjs") {
      outputOptions.intro = `
        const { Temporal } = require("@js-temporal/polyfill");
      `;
    } else {
      outputOptions.intro = `
        import { Temporal } from "@js-temporal/polyfill";
      `;
    }
    return outputOptions;
  },
});
