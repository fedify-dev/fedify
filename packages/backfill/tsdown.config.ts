import { glob } from "node:fs/promises";
import { sep } from "node:path";
import { defineConfig } from "tsdown";

export default [
  defineConfig({
    entry: ["src/mod.ts"],
    dts: true,
    format: ["esm", "cjs"],
    platform: "node",
    outExtensions({ format }) {
      return {
        js: format === "cjs" ? ".cjs" : ".js",
        dts: format === "cjs" ? ".d.cts" : ".d.ts",
      };
    },
  }),
  defineConfig({
    entry: (await Array.fromAsync(glob(`src/**/*.test.ts`)))
      .map((f) => f.replaceAll(sep, "/")),
    format: ["esm", "cjs"],
    platform: "node",
    outExtensions({ format }) {
      return {
        js: format === "cjs" ? ".cjs" : ".js",
        dts: format === "cjs" ? ".d.cts" : ".d.ts",
      };
    },
    deps: { neverBundle: [/^node:/] },
  }),
];
