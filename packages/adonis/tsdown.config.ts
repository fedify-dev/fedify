import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/mod.ts"],
  dts: { compilerOptions: { isolatedDeclarations: true, declaration: true } },
  format: ["esm", "cjs"],
  platform: "node",
  outExtensions({ format }) {
    return {
      js: format === "cjs" ? ".cjs" : ".js",
      dts: format === "cjs" ? ".d.cts" : ".d.ts",
    };
  },
});
