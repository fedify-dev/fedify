<template>
  <div v-if="data" class="post-detail-container">
    <NuxtLink class="back-link" to="/">&larr; Back to home</NuxtLink>
    <article class="post-detail-card">
      <a
        class="post-detail-author"
        :href="`/users/${data.identifier}`"
      >
        <img
          :src="data.author.icon ?? '/demo-profile.png'"
          :alt="`${data.author.name}'s profile`"
          class="author-avatar"
        />
        <div class="author-info">
          <h1 class="author-name">{{ data.author.name }}</h1>
          <p class="author-handle">
            @{{ data.identifier }}@{{ data.host }}
          </p>
          <time
            v-if="data.published"
            class="post-timestamp"
            :datetime="data.published"
          >
            {{ formatDate(data.published) }}
          </time>
        </div>
      </a>
      <div class="post-detail-content">
        <p>{{ data.content }}</p>
      </div>
    </article>
  </div>
  <div v-else class="post-detail-container">
    <NuxtLink class="back-link" to="/">&larr; Back to home</NuxtLink>
    <p>Post not found.</p>
  </div>
</template>

<script setup lang="ts">
const route = useRoute();
const identifier = route.params.identifier as string;
const id = route.params.id as string;

const { data } = await useFetch(`/api/posts/${identifier}/${id}`);

useHead({
  title: data.value
    ? `Post - ${data.value.author.name} - Fedify Nuxt Example`
    : "Not Found - Fedify Nuxt Example",
});

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
</script>
