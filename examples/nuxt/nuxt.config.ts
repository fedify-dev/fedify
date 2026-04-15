export default defineNuxtConfig({
  modules: ["@fedify/nuxt"],
  fedify: { federationModule: "#server/federation" },
  ssr: true,
  devServer: { host: "0.0.0.0" },
  vite: { server: { allowedHosts: true } },
});
