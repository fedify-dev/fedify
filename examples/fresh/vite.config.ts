import { fresh } from "@fresh/plugin-vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [fresh()],
  ssr: {
    external: [
      "@fedify/fedify",
    ],
  },
  build: {
    rollupOptions: {
      external: [
        "@fedify/fedify",
      ],
    },
  },
});
