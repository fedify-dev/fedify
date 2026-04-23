<script setup lang="ts">
import { useRoute } from "vitepress";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const copied = ref(false);
const copyFailed = ref<"load" | "clipboard" | null>(null);
const targetReady = ref(false);
const isDev = import.meta.env.DEV;
const devMessage =
  "Markdown actions are not available in the VitePress dev server. Please use the built docs instead.";
const route = useRoute();
let copiedResetTimeout: number | null = null;
let copyFailedResetTimeout: number | null = null;
let currentWrapper: HTMLElement | null = null;
let currentTarget: HTMLElement | null = null;
let targetUpdateVersion = 0;

const markdownPath = computed(() => {
  let path = route.path.replace(/\.html$/, "");
  if (path === "/") return "/index.md";
  if (path.endsWith("/")) return `${path}index.md`;
  return `${path.replace(/\/+$/, "")}.md`;
});

function cleanupTarget(): void {
  if (
    currentWrapper == null ||
    currentTarget == null ||
    currentWrapper.parentNode == null
  ) {
    currentWrapper = null;
    currentTarget = null;
    return;
  }

  const heading = currentWrapper.querySelector(":scope > h1");
  if (heading instanceof HTMLElement) {
    currentWrapper.parentNode.insertBefore(heading, currentWrapper);
  }
  currentWrapper.remove();
  currentWrapper = null;
  currentTarget = null;
}

function ensureTarget(heading: Element | null): void {
  const h1 = heading;
  if (!(h1 instanceof HTMLElement)) {
    targetReady.value = false;
    return;
  }

  const existingWrapper = h1.parentElement;
  if (existingWrapper?.classList.contains("page-title-row")) {
    currentWrapper = existingWrapper;
    currentTarget = existingWrapper.querySelector(".page-title-actions-target");
    targetReady.value = currentTarget != null;
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "page-title-row";
  const target = document.createElement("div");
  target.className = "page-title-actions-target";

  h1.parentNode?.insertBefore(wrapper, h1);
  wrapper.appendChild(h1);
  wrapper.appendChild(target);
  currentWrapper = wrapper;
  currentTarget = target;
  targetReady.value = true;
}

function waitForHeading(maxFrames = 8): Promise<Element | null> {
  return new Promise((resolve) => {
    let frame = 0;

    const check = () => {
      const heading = document.querySelector(".vp-doc h1");
      if (heading != null || frame >= maxFrames) {
        resolve(heading);
        return;
      }
      frame++;
      window.requestAnimationFrame(check);
    };

    check();
  });
}

async function updateTarget(): Promise<void> {
  const version = ++targetUpdateVersion;
  targetReady.value = false;
  copied.value = false;
  copyFailed.value = null;
  cleanupTarget();
  await nextTick();
  const heading = await waitForHeading();
  if (version !== targetUpdateVersion) return;
  ensureTarget(heading);
}

onMounted(() => {
  void updateTarget();
  watch(() => route.path, updateTarget);
});

onBeforeUnmount(() => {
  targetUpdateVersion++;
  targetReady.value = false;
  cleanupTarget();
  if (copiedResetTimeout != null) window.clearTimeout(copiedResetTimeout);
  if (copyFailedResetTimeout != null) window.clearTimeout(copyFailedResetTimeout);
});

function closeMenu(target: EventTarget | HTMLElement | null): void {
  const details = (target as HTMLElement | null)?.closest("details");
  if (details instanceof HTMLDetailsElement) details.open = false;
}

function resetCopiedState(delay: number): void {
  if (copiedResetTimeout != null) window.clearTimeout(copiedResetTimeout);
  copiedResetTimeout = window.setTimeout(() => {
    copied.value = false;
    copiedResetTimeout = null;
  }, delay);
}

function resetCopyFailedState(delay: number): void {
  if (copyFailedResetTimeout != null) window.clearTimeout(copyFailedResetTimeout);
  copyFailedResetTimeout = window.setTimeout(() => {
    copyFailed.value = null;
    copyFailedResetTimeout = null;
  }, delay);
}

async function getMarkdown(): Promise<string> {
  const response = await fetch(markdownPath.value);
  if (!response.ok) {
    throw new Error(`Failed to load ${markdownPath.value}: ${response.status}`);
  }
  return await response.text();
}

async function copyMarkdown(event: MouseEvent): Promise<void> {
  const trigger = event.currentTarget as HTMLElement | null;
  const version = targetUpdateVersion;
  if (isDev) {
    closeMenu(trigger);
    window.alert(devMessage);
    return;
  }
  try {
    const text = await getMarkdown();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      if (version !== targetUpdateVersion) return;
      copied.value = false;
      copyFailed.value = "clipboard";
      if (copiedResetTimeout != null) {
        window.clearTimeout(copiedResetTimeout);
        copiedResetTimeout = null;
      }
      resetCopyFailedState(2500);
      return;
    }
    if (version !== targetUpdateVersion) return;
    copied.value = true;
    copyFailed.value = null;
    if (copyFailedResetTimeout != null) {
      window.clearTimeout(copyFailedResetTimeout);
      copyFailedResetTimeout = null;
    }
    resetCopiedState(2000);
    closeMenu(trigger);
  } catch {
    if (version !== targetUpdateVersion) return;
    copied.value = false;
    copyFailed.value = "load";
    if (copiedResetTimeout != null) {
      window.clearTimeout(copiedResetTimeout);
      copiedResetTimeout = null;
    }
    resetCopyFailedState(2500);
  }
}

function viewMarkdown(event: MouseEvent): void {
  closeMenu(event.currentTarget);
  if (!isDev) return;
  event.preventDefault();
  window.alert(devMessage);
}
</script>

<template>
  <Teleport v-if="targetReady" to=".page-title-actions-target">
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
          {{
            copied
              ? "Copied"
              : copyFailed === "load"
              ? "Could not load Markdown"
              : copyFailed === "clipboard"
              ? "Clipboard blocked"
              : "Copy Markdown"
          }}
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
