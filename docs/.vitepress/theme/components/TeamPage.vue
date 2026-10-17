<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { withBase } from "vitepress";
import { data } from "../../../team.data";
import {
  fetchContributors,
  parseContributors,
  visibleContributors,
} from "../../contributors.mts";
import TeamMembers from "./TeamMembers.vue";

const contributors = ref(data);
const controller = new AbortController();
const cacheKey = "fedify-contributors-v1";
const cacheLifetime = 60 * 60 * 1000;

onUnmounted(() => controller.abort());
onMounted(async () => {
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) ?? "null");
    if (
      cached && typeof cached.time === "number" && cached.time <= Date.now() &&
      Date.now() - cached.time < cacheLifetime
    ) {
      contributors.value = visibleContributors(
        parseContributors(cached.people),
      );
      return;
    }
  } catch { /* Storage may be unavailable or contain an old/invalid value. */ }
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const people = await fetchContributors({ signal: controller.signal });
    if (controller.signal.aborted) return;
    contributors.value = people;
    try {
      localStorage.setItem(
        cacheKey,
        JSON.stringify({ time: Date.now(), people }),
      );
    } catch { /* The refreshed list still works without persistent storage. */ }
  } catch {
    /* Keep the statically rendered list on network/API failures. */
  } finally {
    clearTimeout(timer);
  }
});
</script>

<template>
  <main class="team-page">
    <header class="team-intro">
      <p class="eyebrow">The people behind Fedify</p>
      <h1>Meet the team.</h1>
      <p
        class="lede">We build and maintain Fedify, a TypeScript library for bringing applications into the fediverse.</p>
    </header>
    <section aria-labelledby="maintainers-heading">
      <div class="section-heading">
        <h2 id="maintainers-heading">Maintainers</h2>
        <p>The people who maintain Fedify day to day.</p>
      </div>
      <TeamMembers />
    </section>
    <section class="contributors" aria-labelledby="contributors-heading">
      <div class="section-heading">
        <h2 id="contributors-heading">Contributors</h2>
        <p>Thank you to everyone who has contributed to the Fedify repository.</p>
      </div>
      <ul class="contributor-grid">
        <li v-for="person in contributors" :key="person.id">
          <a :href="`https://github.com/${person.login}`"
            :aria-label="`${person.login} on GitHub`">
            <img
              :src="`https://avatars.githubusercontent.com/u/${person.id}?s=96`"
              alt="" width="48" height="48" loading="lazy" />
            <span>{{ person.login }}</span>
          </a>
        </li>
      </ul>
      <p
        class="thanks">Thank you also to everyone who reports bugs, reviews changes, shares ideas, and helps others in the community.</p>
      <a class="contribute-link"
        :href="withBase('/contribute')">Find out how to contribute <span aria-hidden="true">→</span></a>
    </section>
  </main>
</template>

<style scoped>
.team-page {
  max-width: 1152px;
  margin: 0 auto;
  padding: 80px 24px 96px;
}
.team-intro {
  max-width: 720px;
  margin-bottom: 72px;
}
.eyebrow {
  color: var(--vp-c-brand-1);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  letter-spacing: .1em;
  text-transform: uppercase;
  margin-bottom: 20px;
}
h1,
h2 {
  font-family: var(--vp-font-family-display);
  font-weight: 600;
}
h1 {
  font-size: clamp(44px, 6vw, 68px);
  line-height: 1.1;
  letter-spacing: -.025em;
}
.lede {
  font-size: 20px;
  line-height: 1.65;
  color: var(--vp-c-text-2);
  margin-top: 24px;
}
.section-heading {
  margin-bottom: 28px;
}
h2 {
  font-size: 32px;
  line-height: 1.3;
  margin-bottom: 12px;
}
.section-heading p,
.thanks {
  color: var(--vp-c-text-2);
  line-height: 1.75;
}
.contributors {
  margin-top: 80px;
  padding-top: 48px;
  border-top: 1px solid var(--vp-c-divider);
}
.contributor-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 24px 16px;
  list-style: none;
  padding: 0;
}
.contributor-grid a {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--vp-c-text-2);
  font-size: 12px;
}
.contributor-grid a:hover {
  color: var(--vp-c-brand-1);
}
.contributor-grid img {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--vp-c-bg-soft);
  flex-shrink: 0;
}
.contributor-grid span {
  overflow-wrap: anywhere;
  min-width: 0;
}
.thanks {
  margin-top: 36px;
  max-width: 720px;
}
.contribute-link {
  display: inline-block;
  margin-top: 16px;
  color: var(--vp-c-brand-1);
  font-weight: 500;
}
.contribute-link:hover {
  text-decoration: underline;
  text-underline-offset: 4px;
}
@media (max-width: 767px) {
  .team-page {
    padding-top: 48px;
    padding-bottom: 64px;
  }
  .team-intro {
    margin-bottom: 48px;
  }
  .lede {
    font-size: 18px;
  }
  .contributors {
    margin-top: 48px;
    padding-top: 32px;
  }
}
</style>
