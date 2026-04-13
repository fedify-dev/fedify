<template>
  <NuxtPage />
</template>

<script setup lang="ts">
useHead({
  link: [
    { rel: "stylesheet", href: "/style.css" },
    { rel: "icon", type: "image/svg+xml", href: "/fedify-logo.svg" },
  ],
  script: [{ src: "/theme.js" }],
});
</script>
