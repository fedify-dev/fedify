import { glob } from "node:fs/promises";
import { sep } from "node:path";
import { defineConfig } from "tsdown";
import {
  temporalPolyfillCjsBanner,
  temporalPolyfillCjsDeps,
  temporalPolyfillEsmBanner,
  temporalPolyfillImportPlugin,
  temporalPolyfillIntro,
} from "../../scripts/tsdown/temporal.mts";

export default [
  defineConfig({
    entry: ["src/mod.ts"],
    dts: { compilerOptions: { isolatedDeclarations: true, declaration: true } },
    format: {
      esm: {
        banner: temporalPolyfillEsmBanner(),
      },
      cjs: {
        deps: temporalPolyfillCjsDeps(),
        plugins: [temporalPolyfillImportPlugin],
        banner: temporalPolyfillCjsBanner(),
      },
    },
    platform: "node",
    outExtensions({ format }) {
      return {
        js: format === "cjs" ? ".cjs" : ".js",
        dts: format === "cjs" ? ".d.cts" : ".d.ts",
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
      intro: `${temporalPolyfillIntro}
      import { URLPattern } from "urlpattern-polyfill";
      globalThis.addEventListener = () => {};
    `,
    },
  }),
];
