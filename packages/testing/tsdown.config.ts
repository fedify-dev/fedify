import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "src/mod.ts",
  dts: true,
  format: ["esm", "cjs"],
  platform: "node",
  outExtensions({ format }) {
    return {
      js: format === "cjs" ? ".cjs" : ".js",
      dts: format === "cjs" ? ".d.cts" : ".d.ts",
    };
  },
  deps: {
    neverBundle: [
      "@fedify/fedify",
      "@fedify/fedify/federation",
      "@fedify/fedify/nodeinfo",
      "@fedify/fedify/runtime",
      "@fedify/fedify/vocab",
      "@fedify/fedify/webfinger",
    ],
  },
});
