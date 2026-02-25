import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/mod.ts"],
  dts: { compilerOptions: { isolatedDeclarations: true, declaration: true } },
  platform: "node",
});
