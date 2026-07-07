import { defineConfig } from "tsdown";
import {
  isTemporalPolyfillDependency,
  temporalPolyfillCjsBanner,
  temporalPolyfillEsmBanner,
  temporalPolyfillImportPlugin,
} from "../../scripts/tsdown/temporal.mts";

export default defineConfig({
  entry: ["src/mod.tsx"],
  dts: { compilerOptions: { isolatedDeclarations: true, declaration: true } },
  format: {
    esm: {
      banner: temporalPolyfillEsmBanner(),
    },
    cjs: {
      deps: {
        neverBundle: [
          "@fedify/fedify",
          "@fedify/fedify/federation",
          "@fedify/fedify/otel",
          "@logtape/logtape",
          /^@logtape\//,
          /^@opentelemetry\//,
          "hono",
          /^hono\//,
        ],
        alwaysBundle: isTemporalPolyfillDependency,
        skipNodeModulesBundle: false,
      },
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
  deps: {
    neverBundle: [
      "@fedify/fedify",
      "@fedify/fedify/federation",
      "@fedify/fedify/otel",
      "@logtape/logtape",
      /^@logtape\//,
      /^@opentelemetry\//,
      "hono",
      /^hono\//,
    ],
  },
});
