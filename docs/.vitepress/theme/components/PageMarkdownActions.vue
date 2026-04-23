<script setup lang="ts">
import { useRoute } from "vitepress";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { Teleport } from "vue";

const copied = ref(false);
const copyFailed = ref(false);
const path = ref<string | null>(null);
const targetReady = ref(false);
const isDev = import.meta.env.DEV;
const devMessage =
  "Markdown actions are not available in the VitePress dev server. Please use the built docs instead.";
const route = useRoute();

onMounted(() => {
  const { pathname } = window.location;
  path.value = pathname === "/"
    ? "/index.md"
    : `${pathname.replace(/\/+$/, "").replace(/\.html$/, "")}.md`;
});

function ensureTarget(): void {
  const h1 = document.querySelector(".vp-doc h1");
  if (!(h1 instanceof HTMLElement)) {
    targetReady.value = false;
    return;
  }

  const existingWrapper = h1.parentElement;
  if (existingWrapper?.classList.contains("page-title-row")) {
    targetReady.value = existingWrapper.querySelector(".page-title-actions-target") != null;
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "page-title-row";
  const target = document.createElement("div");
  target.className = "page-title-actions-target";

  h1.parentNode?.insertBefore(wrapper, h1);
  wrapper.appendChild(h1);
  wrapper.appendChild(target);
  targetReady.value = true;
}

watch(
  () => route.path,
  async () => {
    targetReady.value = false;
    await nextTick();
    ensureTarget();
  },
  { immediate: true },
);

const markdownPath = computed(() => path.value);

async function getMarkdown(): Promise<string> {
  if (markdownPath.value == null) {
    throw new Error("Markdown path is not available yet.");
  }
  const response = await fetch(markdownPath.value);
  if (!response.ok) {
    throw new Error(`Failed to load ${markdownPath.value}: ${response.status}`);
  }
  return await response.text();
}

async function copyMarkdown(): Promise<void> {
  if (isDev) {
    window.alert(devMessage);
    return;
  }
  try {
    const text = await getMarkdown();
    await navigator.clipboard.writeText(text);
    copied.value = true;
    copyFailed.value = false;
    window.setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    copyFailed.value = true;
    window.setTimeout(() => {
      copyFailed.value = false;
    }, 2500);
  }
}

function viewMarkdown(event: MouseEvent): void {
  if (!isDev) return;
  event.preventDefault();
  window.alert(devMessage);
}
</script>

<template>
  <Teleport v-if="markdownPath != null && targetReady" to=".page-title-actions-target">
    <details class="page-markdown-actions__menu">
      <summary class="page-markdown-actions__trigger">
        <span>Markdown</span>
        <svg
          class="page-markdown-actions__chevron"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4 6.5 8 10l4-3.5"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.6"
          />
        </svg>
      </summary>
      <div class="page-markdown-actions__dropdown">
        <a
          class="page-markdown-actions__item"
          :href="markdownPath"
          target="_blank"
          rel="noreferrer"
          @click="viewMarkdown"
        >
          View as Markdown
        </a>
        <button class="page-markdown-actions__item" type="button" @click="copyMarkdown">
          {{ copied ? "Copied" : copyFailed ? "Copy failed" : "Copy Markdown" }}
        </button>
      </div>
    </details>
  </Teleport>
</template>

<style scoped>
.page-markdown-actions__menu {
  position: relative;
}

.page-markdown-actions__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: color-mix(in srgb, var(--vp-c-bg-soft) 72%, transparent);
  color: var(--vp-c-text-1);
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.2;
  list-style: none;
  gap: 0.45rem;
  min-height: 2.1rem;
  padding: 0.45rem 0.85rem;
  cursor: pointer;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.04);
  transition:
    border-color 0.2s ease,
    background-color 0.2s ease,
    color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
}

.page-markdown-actions__trigger::-webkit-details-marker {
  display: none;
}

.page-markdown-actions__trigger:hover,
.page-markdown-actions__menu[open] > .page-markdown-actions__trigger {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-bg);
  color: var(--vp-c-brand-1);
  box-shadow: 0 8px 20px rgb(0 0 0 / 0.08);
}

.page-markdown-actions__chevron {
  flex: none;
  width: 0.95rem;
  height: 0.95rem;
  margin-right: -0.05rem;
  transition: transform 0.2s ease;
}

.page-markdown-actions__menu[open] .page-markdown-actions__chevron {
  transform: rotate(180deg);
}

.page-markdown-actions__dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 20;
  min-width: 13rem;
  padding: 0.35rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.75rem;
  background: var(--vp-c-bg);
  box-shadow: var(--vp-shadow-3);
}

.page-markdown-actions__item {
  display: flex;
  width: 100%;
  align-items: center;
  border: 0;
  border-radius: 0.5rem;
  background: transparent;
  color: var(--vp-c-text-1);
  font: inherit;
  font-size: 0.875rem;
  line-height: 1.3;
  padding: 0.55rem 0.7rem;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}

.page-markdown-actions__item:hover {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-brand-1);
}
</style>
