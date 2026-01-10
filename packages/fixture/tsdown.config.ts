import { cp } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/mod.ts"],
  dts: true,
  format: ["esm"],
  platform: "neutral",
  external: [/^node:/],
  inputOptions: {
    onwarn(warning, defaultHandler) {
      if (
        warning.code === "UNRESOLVED_IMPORT" &&
        warning.id?.endsWith(join("mod.ts")) &&
        warning.exporter === "bun:test"
      ) {
        return;
      }
      defaultHandler(warning);
    },
  },
  outputOptions: {
    intro: `
      import { Temporal } from "@js-temporal/polyfill";
      import { URLPattern } from "urlpattern-polyfill";
      globalThis.addEventListener = () => {};
    `,
  },
  hooks: {
    "build:done": async (ctx) => {
      await cp(
        join("src", "fixtures"),
        join(ctx.options.outDir, "fixtures"),
        { recursive: true },
      );
    },
  },
});

// cSpell: ignore onwarn
