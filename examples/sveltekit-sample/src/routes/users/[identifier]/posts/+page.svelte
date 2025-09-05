<script lang="ts">
  import Profile from "$lib/components/Profile.svelte";
  import type { PageProps } from "./$types";

  let { params, data }: PageProps = $props();
  const { identifier } = params;
  const { user, posts } = data;
</script>

<form method="POST" action="?/post" class="post-form">
  <Profile {user} />
  <input name="identifier" type="hidden" value={identifier} />
  <div class="form-group">
    <label class="form-label">
      New post
      <textarea
        name="content"
        class="form-textarea"
        placeholder="What's up?"
        rows="3"
      ></textarea>
    </label>
  </div>
  <button type="submit" class="post-button">Post</button>
</form>

<div class="posts-container">
  <h2 class="posts-title">Posts</h2>
  <div class="posts-grid">
    {#each posts as note}
      <article class="post-card">
        <a href={note.url} class="post-link">
          <div class="post-header">
            <img
              src={note.author.icon?.url ?? "/demo-profile.png"}
              alt="{note.author.name}'s profile"
              class="post-avatar"
            />
            <div class="post-user-info">
              <h3 class="post-user-name">{note.author.name}</h3>
              <p class="post-user-handle">
                @{identifier}@{new URL(user.url).host}
              </p>
            </div>
          </div>
          <div class="post-content">
            <p>{note.content}</p>
          </div>
        </a>
      </article>
    {/each}
  </div>
</div>
