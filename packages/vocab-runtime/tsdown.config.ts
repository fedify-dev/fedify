import { glob } from "node:fs/promises";
import { sep } from "node:path";
import { defineConfig } from "tsdown";

export default [
  defineConfig({
    entry: [
      "src/mod.ts",
      "src/internal.ts",
      "src/jsonld.ts",
      "src/temporal.ts",
    ],
    dts: { compilerOptions: { isolatedDeclarations: true, declaration: true } },
    format: ["esm", "cjs"],
    platform: "neutral",
    external: [/^node:/],
    banner: {
      dts: `/// <reference lib="esnext.temporal" />`,
    },
  }),
  defineConfig({
    outDir: "dist/tests",
    entry: [
      ...await Array.fromAsync(glob(`src/**/*.test.ts`)),
      // Run by the Node.js pinner tests in a child process, since Node.js
      // cannot run TypeScript sources without flags before 22.6.0:
      "src/pinners/testdata/node-child.ts",
    ].map((f) => f.replace(sep, "/")),
    format: ["esm", "cjs"],
    platform: "node",
    external: [/^node:/, "@fedify/fixture"],
  }),
];
