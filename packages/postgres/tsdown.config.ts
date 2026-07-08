import { defineConfig } from "tsdown";
import {
  temporalPolyfillCjsBanner,
  temporalPolyfillCjsDeps,
  temporalPolyfillEsmBanner,
  temporalPolyfillImportPlugin,
} from "../../scripts/tsdown/temporal.mts";

export default defineConfig({
  entry: ["src/mod.ts", "src/kv.ts", "src/mq.ts"],
  dts: { compilerOptions: { isolatedDeclarations: true, declaration: true } },
  unbundle: true,
  format: {
    esm: {
      banner: temporalPolyfillEsmBanner(),
    },
    cjs: {
      deps: temporalPolyfillCjsDeps(),
      plugins: [temporalPolyfillImportPlugin],
      banner: temporalPolyfillCjsBanner(),
    },
  },
  platform: "node",
  outExtensions({ format }) {
    return {
      js: format === "cjs" ? ".cjs" : ".js",
      dts: format === "cjs" ? ".d.cts" : ".d.ts",
    };
  },
});
