import { defineConfig } from "@solidjs/start/config";

export default defineConfig({
  middleware: "src/middleware/index.ts",
  server: {
    preset: "node-server",
  },
  vite: {
    server: { allowedHosts: true },
  },
});
