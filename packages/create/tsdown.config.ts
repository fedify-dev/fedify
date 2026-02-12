import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/mod.ts"],
  platform: "node",
  unbundle: true,
  external: [/^node:/],
});
