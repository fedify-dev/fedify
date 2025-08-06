import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/mod.ts", "src/kv.ts", "src/sqlite.node.ts", "src/sqlite.bun.ts"],
  dts: true,
  unbundle: true,
  platform: "node",
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
  outputOptions: {
    intro: `
      import { Temporal } from "@js-temporal/polyfill";
    `,
  },
});
