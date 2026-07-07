import { defineConfig } from "tsdown";
import { temporalPolyfillIntro } from "../../scripts/tsdown/temporal.mts";

export default defineConfig({
  entry: [
    "src/mod.ts",
    "src/kv.bun.ts",
    "src/kv.node.ts",
  ],
  platform: "node",
  unbundle: true,
  outExtensions() {
    return { js: ".js" };
  },
  deps: { neverBundle: [/^node:/] },
  inputOptions: {
    onwarn(warning, defaultHandler) {
      if (
        warning.code === "UNRESOLVED_IMPORT" &&
        ["#kv", "bun:sqlite"].includes(warning.exporter ?? "")
      ) {
        return;
      }
      defaultHandler(warning);
    },
  },
  outputOptions(outputOptions) {
    outputOptions.intro = temporalPolyfillIntro;
    return outputOptions;
  },
});
