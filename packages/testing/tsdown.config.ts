import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "src/mod.ts",
  dts: true,
  format: ["esm", "cjs"],
  platform: "node",
  external: [
    "@fedify/fedify",
    "@fedify/fedify/federation",
    "@fedify/fedify/nodeinfo",
    "@fedify/fedify/runtime",
    "@fedify/fedify/vocab",
    "@fedify/fedify/webfinger",
    "@opentelemetry/api",
  ],
});
