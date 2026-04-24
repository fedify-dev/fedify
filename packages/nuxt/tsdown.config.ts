import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/mod.ts",
    "src/runtime/server/middleware.ts",
    "src/runtime/server/plugin.ts",
  ],
  dts: true,
  format: ["esm", "cjs"],
  platform: "node",
  outExtensions({ format }) {
    return {
      js: format === "cjs" ? ".cjs" : ".js",
      dts: format === "cjs" ? ".d.cts" : ".d.ts",
    };
  },
});
