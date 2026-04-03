import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/mod.ts", "src/codec.ts", "src/kv.ts", "src/mq.ts"],
  dts: { compilerOptions: { isolatedDeclarations: true, declaration: true } },
  unbundle: true,
  format: ["esm", "cjs"],
  platform: "node",
  outExtensions({ format }) {
    return {
      js: format === "cjs" ? ".cjs" : ".js",
      dts: format === "cjs" ? ".d.cts" : ".d.ts",
    };
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
