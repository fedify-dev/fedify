export default defineNuxtConfig({
  modules: ["@fedify/nuxt"],
  fedify: { federationModule: "#server/federation" },
  ssr: true,
  // The settings below loosen dev-server defenses to support tunnel-based
  // federation testing (e.g., `fedify tunnel`). Not recommended for general
  // Nuxt projects — remove or tighten before reusing this config.
  devServer: { host: "0.0.0.0" },
  vite: { server: { allowedHosts: true } },
});
