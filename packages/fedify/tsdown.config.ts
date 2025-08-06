import { cp, glob } from "node:fs/promises";
import { join, sep } from "node:path";
import { defineConfig } from "tsdown";

export default [
  defineConfig({
    entry: [
      "./src/mod.ts",
      "./src/compat/mod.ts",
      "./src/federation/mod.ts",
      "./src/nodeinfo/mod.ts",
      "./src/runtime/mod.ts",
      "./src/sig/mod.ts",
      "./src/vocab/mod.ts",
      "./src/webfinger/mod.ts",
      "./src/x/cfworkers.ts",
      "./src/x/hono.ts",
      "./src/x/sveltekit.ts",
    ],
    dts: true,
    platform: "neutral",
    external: [/^node:/],
    outputOptions: {
      intro: `
      import { Temporal } from "@js-temporal/polyfill";
      import { URLPattern } from "urlpattern-polyfill";
    `,
    },
  }),
  defineConfig({
    entry: [
      "./src/testing/mod.ts",
      ...(await Array.fromAsync(glob(`src/**/*.test.ts`)))
        .filter((f) =>
          !f.startsWith(`src${sep}codegen${sep}`) &&
          f !== `src${sep}x${sep}denokv.test.ts`
        )
        .map((f) => f.replace(sep, "/")),
    ],
    dts: true,
    external: [/^node:/],
    inputOptions: {
      onwarn(warning, defaultHandler) {
        if (
          warning.code === "UNRESOLVED_IMPORT" &&
          warning.id?.endsWith(join("vocab", "vocab.test.ts")) &&
          warning.exporter === "@std/testing/snapshot"
        ) {
          return;
        } else if (
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
    hooks: {
      "build:done": async (ctx) => {
        await cp(
          join("src", "testing", "fixtures"),
          join(ctx.options.outDir, "fixtures"),
          { recursive: true },
        );
        await cp(
          join("src", "codegen", "schema.yaml"),
          join(ctx.options.outDir, "vocab", "schema.yaml"),
          { force: true },
        );
        for await (const file of glob("src/vocab/**/*.yaml")) {
          await cp(
            file,
            join(ctx.options.outDir, file),
            { force: true },
          );
        }
      },
    },
  }),
];

// cSpell: ignore unbundle
