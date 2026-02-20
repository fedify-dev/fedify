import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { Note } from "@fedify/vocab";

// Mock data - in a real application, this would query your database
const POSTS = [
  new Note({
    id: new URL("https://example.com/posts/post-1"),
    content: "ActivityPub is a decentralized social networking protocol...",
    tags: [
      new URL("https://example.com/tags/ActivityPub"),
      new URL("https://example.com/tags/Decentralization"),
    ],
  }),

  new Note({
    id: new URL("https://example.com/posts/post-2"),
    content: "Fedify makes it easy to build federated applications...",
  }),

  new Note({
    id: new URL("https://example.com/posts/post-3"),
    content: "WebFinger is a protocol for discovering information...",
    tags: [new URL("https://example.com/tags/ActivityPub")],
  }),

  new Note({
    id: new URL("https://example.com/posts/post-4"),
    content: "HTTP Signatures provide authentication for ActivityPub...",
  }),

  new Note({
    id: new URL("https://example.com/posts/post-5"),
    content: "Understanding ActivityPub's data model is crucial...",
  }),
];

function getTagFromUrl(url: string): string {
  const parts = url.split("/");
  return parts[parts.length - 1];
}

function getTaggedPostsByTag(tag: string): Note[] {
  return POSTS
    .filter((post) => {
      if (!post.tagIds) {
        return false;
      }
      return post.tagIds.some((tagId) => {
        return getTagFromUrl(tagId.toString()) === tag;
      });
    });
}

async function demonstrateCustomCollection(): Promise<Response> {
  // Federation instance created for demonstration
  const federation = createFederation<void>({ kv: new MemoryKvStore() });

  federation.setCollectionDispatcher(
    "TaggedPosts",
    Note,
    "/users/{userId}/tags/{tag}",
    (
      _ctx: { url: URL },
      values: Record<string, string>,
      cursor: string | null,
    ) => {
      if (!values.tag) {
        throw new Error("Missing userId or tag in values");
      }

      // Normally here you would look up posts from a database by user ID and tag name:
      const posts = getTaggedPostsByTag(values.tag);

      if (cursor != null) {
        const idx = Number.parseInt(cursor, 10);
        if (Number.isNaN(idx) || idx > posts.length || idx < 0) {
          return { items: [], nextCursor: null, prevCursor: null };
        }
        return {
          items: idx < posts.length ? [posts[idx]] : [],
          nextCursor: idx < posts.length - 1 ? (idx + 1).toString() : null,
          prevCursor: idx > 0 ? (idx - 1).toString() : null,
        };
      }
      return { items: posts, nextCursor: null, prevCursor: null };
    },
  ).setCounter((_ctx, values) => {
    // Return the total count of tagged posts
    const count = getTaggedPostsByTag(values.tag).length;
    return count;
  });

  return await federation.fetch(
    new Request(
      "https://example.com/users/123/tags/ActivityPub",
      {
        headers: {
          Accept: "application/activity+json",
        },
      },
    ),
    {
      contextData: undefined,
    },
  );
}

if (import.meta.main) {
  const response = await demonstrateCustomCollection();

  if (response.ok) {
    const jsonResponse = await response.json();
    console.log("Custom collection data:", jsonResponse);
  } else {
    const errorText = await response.text();
    console.log("Error response:", errorText);
  }
}
