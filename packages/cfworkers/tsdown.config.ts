import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/mod.ts"],
  dts: true,
  platform: "node",
  outExtensions() {
    return { js: ".js", dts: ".d.ts" };
  },
});
