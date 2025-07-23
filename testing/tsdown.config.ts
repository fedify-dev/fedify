import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "mod.ts",
  dts: true,
  platform: "node",
});
