import { glob, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { defineConfig } from "tsdown";

async function copyFileSafely(
  source: string,
  destination: string,
): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, await readFile(source));
}

export default [
  defineConfig({
    entry: [
      "./src/mod.ts",
    ],
    dts: { compilerOptions: { isolatedDeclarations: true, declaration: true } },
    format: ["esm", "cjs"],
    platform: "neutral",
    deps: { neverBundle: [/^node:/] },
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
    outDir: "dist-tests",
    entry: (await Array.fromAsync(glob(`src/**/*.test.ts`)))
      .map((f) => f.replace(sep, "/")),
    dts: false,
    deps: { neverBundle: [/^node:/, "@fedify/fixture"] },
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
          await copyFileSafely(
            file,
            join(ctx.options.outDir, file.replace(`src${sep}`, "")),
          );
        }
      },
    },
  }),
];

// cSpell: ignore onwarn
