<script setup lang="ts">
import { withBase } from "vitepress";
import { Globe } from "@lucide/vue";
import { maintainers } from "../../team.mts";

defineProps<{ compact?: boolean }>();
</script>

<template>
  <ul class="team-members" :class="{ compact }">
    <li v-for="member in maintainers" :key="member.id" class="member">
      <img :src="withBase(member.photo)" alt="" width="160" height="160"
        loading="lazy" />
      <div class="member-info">
        <h3>{{ member.name }} <span lang="ko">{{ member.nativeName }}</span></h3>
        <p class="since">Contributing since {{ member.since }}</p>
        <div v-if="compact" class="profile-icons">
          <a :href="member.website"
            :aria-label="`${member.name}'s website`" title="Website">
            <Globe :size="16" aria-hidden="true" />
          </a>
          <a :href="`https://github.com/${member.github}`"
            :aria-label="`${member.name} on GitHub`" title="GitHub">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"
              aria-hidden="true">
              <path
                d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
          </a>
          <a :href="member.fediverse"
            :aria-label="`${member.name} on ${member.fediverseService}: ${member.handle}`"
            :title="`${member.fediverseService}: ${member.handle}`">
            <span class="service-icon"
              :style="{ '--profile-icon': `url('${withBase(member.fediverseIcon)}')` }"
              aria-hidden="true" />
          </a>
        </div>
        <template v-if="!compact">
          <a class="fediverse" :href="member.fediverse">{{ member.handle }}</a>
          <div class="member-links">
            <a
              :href="member.website">Website <span aria-hidden="true">↗︎</span></a>
            <a
              :href="`https://github.com/${member.github}`">GitHub <span aria-hidden="true">↗︎</span></a>
          </div>
        </template>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.team-members {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 40px;
  list-style: none;
  padding: 0;
  margin: 0;
}
.member {
  min-width: 0;
  padding-top: 28px;
  border-top: 1px solid var(--vp-c-divider);
}
.member img {
  width: 112px;
  height: 112px;
  object-fit: cover;
  border-radius: 50%;
  margin-bottom: 24px;
}
h3 {
  margin: 0;
  font-family: var(--vp-font-family-display);
  font-size: 25px;
  line-height: 1.35;
  font-weight: 600;
}
h3 span {
  display: block;
  margin-top: 6px;
  font-family: var(--vp-font-family-base);
  font-size: 16px;
  font-weight: 400;
  color: var(--vp-c-text-2);
}
.since {
  margin: 16px 0 12px;
  color: var(--vp-c-text-2);
  font-size: 14px;
}
a {
  color: var(--vp-c-brand-1);
  text-underline-offset: 4px;
}
a:hover {
  text-decoration: underline;
}
.fediverse {
  font-size: 13px;
  overflow-wrap: anywhere;
}
.member-links {
  display: flex;
  gap: 20px;
  margin-top: 14px;
  font-size: 14px;
}
.compact {
  gap: 32px;
}
.compact .member {
  display: flex;
  gap: 16px;
  padding-top: 24px;
  align-items: flex-start;
}
.compact .member img {
  width: 56px;
  height: 56px;
  margin: 0;
}
.compact h3 {
  font-size: 19px;
}
.compact h3 span {
  font-size: 14px;
  margin-top: 2px;
}
.compact .since {
  font-size: 12px;
  margin: 6px 0 0;
}
.profile-icons {
  display: flex;
  gap: 4px;
  margin-top: 8px;
  margin-left: -6px;
}
.profile-icons a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  color: var(--vp-c-text-2);
}
.profile-icons a:hover,
.profile-icons a:focus-visible {
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}
.service-icon {
  display: block;
  width: 16px;
  height: 16px;
  background-color: currentColor;
  mask: var(--profile-icon) center / contain no-repeat;
}
.profile-icons a:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}
@media (max-width: 767px) {
  .team-members {
    grid-template-columns: 1fr;
    gap: 28px;
  }
  .member {
    display: flex;
    gap: 24px;
  }
  .member img {
    width: 80px;
    height: 80px;
  }
  h3 {
    font-size: 24px;
  }
  .member-info {
    min-width: 0;
  }
}
</style>
