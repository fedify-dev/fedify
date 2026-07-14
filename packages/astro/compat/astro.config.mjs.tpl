import node from "@astrojs/node";
import { fedifyIntegration } from "@fedify/astro";
import { defineConfig } from "astro/config";

export default defineConfig({
  adapter: node({ mode: "standalone" }),
  integrations: [fedifyIntegration()],
  output: "server",
});
