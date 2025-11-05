import { defineNitroConfig } from "nitropack/config"

// https://nitro.build/config
export default defineNitroConfig({
  errorHandler: "~/error",
  esbuild: {
    options: {
      target: "esnext",
    },
  },
  compatibilityDate: "latest",
  srcDir: "server",
  imports: false
});
