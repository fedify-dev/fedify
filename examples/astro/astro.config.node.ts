import { fedifyIntegration } from "@fedify/astro";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  integrations: [fedifyIntegration()],
  output: "server",
  server: {
    host: true,
    allowedHosts: true,
  },
});
