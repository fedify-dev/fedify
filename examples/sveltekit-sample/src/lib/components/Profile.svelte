<script lang="ts">
  import type { User } from "$lib/types";

  let { user }: { user: User } = $props();
</script>

<div class="profile-header">
  <div class="avatar-section">
    <img
      src={user.icon?.url ?? "/demo-profile.png"}
      alt="{user.name}'s profile"
      class="avatar"
    />
  </div>
  <div class="user-info">
    <h1 class="user-name">{user.name}</h1>
    <p class="user-handle">
      @{user.preferredUsername}@{new URL(user.url).host}
    </p>
    {#if user.summary}
      <p class="user-bio">{user.summary}</p>
    {/if}
  </div>
</div>
