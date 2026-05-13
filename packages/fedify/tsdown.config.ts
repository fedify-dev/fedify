import { glob } from "node:fs/promises";
import { join, sep } from "node:path";
import { defineConfig } from "tsdown";

function isTestingHelperImporter(importer: string | undefined): boolean {
  const normalized = importer?.replaceAll(sep, "/");
  return normalized?.includes("/src/testing/") ?? false;
}

export default [
  defineConfig({
    entry: [
      "./src/mod.ts",
      "./src/compat/mod.ts",
      "./src/federation/mod.ts",
      "./src/nodeinfo/mod.ts",
      "./src/otel/mod.ts",
      "./src/runtime/mod.ts",
      "./src/utils/mod.ts",
      "./src/sig/mod.ts",
      "./src/vocab/mod.ts",
    ],
    dts: { compilerOptions: { isolatedDeclarations: true, declaration: true } },
    format: ["esm", "cjs"],
    platform: "neutral",
    deps: { neverBundle: [/^node:/] },
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
    deps: {
      neverBundle: (id: string, parentId?: string) => {
        if (id.startsWith("node:")) return true;
        if (id !== "@fedify/fixture") return;
        return !isTestingHelperImporter(parentId);
      },
      // Bundle @fedify/fixture back in for src/testing/ files (needed for
      // cfworkers), while keeping it external for test files so that
      // pnpm pack --recursive does not try to resolve the private package:
      alwaysBundle: (id: string, importer: string | undefined) => {
        if (id !== "@fedify/fixture") return;
        return isTestingHelperImporter(importer);
      },
    },
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
