import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "mod.ts",
  dts: true,
  platform: "node",
  external: [
    "@fedify/fedify",
    "@fedify/fedify/federation",
    "@fedify/fedify/nodeinfo",
    "@fedify/fedify/runtime",
    "@fedify/fedify/vocab",
    "@fedify/fedify/webfinger",
    "@fedify/fedify/testing",
    "@opentelemetry/api",
  ],
});
