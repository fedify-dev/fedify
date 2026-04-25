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

const OWNER = "alice";
const PAGE_SIZE = 2;

const PUBLIC_BOOKMARKS = "public-bookmarks";
const TAGGED_BOOKMARKS = "tagged-bookmarks";
const FOLLOWERS_ONLY_BOOKMARKS = "followers-only-bookmarks";

interface Bookmark {
  id: string;
  title: string;
  href: string;
  note: string;
  tags: string[];
  visibility: "public" | "followers";
  savedAt: Temporal.Instant;
}

const bookmarks: Bookmark[] = [
  {
    id: "fedify-manual",
    title: "Fedify manual",
    href: "https://fedify.dev/manual/",
    note: "Reference material for building ActivityPub servers with Fedify.",
    tags: ["fedify", "activitypub"],
    visibility: "public",
    savedAt: Temporal.Instant.from("2026-04-20T09:00:00Z"),
  },
  {
    id: "activitypub-spec",
    title: "ActivityPub specification",
    href: "https://www.w3.org/TR/activitypub/",
    note: "The W3C ActivityPub recommendation.",
    tags: ["activitypub", "spec"],
    visibility: "public",
    savedAt: Temporal.Instant.from("2026-04-19T12:00:00Z"),
  },
  {
    id: "uri-template",
    title: "URI Template",
    href: "https://www.rfc-editor.org/rfc/rfc6570",
    note: "How Fedify dispatcher path parameters are expanded.",
    tags: ["spec", "routing"],
    visibility: "public",
    savedAt: Temporal.Instant.from("2026-04-18T16:30:00Z"),
  },
  {
    id: "private-reading-list",
    title: "Private reading list",
    href: "https://example.net/reading-list",
    note: "A bookmark visible only to accepted followers.",
    tags: ["fedify", "reading"],
    visibility: "followers",
    savedAt: Temporal.Instant.from("2026-04-17T08:15:00Z"),
  },
  {
    id: "moderation-notes",
    title: "Moderation notes",
    href: "https://example.net/moderation",
    note: "Follower-facing notes for a small community server.",
    tags: ["activitypub", "moderation"],
    visibility: "followers",
    savedAt: Temporal.Instant.from("2026-04-16T10:45:00Z"),
  },
];

export const followerIds = new Set(
  [
    "https://remote.example/users/bob",
    "https://social.example/users/carol",
  ].map(normalizeActorId),
);

export const federation = createFederation<void>({
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

function publicBookmarks(): Bookmark[] {
  return sortBookmarks(
    bookmarks.filter((bookmark) => bookmark.visibility === "public"),
  );
}

function followersOnlyBookmarks(): Bookmark[] {
  return sortBookmarks(
    bookmarks.filter((bookmark) => bookmark.visibility === "followers"),
  );
}

function taggedBookmarks(tag: string): Bookmark[] {
  const normalizedTag = normalizeTag(tag);
  return sortBookmarks(
    bookmarks.filter((bookmark) =>
      bookmark.visibility === "public" &&
      bookmark.tags.some((itemTag) => normalizeTag(itemTag) === normalizedTag)
    ),
  );
}

function sortBookmarks(items: Bookmark[]): Bookmark[] {
  return items.toSorted((a, b) =>
    Temporal.Instant.compare(b.savedAt, a.savedAt)
  );
}

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
    summary: escapeHtml(bookmark.note),
    content: `<p><a href="${escapeHtml(bookmarkUrl.href)}">${
      escapeHtml(bookmark.title)
    }</a></p>`,
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

function firstCursor(items: Bookmark[]): string | null {
  return items.length < 1 ? null : "0";
}

function lastCursor(items: Bookmark[]): string | null {
  if (items.length < 1) return null;
  return String(Math.floor((items.length - 1) / PAGE_SIZE) * PAGE_SIZE);
}

function parseCursor(cursor: string): number | null {
  const offset = Number(cursor);
  return Number.isSafeInteger(offset) && offset >= 0 && offset % PAGE_SIZE === 0
    ? offset
    : null;
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

function normalizeActorId(id: string | URL): string {
  return new URL(id).href;
}

async function fetchActivityJson(path: string): Promise<unknown> {
  const response = await federation.fetch(
    new Request(new URL(path, "https://example.com"), {
      headers: { Accept: "application/activity+json" },
    }),
    { contextData: undefined },
  );

  if (!response.ok) {
    throw new Error(`${path}: ${response.status} ${await response.text()}`);
  }
  return await response.json();
}

async function fetchStatus(path: string): Promise<number> {
  const response = await federation.fetch(
    new Request(new URL(path, "https://example.com"), {
      headers: { Accept: "application/activity+json" },
    }),
    { contextData: undefined },
  );

  return response.status;
}

async function printActivityJson(label: string, path: string): Promise<void> {
  console.log(`\n## ${label}`);
  console.log(JSON.stringify(await fetchActivityJson(path), null, 2));
}

async function printActivityStatus(
  label: string,
  path: string,
): Promise<void> {
  console.log(`\n## ${label}`);
  console.log(await fetchStatus(path));
}

if (import.meta.main) {
  await printActivityJson("Actor with custom collection links", "/users/alice");
  await printActivityJson(
    "Public bookmarks collection",
    "/users/alice/collections/public",
  );
  await printActivityJson(
    "Public bookmarks first page",
    "/users/alice/collections/public?cursor=0",
  );
  await printActivityJson(
    "Tag-filtered ActivityPub bookmarks collection",
    "/users/alice/collections/tags/activitypub",
  );
  await printActivityJson(
    "Tag-filtered ActivityPub bookmarks first page",
    "/users/alice/collections/tags/activitypub?cursor=0",
  );
  await printActivityStatus(
    "Followers-only collection requested without a signature",
    "/users/alice/collections/followers-only",
  );
  await printActivityStatus(
    "Followers-only first page requested without a signature",
    "/users/alice/collections/followers-only?cursor=0",
  );
}
