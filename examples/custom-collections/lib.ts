export const OWNER = "alice";
export const PAGE_SIZE = 2;

export interface Bookmark {
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

export function publicBookmarks(): Bookmark[] {
  return sortBookmarks(
    bookmarks.filter((bookmark) => bookmark.visibility === "public"),
  );
}

export function followersOnlyBookmarks(): Bookmark[] {
  return sortBookmarks(
    bookmarks.filter((bookmark) => bookmark.visibility === "followers"),
  );
}

export function taggedBookmarks(tag: string): Bookmark[] {
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

export function firstCursor(items: Bookmark[]): string | null {
  return items.length < 1 ? null : "0";
}

export function lastCursor(items: Bookmark[]): string | null {
  if (items.length < 1) return null;
  return String(Math.floor((items.length - 1) / PAGE_SIZE) * PAGE_SIZE);
}

export function parseCursor(cursor: string): number | null {
  const offset = Number(cursor);
  return Number.isSafeInteger(offset) && offset >= 0 && offset % PAGE_SIZE === 0
    ? offset
    : null;
}

export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

export function normalizeActorId(id: string | URL): string {
  return new URL(id).href;
}
