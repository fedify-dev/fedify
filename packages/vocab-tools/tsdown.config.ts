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
        await cp(
          join("src", "schema.yaml"),
          join(ctx.options.outDir, "schema.yaml"),
          { force: true },
        );
      },
    },
  }),
  defineConfig({
    entry: (await Array.fromAsync(glob(`src/**/*.test.ts`)))
      .map((f) => f.replace(sep, "/")),
    format: ["esm"],
    platform: "node",
    external: [
      /^node:/,
      /^bun:/,
    ],
    inputOptions: {
      onwarn(warning, defaultHandler) {
        if (
          warning.code === "UNRESOLVED_IMPORT" &&
          warning.id?.endsWith(".test.ts") &&
          warning.exporter &&
          ["bun:test", "@std/testing/snapshot"].includes(warning.exporter)
        ) {
          return;
        }
        defaultHandler(warning);
      },
    },
    hooks: {
      "build:done": async (ctx) => {
        await cp(
          join("src", "__snapshots__"),
          join(ctx.options.outDir, "__snapshots__"),
          { recursive: true },
        );
      },
    },
  }),
];
// cSpell: ignore onwarn
