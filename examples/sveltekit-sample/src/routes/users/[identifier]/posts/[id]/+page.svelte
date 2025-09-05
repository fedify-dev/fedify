<script lang="ts">
  import type { PageProps } from "./$types";

  let { params, data }: PageProps = $props();
  const { identifier } = params;
  const { user, post } = data;
</script>

<div class="post-detail-container">
  <article class="post-detail-card">
    <a class="post-detail-author" href={`/users/${identifier}`}>
      <img
        src={user.icon?.url ?? "/demo-profile.png"}
        alt="{user.name}'s profile"
        class="author-avatar"
      />
      <div class="author-info">
        <h1 class="author-name">{user.name}</h1>
        <p class="author-handle">
          @{user.preferredUsername}@{new URL(user.url).host}
        </p>
        {#if post.published}
          <time class="post-timestamp" datetime={post.published}>
            {new Date(post.published).toLocaleString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        {/if}
      </div>
    </a>

    <div class="post-detail-content">
      <p>{post.content}</p>
    </div>
  </article>
</div>
