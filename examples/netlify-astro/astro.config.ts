import netlify from "@astrojs/netlify";
import { fedifyIntegration } from "@fedify/astro";
import { defineConfig } from "astro/config";

export default defineConfig({
  adapter: netlify(),
  integrations: [fedifyIntegration()],
  output: "server",
  server: { host: true, allowedHosts: true },
});
