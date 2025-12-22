import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/mod.ts"],
  dts: true,
  format: ["esm", "cjs"],
  platform: "neutral",
  external: [/^node:/],
  outputOptions(outputOptions, format) {
    if (format === "cjs") {
      outputOptions.intro = `
          const { Temporal } = require("@js-temporal/polyfill");
          const { URLPattern } = require("urlpattern-polyfill");
        `;
    } else {
      outputOptions.intro = `
          import { Temporal } from "@js-temporal/polyfill";
          import { URLPattern } from "urlpattern-polyfill";
        `;
    }
    return outputOptions;
  },
});

// cSpell: ignore unbundle
