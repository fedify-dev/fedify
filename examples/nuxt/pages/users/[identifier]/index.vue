<template>
  <div v-if="data" class="profile-container">
    <a class="back-link" href="/">&larr; Back to home</a>
    <div class="profile-header">
      <div class="avatar-section">
        <img
          :src="data.icon ?? '/demo-profile.png'"
          :alt="`${data.name}'s profile`"
          class="avatar"
        />
      </div>
      <div class="user-info">
        <h1 class="user-name">{{ data.name }}</h1>
        <p class="user-handle">
          @{{ data.identifier }}@{{ data.host }}
        </p>
        <p v-if="data.summary" class="user-bio">{{ data.summary }}</p>
      </div>
    </div>

    <div class="profile-content">
      <div class="info-card">
        <h3>Profile Information</h3>
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">Following</span>
            <span class="info-value">{{ data.followingCount }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Followers</span>
            <span class="info-value">{{ data.followersCount }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Powered by</span>
            <span class="info-value">
              <a
                href="https://fedify.dev"
                class="fedify-anchor"
                target="_blank"
              >
                Fedify
              </a>
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div v-else class="profile-container">
    <p>User not found.</p>
  </div>
</template>

<script setup lang="ts">
const route = useRoute();
const identifier = route.params.identifier as string;

const { data } = await useFetch(`/api/profile/${identifier}`);

useHead({
  title: data.value
    ? `${data.value.name} - Fedify Nuxt Example`
    : "Not Found - Fedify Nuxt Example",
});
</script>
