import { glob } from "node:fs/promises";
import { sep } from "node:path";
import { defineConfig } from "tsdown";

export default [
  defineConfig({
    entry: ["src/mod.ts", "src/jsonld.ts"],
    dts: { compilerOptions: { isolatedDeclarations: true, declaration: true } },
    format: ["esm", "cjs"],
    platform: "neutral",
    deps: { neverBundle: [/^node:/] },
  }),
  defineConfig({
    outDir: "dist/tests",
    entry: (await Array.fromAsync(glob(`src/**/*.test.ts`)))
      .map((f) => f.replace(sep, "/")),
    format: ["esm", "cjs"],
    platform: "node",
    deps: { neverBundle: [/^node:/, "@fedify/fixture"] },
  }),
];
