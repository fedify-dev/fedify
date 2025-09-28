import { glob } from "node:fs/promises";
import { sep } from "node:path";
import { defineConfig } from "tsdown";

export default [
  defineConfig({
    entry: ["src/mod.ts"],
    dts: true,
    format: ["esm", "cjs"],
    platform: "node",
    external: [/^node:/],
  }),
  defineConfig({
    entry: [
      ...(await Array.fromAsync(glob(`src/**/*.test.ts`)))
        .map((f) => f.replace(sep, "/")),
    ],
    dts: true,
    external: [/^node:/],
    platform: "node",
  }),
];
