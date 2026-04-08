<script setup lang="ts">
const route = useRoute();
const identifier = computed(() => String(route.params.identifier ?? "demo"));
</script>

<template>
  <main class="profile-shell">
    <article class="profile-card">
      <p class="eyebrow">Shared Route Demo</p>
      <h1>@{{ identifier }}</h1>
      <p class="summary">
        This HTML page is served by Nuxt when a browser requests the actor URL.
        The same path is served as ActivityPub JSON by Fedify when the client
        asks for application/activity+json.
      </p>
      <dl class="facts">
        <div>
          <dt>Profile URL</dt>
          <dd>/users/{{ identifier }}</dd>
        </div>
        <div>
          <dt>Lookup</dt>
          <dd>@{{ identifier }}@localhost:3000</dd>
        </div>
      </dl>
      <p class="hint">
        Try:
        <code>curl -H "Accept: application/activity+json" http://localhost:3000/users/{{ identifier }}</code>
      </p>
    </article>
  </main>
</template>

<style scoped>
.profile-shell {
  min-height: 100vh;
  padding: 2rem;
  display: grid;
  place-items: center;
  background:
    linear-gradient(180deg, rgba(245, 158, 11, 0.16), transparent 26%),
    linear-gradient(135deg, #0f172a 0%, #1e293b 34%, #f8fafc 34%, #f8fafc 100%);
}

.profile-card {
  width: min(100%, 44rem);
  padding: 2.25rem;
  border-radius: 1.75rem;
  background: #ffffff;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.18);
}

.eyebrow {
  margin: 0;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #b45309;
}

h1 {
  margin: 0.4rem 0 0;
  font-size: clamp(2.3rem, 7vw, 4rem);
  line-height: 1;
  color: #0f172a;
}

.summary {
  margin: 1rem 0 0;
  color: #334155;
  line-height: 1.8;
}

.facts {
  display: grid;
  gap: 1rem;
  margin: 1.5rem 0 0;
}

.facts div {
  padding: 1rem 1.1rem;
  border-radius: 1rem;
  background: #f8fafc;
}

dt {
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #64748b;
}

dd {
  margin: 0.3rem 0 0;
  font-size: 1rem;
  color: #0f172a;
}

.hint {
  margin-top: 1.5rem;
  line-height: 1.7;
  color: #334155;
}

code {
  display: inline-block;
  margin-top: 0.4rem;
  padding: 0.6rem 0.75rem;
  border-radius: 0.75rem;
  background: #e2e8f0;
  color: #0f172a;
  word-break: break-all;
}
</style>