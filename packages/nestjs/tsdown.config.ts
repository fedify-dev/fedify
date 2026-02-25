import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  dts: {
    compilerOptions: {
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      isolatedDeclarations: true,
      declaration: true,
    },
  },
  platform: "node",
  format: ["esm", "cjs"],
});
