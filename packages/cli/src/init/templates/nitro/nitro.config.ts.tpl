import { defineNitroConfig } from "nitropack/config"

// https://nitro.build/config
export default defineNitroConfig({
  errorHandler: "~/error",
  esbuild: {
    options: {
      target: "es2020",
    },
  },
  compatibilityDate: "latest",
  srcDir: "server",
  imports: false
});
