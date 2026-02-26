import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  dts: { compilerOptions: { isolatedDeclarations: true, declaration: true } },
  platform: "node",
  format: ["esm", "cjs"],
  outputOptions: {
    exports: "named",
  },
});
