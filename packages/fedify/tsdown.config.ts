import { glob } from "node:fs/promises";
import { join, sep } from "node:path";
import { defineConfig } from "tsdown";

export default [
  defineConfig({
    entry: [
      "./src/mod.ts",
      "./src/compat/mod.ts",
      "./src/federation/mod.ts",
      "./src/nodeinfo/mod.ts",
      "./src/otel/mod.ts",
      "./src/utils/mod.ts",
      "./src/sig/mod.ts",
    ],
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
  }),
  defineConfig({
    entry: [
      "./src/testing/mod.ts",
      ...(await Array.fromAsync(glob(`src/**/*.test.ts`)))
        .map((f) => f.replace(sep, "/")),
    ],
    dts: true,
    external: [/^node:/],
    inputOptions: {
      onwarn(warning, defaultHandler) {
        if (
          warning.code === "UNRESOLVED_IMPORT" &&
          warning.id?.endsWith(join("testing", "mod.ts")) &&
          warning.exporter === "bun:test"
        ) {
          return;
        }
        defaultHandler(warning);
      },
    },
    outputOptions: {
      intro: `
      import { Temporal } from "@js-temporal/polyfill";
      import { URLPattern } from "urlpattern-polyfill";
      globalThis.addEventListener = () => {};
    `,
    },
  }),
];

// cSpell: ignore onwarn
