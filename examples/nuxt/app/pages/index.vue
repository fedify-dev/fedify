<template>
  <main class="page-shell">
    <section class="hero-card">
      <p class="eyebrow">Fedify + Nuxt</p>
      <h1>One route tree for HTML and ActivityPub.</h1>
      <p class="lede">
        This demo serves a Nuxt page to browsers and ActivityPub JSON to
        federated clients from the same paths.
      </p>
      <div class="actions">
        <NuxtLink to="/users/demo">Open the demo actor page</NuxtLink>
        <a
          href="https://fedify.dev/manual/integration"
          rel="noreferrer"
          target="_blank"
        >Read the integration guide</a>
      </div>
    </section>
  </main>
</template>

<style scoped>
.page-shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 2rem;
  background:
    radial-gradient(circle at top left, rgba(14, 165, 233, 0.22), transparent 40%),
    radial-gradient(circle at bottom right, rgba(251, 191, 36, 0.18), transparent 36%),
    linear-gradient(135deg, #fffdf6 0%, #f4f7fb 100%);
}

.hero-card {
  max-width: 46rem;
  padding: 2.5rem;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 1.75rem;
  background: rgba(255, 255, 255, 0.84);
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.12);
  backdrop-filter: blur(14px);
}

.eyebrow {
  margin: 0 0 0.75rem;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #0f766e;
}

h1 {
  margin: 0;
  font-size: clamp(2.4rem, 7vw, 4.3rem);
  line-height: 0.96;
  color: #0f172a;
}

.lede {
  margin: 1.25rem 0 0;
  max-width: 38rem;
  font-size: 1.05rem;
  line-height: 1.75;
  color: #334155;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.9rem;
  margin-top: 1.75rem;
}

.actions a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.9rem;
  padding: 0 1.1rem;
  border-radius: 999px;
  text-decoration: none;
  font-weight: 600;
}

.actions a:first-child {
  background: #0f172a;
  color: #f8fafc;
}

.actions a:last-child {
  background: rgba(15, 23, 42, 0.06);
  color: #0f172a;
}
</style>