import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts"],
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
