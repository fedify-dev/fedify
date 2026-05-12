import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/mod.ts"],
  platform: "node",
  unbundle: true,
  outExtensions() {
    return { js: ".js", dts: ".d.ts" };
  },
  deps: { neverBundle: [/^node:/] },
});
