<script lang="ts">
  import Profile from "$lib/components/Profile.svelte";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
  const { user } = data;
</script>

<div class="profile-container">
  <Profile {user} />

  <div class="profile-content">
    <div class="info-card">
      <h3>Profile Information</h3>
      <div class="info-grid">
        <div class="info-item">
          <span class="info-label">Information</span>
          <span class="info-value"
            >This profile is demo for
            <a href="https://fedify.dev" class="fedify-anchor" target="_blank">
              Fedify
            </a>–<a href="https://svelte.dev/">
              <img
                src="/svelte-horizontal.svg"
                alt="Svelte"
                class="inline-block h-5"
              />
            </a> integration.
          </span>
        </div>
      </div>
    </div>
  </div>
</div>
