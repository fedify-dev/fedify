import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/oxlint.ts"],
  dts: { compilerOptions: { isolatedDeclarations: true, declaration: true } },
  format: ["esm", "cjs"],
  platform: "node",
  outExtensions({ format }) {
    if (format === "cjs") return { js: ".cjs", dts: ".d.cts" };
    return { js: ".js", dts: ".d.ts" };
  },
});
