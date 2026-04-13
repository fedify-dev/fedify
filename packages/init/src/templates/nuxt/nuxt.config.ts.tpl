// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ["@fedify/nuxt"],
  fedify: { federationModule: "~~/server/federation" },
  ssr: true,
});
