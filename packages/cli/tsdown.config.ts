import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/mod.ts",
    "src/kv.bun.ts",
    "src/kv.node.ts",
  ],
  platform: "node",
  unbundle: true,
  external: [/^node:/],
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
});
