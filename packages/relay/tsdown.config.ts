import { glob } from "node:fs/promises";
import { sep } from "node:path";
import { defineConfig } from "tsdown";

export default [
  defineConfig({
    entry: ["src/mod.ts"],
    dts: true,
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
  }),
  defineConfig({
    entry: (await Array.fromAsync(glob(`src/**/*.test.ts`)))
      .map((f) => f.replace(sep, "/")),
    dts: true,
    external: [/^node:/],
    outputOptions: {
      intro: `
      import { Temporal } from "@js-temporal/polyfill";
      import { URLPattern } from "urlpattern-polyfill";
      globalThis.addEventListener = () => {};
    `,
    },
  }),
];
