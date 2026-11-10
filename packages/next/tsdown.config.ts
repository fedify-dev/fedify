import { defineConfig } from "tsdown";

export default [
  defineConfig({
    entry: ["src/index.ts"],
    dts: { compilerOptions: { isolatedDeclarations: true, declaration: true } },
    platform: "node",
    format: ["esm", "cjs"],
    outExtensions({ format }) {
      return {
        js: format === "cjs" ? ".cjs" : ".js",
        dts: format === "cjs" ? ".d.cts" : ".d.ts",
      };
    },
  }),
  defineConfig({
    entry: ["src/index.test.ts"],
    outDir: "dist-tests",
    dts: false,
    platform: "node",
    format: ["cjs"],
    deps: { neverBundle: ["@fedify/fixture"] },
    outExtensions: () => ({ js: ".cjs" }),
  }),
];
