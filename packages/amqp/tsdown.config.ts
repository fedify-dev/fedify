import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/mod.ts", "src/mq.ts"],
  dts: true,
  unbundle: true,
  platform: "node",
});
