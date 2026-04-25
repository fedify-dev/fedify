import {
  createFederation,
  MemoryKvStore,
  type RequestContext,
} from "@fedify/fedify";
import {
  Article,
  Hashtag,
  Person,
  PUBLIC_COLLECTION,
  type Recipient,
} from "@fedify/vocab";
import {
  type Bookmark,
  firstCursor,
  followerIds,
  followersOnlyBookmarks,
  lastCursor,
  normalizeActorId,
  normalizeTag,
  OWNER,
  PAGE_SIZE,
  parseCursor,
  publicBookmarks,
  taggedBookmarks,
} from "./lib.ts";

const PUBLIC_BOOKMARKS = "public-bookmarks";
const TAGGED_BOOKMARKS = "tagged-bookmarks";
const FOLLOWERS_ONLY_BOOKMARKS = "followers-only-bookmarks";

const federation = createFederation<void>({
  kv: new MemoryKvStore(),
});

federation
  .setActorDispatcher("/users/{identifier}", (ctx, identifier) => {
    if (identifier !== OWNER) return null;

    // inbox/outbox are omitted here; use setInboxListeners() and
    // setOutboxDispatcher() for full ActivityPub actors.
    return new Person({
      id: ctx.getActorUri(identifier),
      preferredUsername: identifier,
      name: "Alice's bookmarks",
      summary: "A single-user bookmark log with custom collection examples.",
      url: new URL(`/users/${identifier}`, ctx.url),
      followers: ctx.getFollowersUri(identifier),
      streams: [
        ctx.getCollectionUri(PUBLIC_BOOKMARKS, { identifier }),
        ctx.getCollectionUri(TAGGED_BOOKMARKS, {
          identifier,
          tag: "activitypub",
        }),
        ctx.getCollectionUri(FOLLOWERS_ONLY_BOOKMARKS, { identifier }),
      ],
    });
  });

federation.setFollowersDispatcher(
  "/users/{identifier}/followers",
  (_ctx, identifier) => {
    if (identifier !== OWNER) return null;

    // For large follower lists, add counters and cursor callbacks as below.
    const items: Recipient[] = Array.from(followerIds, (id) => {
      const actorId = new URL(id);
      return {
        id: actorId,
        inboxId: new URL(`${actorId.pathname}/inbox`, actorId),
      };
    });
    return { items };
  },
);

federation
  .setOrderedCollectionDispatcher(
    PUBLIC_BOOKMARKS,
    Article,
    "/users/{identifier}/collections/public",
    (ctx, values, cursor) => {
      if (values.identifier !== OWNER) return null;

      return collectionBookmarks(
        ctx,
        publicBookmarks(),
        cursor,
      );
    },
  )
  .setCounter((_ctx, values) => {
    if (values.identifier !== OWNER) return null;
    return publicBookmarks().length;
  })
  .setFirstCursor((_ctx, values) => {
    if (values.identifier !== OWNER) return null;
    return firstCursor(publicBookmarks());
  })
  .setLastCursor((_ctx, values) => {
    if (values.identifier !== OWNER) return null;
    return lastCursor(publicBookmarks());
  });

federation
  .setOrderedCollectionDispatcher(
    TAGGED_BOOKMARKS,
    Article,
    "/users/{identifier}/collections/tags/{tag}",
    (ctx, values, cursor) => {
      if (values.identifier !== OWNER) return null;

      return collectionBookmarks(
        ctx,
        taggedBookmarks(values.tag),
        cursor,
      );
    },
  )
  .setCounter((_ctx, values) => {
    if (values.identifier !== OWNER) return null;
    return taggedBookmarks(values.tag).length;
  })
  .setFirstCursor((_ctx, values) => {
    if (values.identifier !== OWNER) return null;
    return firstCursor(taggedBookmarks(values.tag));
  })
  .setLastCursor((_ctx, values) => {
    if (values.identifier !== OWNER) return null;
    return lastCursor(taggedBookmarks(values.tag));
  });

federation
  .setOrderedCollectionDispatcher(
    FOLLOWERS_ONLY_BOOKMARKS,
    Article,
    "/users/{identifier}/collections/followers-only",
    (ctx, values, cursor) => {
      if (values.identifier !== OWNER) return null;

      return collectionBookmarks(
        ctx,
        followersOnlyBookmarks(),
        cursor,
      );
    },
  )
  .setCounter((_ctx, values) => {
    if (values.identifier !== OWNER) return null;
    return followersOnlyBookmarks().length;
  })
  .setFirstCursor((_ctx, values) => {
    if (values.identifier !== OWNER) return null;
    return firstCursor(followersOnlyBookmarks());
  })
  .setLastCursor((_ctx, values) => {
    if (values.identifier !== OWNER) return null;
    return lastCursor(followersOnlyBookmarks());
  })
  .authorize(async (ctx, values) => {
    if (values.identifier !== OWNER) return true;
    return await isFollowerRequest(ctx);
  });

function collectionBookmarks(
  ctx: RequestContext<void>,
  items: Bookmark[],
  cursor: string | null,
): {
  items: Article[];
  nextCursor: string | null;
  prevCursor: string | null;
} {
  return cursor == null
    ? {
      items: items.map((bookmark) => toArticle(ctx, bookmark)),
      nextCursor: null,
      prevCursor: null,
    }
    : pageBookmarks(ctx, items, cursor);
}

function pageBookmarks(
  ctx: RequestContext<void>,
  items: Bookmark[],
  cursor: string,
): {
  items: Article[];
  nextCursor: string | null;
  prevCursor: string | null;
} {
  const offset = parseCursor(cursor);
  if (offset == null || offset >= Math.max(items.length, 1)) {
    return { items: [], nextCursor: null, prevCursor: null };
  }

  return {
    items: items
      .slice(offset, offset + PAGE_SIZE)
      .map((bookmark) => toArticle(ctx, bookmark)),
    nextCursor: offset + PAGE_SIZE < items.length
      ? String(offset + PAGE_SIZE)
      : null,
    prevCursor: offset > 0 ? String(Math.max(0, offset - PAGE_SIZE)) : null,
  };
}

function toArticle(ctx: RequestContext<void>, bookmark: Bookmark): Article {
  const bookmarkUrl = new URL(bookmark.href);
  return new Article({
    id: new URL(`/users/${OWNER}/bookmarks/${bookmark.id}`, ctx.url),
    attribution: ctx.getActorUri(OWNER),
    name: bookmark.title,
    summary: bookmark.note,
    content: `<p><a href="${escapeHtml(bookmarkUrl.href)}">${
      escapeHtml(bookmark.title)
    }</a></p>`,
    mediaType: "text/html",
    url: bookmarkUrl,
    published: bookmark.savedAt,
    to: bookmark.visibility === "public"
      ? PUBLIC_COLLECTION
      : ctx.getFollowersUri(OWNER),
    tags: bookmark.tags.map((tag) =>
      new Hashtag({
        href: ctx.getCollectionUri(TAGGED_BOOKMARKS, {
          identifier: OWNER,
          tag: normalizeTag(tag),
        }),
        name: `#${tag}`,
      })
    ),
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function isFollowerRequest(ctx: RequestContext<void>): Promise<boolean> {
  const signedKeyOwner = await ctx.getSignedKeyOwner();
  return signedKeyOwner?.id == null
    ? false
    : followerIds.has(normalizeActorId(signedKeyOwner.id));
}

export default federation;
