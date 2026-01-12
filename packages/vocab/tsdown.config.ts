import { cp, glob } from "node:fs/promises";
import { join, sep } from "node:path";
import { defineConfig } from "tsdown";

export default [
  defineConfig({
    entry: [
      "./src/mod.ts",
    ],
    dts: true,
    format: ["esm", "cjs"],
    platform: "neutral",
    external: [/^node:/],
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
    inputOptions: {
      onwarn(warning, defaultHandler) {
        if (
          warning.code === "UNRESOLVED_IMPORT" &&
          warning.id?.endsWith("vocab.test.ts") &&
          warning.exporter &&
          warning.exporter === "@std/testing/snapshot"
        ) {
          return;
        }
        defaultHandler(warning);
      },
    },
    outputOptions: {
      intro: `
      import { Temporal } from "@js-temporal/polyfill";
      globalThis.addEventListener = () => {};
    `,
    },
    hooks: {
      "build:done": async (ctx) => {
        for await (const file of glob("src/**/*.yaml")) {
          await cp(
            file,
            join(ctx.options.outDir, file.replace(`src${sep}`, "")),
            { force: true },
          );
        }
      },
    },
  }),
];

// cSpell: ignore onwarn
