import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/*.spec.ts"],
  unbundle: true,
  dts: true,
  platform: "neutral",
  format: ["esm", "cjs"],
});
