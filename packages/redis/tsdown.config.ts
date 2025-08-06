import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/mod.ts", "src/codec.ts", "src/kv.ts", "src/mq.ts"],
  dts: true,
  unbundle: true,
  platform: "node",
  outputOptions: {
    intro: `
      import { Temporal } from "@js-temporal/polyfill";
    `,
  },
});
