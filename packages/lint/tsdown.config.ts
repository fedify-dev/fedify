import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/eslint.ts"],
  dts: true,
  format: ["esm", "cjs"],
  platform: "node",
  exports: "named",
});
