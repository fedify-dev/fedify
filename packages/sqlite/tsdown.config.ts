import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/mod.ts",
    "src/kv.ts",
    "src/mq.ts",
    "src/sqlite.node.ts",
    "src/sqlite.bun.ts",
  ],
  dts: { compilerOptions: { isolatedDeclarations: true, declaration: true } },
  unbundle: true,
  format: ["esm", "cjs"],
  platform: "node",
  outExtensions({ format }) {
    return {
      js: format === "cjs" ? ".cjs" : ".js",
      dts: format === "cjs" ? ".d.cts" : ".d.ts",
    };
  },
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
  banner({ format }) {
    const js = format === "cjs"
      ? `const { Temporal } = require("@js-temporal/polyfill");`
      : `import { Temporal } from "@js-temporal/polyfill";`;
    return {
      js,
      dts: `/// <reference lib="esnext.temporal" />`,
    };
  },
});
