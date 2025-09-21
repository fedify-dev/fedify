import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/mod.ts", "src/codec.ts", "src/kv.ts", "src/mq.ts"],
  dts: true,
  unbundle: true,
  format: ["esm", "cjs"],
  platform: "node",
  outputOptions(outputOptions, format) {
    if (format === "cjs") {
      outputOptions.intro = `
        const { Temporal } = require("@js-temporal/polyfill");
      `;
    } else {
      outputOptions.intro = `
        import { Temporal } from "@js-temporal/polyfill";
      `;
    }
    return outputOptions;
  },
});
