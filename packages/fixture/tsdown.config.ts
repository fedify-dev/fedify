import { cp, glob } from "node:fs/promises";
import { join, sep } from "node:path";
import { defineConfig } from "tsdown";

export default [
  defineConfig({
    entry: ["src/mod.ts"],
    dts: true,
    format: ["esm", "cjs"],
    platform: "neutral",
    external: [/^node:/],
    hooks: {
      "build:done": async (ctx) => {
        for await (const file of glob("src/fixtures/**/*.json")) {
          await cp(
            file,
            join(ctx.options.outDir, file.replace(`src${sep}`, "")),
            { force: true },
          );
        }
      },
    },
  }),
  defineConfig({
    entry: (await Array.fromAsync(glob(`src/**/*.test.ts`)))
      .map((f) => f.replace(sep, "/")),
    format: ["esm", "cjs"],
    platform: "node",
    external: [
      /^node:/,
      "@fedify/vocab-runtime",
    ],
  }),
];

// cSpell: ignore onwarn
