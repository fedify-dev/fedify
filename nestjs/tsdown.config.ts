import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["index.ts"],
  dts: true,
  platform: "node",
  format: ["commonjs", "esm"],
});
