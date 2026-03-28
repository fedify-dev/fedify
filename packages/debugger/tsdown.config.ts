import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/mod.tsx"],
  dts: { compilerOptions: { isolatedDeclarations: true, declaration: true } },
  format: ["esm", "cjs"],
  platform: "node",
  outExtensions({ format }) {
    return {
      js: format === "cjs" ? ".cjs" : ".js",
      dts: format === "cjs" ? ".d.cts" : ".d.ts",
    };
  },
  deps: {
    neverBundle: [
      "@fedify/fedify",
      "@fedify/fedify/federation",
      "@fedify/fedify/otel",
      "@logtape/logtape",
      /^@logtape\//,
      /^@opentelemetry\//,
      "hono",
      /^hono\//,
    ],
  },
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
