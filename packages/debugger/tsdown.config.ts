import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/mod.ts"],
  dts: true,
  format: ["esm", "cjs"],
  platform: "node",
  external: [
    "@fedify/fedify",
    "@fedify/fedify/federation",
    "@fedify/fedify/otel",
  ],
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
