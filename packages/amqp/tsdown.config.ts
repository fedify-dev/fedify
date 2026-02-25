import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/mod.ts", "src/mq.ts"],
  dts: { compilerOptions: { isolatedDeclarations: true, declaration: true } },
  unbundle: true,
  format: ["esm", "cjs"],
  platform: "node",
});
