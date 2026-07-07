import { glob, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { defineConfig } from "tsdown";
import {
  isTemporalPolyfillDependency,
  temporalPolyfillCjsBanner,
  temporalPolyfillEsmBanner,
  temporalPolyfillImportPlugin,
  temporalPolyfillIntro,
} from "../../scripts/tsdown/temporal.mts";

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
    format: {
      esm: {
        banner: temporalPolyfillEsmBanner(),
      },
      cjs: {
        deps: {
          neverBundle: [/^node:/],
          alwaysBundle: isTemporalPolyfillDependency,
          skipNodeModulesBundle: false,
        },
        plugins: [temporalPolyfillImportPlugin],
        banner: temporalPolyfillCjsBanner(),
      },
    },
    platform: "neutral",
    deps: {
      neverBundle: [/^node:/],
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
      intro: `${temporalPolyfillIntro}
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
