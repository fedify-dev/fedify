import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/mod.ts", "src/kv.ts", "src/mq.ts"],
  dts: { compilerOptions: { isolatedDeclarations: true, declaration: true } },
  unbundle: true,
  format: ["esm", "cjs"],
  platform: "node",
  outExtensions({ format }) {
    if (format === "cjs") return { js: ".cjs", dts: ".d.cts" };
    return { js: ".js", dts: ".d.ts" };
  },
  banner({ format }) {
    const js = format === "cjs"
      ? `const { Temporal } = require("@js-temporal/polyfill");`
      : `import { Temporal } from "@js-temporal/polyfill";`;
    return {
      js,
      dts: `/// <reference lib="esnext.temporal" />`,
    };
  },
});
