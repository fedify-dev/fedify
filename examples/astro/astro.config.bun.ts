import bun from "@nurodev/astro-bun";
import { fedifyIntegration } from "@fedify/astro";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  integrations: [fedifyIntegration()],
  output: "server",
  adapter: bun(),
  server: { host: true, allowedHosts: true },
  security: { allowedDomains: [{}] },
});
