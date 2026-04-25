<template>
  <div class="home-container">
    <div class="profile-header">
      <div class="avatar-section">
        <img
          src="/demo-profile.png"
          alt="Fedify Demo profile"
          class="avatar"
        />
      </div>
      <div class="user-info">
        <h1 class="user-name">Fedify Demo</h1>
        <p class="user-handle" v-if="data">
          @{{ data.identifier }}@{{ data.host }}
        </p>
        <p class="user-bio">This is a Fedify Demo account.</p>
      </div>
    </div>

    <!-- Search -->
    <div class="info-card">
      <h3>Search</h3>
      <input
        v-model="searchQuery"
        type="text"
        class="search-input"
        placeholder="Search by handle (e.g. @user@example.com)"
        @input="onSearchInput"
      />
      <div v-if="searchResult" class="search-result">
        <img
          :src="searchResult.icon ?? '/demo-profile.png'"
          :alt="searchResult.name ?? 'User'"
          class="post-avatar"
        />
        <div class="post-user-info">
          <span class="post-user-name">{{ searchResult.name }}</span>
          <span class="post-user-handle">{{ searchResult.handle }}</span>
        </div>
        <form
          v-if="searchResult.isFollowing"
          method="post"
          action="/api/unfollow"
        >
          <input type="hidden" name="uri" :value="searchResult.uri" />
          <button type="submit" class="danger-button">Unfollow</button>
        </form>
        <form v-else method="post" action="/api/follow">
          <input type="hidden" name="uri" :value="searchResult.uri" />
          <button type="submit" class="post-button">Follow</button>
        </form>
      </div>
    </div>

    <!-- Following -->
    <div class="info-card" id="following-section">
      <h3>Following ({{ data?.following.length ?? 0 }})</h3>
      <div class="info-grid" v-if="data && data.following.length > 0">
        <div
          v-for="f in data.following"
          :key="f.uri"
          class="info-item follower-row"
        >
          <img
            :src="f.icon ?? '/demo-profile.png'"
            :alt="f.name ?? 'User'"
            class="post-avatar"
          />
          <div class="post-user-info">
            <span class="post-user-name">{{ f.name }}</span>
            <span class="follower-item">{{ f.handle }}</span>
          </div>
          <form method="post" action="/api/unfollow">
            <input type="hidden" name="uri" :value="f.uri" />
            <button type="submit" class="danger-button">Unfollow</button>
          </form>
        </div>
      </div>
      <p v-else>Not following anyone yet.</p>
    </div>

    <!-- Followers -->
    <div class="info-card" id="followers-section">
      <h3>Followers ({{ data?.followers.length ?? 0 }})</h3>
      <div class="info-grid" v-if="data && data.followers.length > 0">
        <div
          v-for="f in data.followers"
          :key="f.uri"
          class="info-item follower-row"
        >
          <img
            :src="f.icon ?? '/demo-profile.png'"
            :alt="f.name ?? 'User'"
            class="post-avatar"
          />
          <div class="post-user-info">
            <span class="post-user-name">{{ f.name }}</span>
            <span class="follower-item">{{ f.handle }}</span>
          </div>
        </div>
      </div>
      <p v-else>
        No followers yet. Try following this account from another fediverse
        server.
      </p>
    </div>

    <!-- Compose -->
    <div class="info-card">
      <h3>Compose</h3>
      <form method="post" action="/api/post" class="compose-form">
        <textarea
          name="content"
          class="form-textarea"
          placeholder="What's up?"
          rows="3"
        ></textarea>
        <div class="compose-actions">
          <button type="submit" class="post-button">Post</button>
        </div>
      </form>
    </div>

    <!-- Posts -->
    <div class="info-card">
      <h3>Posts</h3>
      <div
        class="posts-grid"
        v-if="data && data.posts.length > 0"
      >
        <article v-for="post in data.posts" :key="post.id" class="post-card">
          <a :href="post.url" class="post-link">
            <div class="post-header">
              <img
                src="/demo-profile.png"
                alt="Fedify Demo"
                class="post-avatar"
              />
              <div class="post-user-info">
                <h3 class="post-user-name">Fedify Demo</h3>
                <p class="post-user-handle">
                  @{{ data.identifier }}@{{ data.host }}
                </p>
              </div>
            </div>
            <div class="post-content">
              <p>{{ post.content }}</p>
            </div>
            <div v-if="post.published" class="post-timestamp">
              {{ formatDate(post.published) }}
            </div>
          </a>
        </article>
      </div>
      <p v-else>No posts yet. Write your first post above!</p>
    </div>

    <div class="fedify-badge">
      Powered by
      <a href="https://fedify.dev" class="fedify-anchor" target="_blank">
        Fedify
      </a>
    </div>
  </div>
</template>

<script setup lang="ts">
useHead({ title: "Fedify Nuxt Example" });

const { data, refresh } = await useFetch("/api/home");

const searchQuery = ref("");
const searchResult = ref<{
  uri: string;
  name: string | null;
  handle: string;
  icon: string | null;
  isFollowing: boolean;
} | null>(null);

let searchTimeout: ReturnType<typeof setTimeout> | null = null;
let latestSearchRequest = 0;

function onSearchInput() {
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    if (!searchQuery.value.trim()) {
      searchResult.value = null;
      return;
    }
    const requestId = ++latestSearchRequest;
    const res = await $fetch<{ result: typeof searchResult.value }>(
      `/api/search?q=${encodeURIComponent(searchQuery.value)}`,
    );
    if (requestId === latestSearchRequest) {
      searchResult.value = res.result;
    }
  }, 300);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

onMounted(() => {
  const eventSource = new EventSource("/api/events");
  eventSource.onmessage = () => {
    refresh();
  };
  onBeforeUnmount(() => {
    eventSource.close();
  });
});
</script>

<style scoped>
.search-input {
  width: 100%;
  border-radius: 0.5rem;
  border: 1px solid rgba(0, 0, 0, 0.2);
  padding: 0.75rem;
  font-size: 1rem;
  background: var(--background);
  color: var(--foreground);
  transition: border-color 0.2s, box-shadow 0.2s;
  font-family: inherit;
}
.search-input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
}
.search-result {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 1rem;
  padding: 0.75rem;
  border-radius: 0.5rem;
  border: 1px solid rgba(0, 0, 0, 0.1);
}
.follower-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.75rem;
}
.compose-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.compose-actions {
  display: flex;
  justify-content: flex-end;
}
.danger-button {
  padding: 0.5rem 1.5rem;
  border: none;
  border-radius: 0.5rem;
  font-size: 1rem;
  font-weight: 600;
  color: white;
  cursor: pointer;
  background: #ef4444;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transition: transform 0.2s, box-shadow 0.2s;
}
.danger-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
.post-timestamp {
  font-size: 0.875rem;
  opacity: 0.6;
  margin-top: 0.5rem;
  padding: 0 1.5rem 1rem;
}
.fedify-badge {
  text-align: center;
  margin-top: 1rem;
  font-size: 0.875rem;
  opacity: 0.7;
}
</style>
