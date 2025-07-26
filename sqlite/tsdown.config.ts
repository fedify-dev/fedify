import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["mod.ts", "kv.ts", "sqlite.node.ts", "sqlite.bun.ts"],
  dts: true,
  unbundle: true,
  platform: "node",
  outputOptions: {
    intro: `
import { Temporal } from "@js-temporal/polyfill";
    `,
  },
});
