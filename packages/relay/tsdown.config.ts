import { glob } from "node:fs/promises";
import { sep } from "node:path";
import { defineConfig } from "tsdown";

export default [
  defineConfig({
    entry: ["src/mod.ts"],
    dts: { compilerOptions: { isolatedDeclarations: true, declaration: true } },
    format: ["esm", "cjs"],
    platform: "node",
    outExtensions({ format }) {
      return {
        js: format === "cjs" ? ".cjs" : ".js",
        dts: format === "cjs" ? ".d.cts" : ".d.ts",
      };
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
  }),
  defineConfig({
    entry: (await Array.fromAsync(glob(`src/**/*.test.ts`)))
      .map((f) => f.replace(sep, "/")),
    outExtensions({ format }) {
      return {
        js: format === "cjs" ? ".cjs" : ".js",
        dts: format === "cjs" ? ".d.cts" : ".d.ts",
      };
    },
    deps: { neverBundle: [/^node:/] },
    outputOptions: {
      intro: `
      import { Temporal } from "@js-temporal/polyfill";
      import { URLPattern } from "urlpattern-polyfill";
      globalThis.addEventListener = () => {};
    `,
    },
  }),
];
