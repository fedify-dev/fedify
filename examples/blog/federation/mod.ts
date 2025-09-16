import { createFederation } from "@fedify/fedify/federation";
import {
  Accept,
  Activity,
  Article,
  Create,
  Endpoints,
  Follow,
  getActorHandle,
  getActorTypeName,
  Link,
  Note,
  Person,
  Undo,
} from "@fedify/fedify/vocab";
import { DenoKvMessageQueue, DenoKvStore } from "@fedify/fedify/x/denokv";
import { getLogger } from "@logtape/logtape";
import { dirname, join } from "@std/path";
import { getBlog } from "../models/blog.ts";
import { addComment, Comment, getComments } from "../models/comment.ts";
import {
  addFollower,
  countFollowers,
  getFollowers,
  removeFollower,
  toRecipient,
} from "../models/follower.ts";
import { openKv } from "../models/kv.ts";
import { countPosts, getPost, getPosts, toArticle } from "../models/post.ts";

const logger = getLogger(["blog", "federation"]);

// The `Federation<TContextData>` object is a registry that registers
// federation-related callbacks:
export const federation = createFederation<void>({
  // The following key–value storage is used for internal cache:
  kv: new DenoKvStore(await openKv()),

  // The following message queue is used for maintaining outgoing activities:
  queue: new DenoKvMessageQueue(await openKv()),
});

// Registers the actor dispatcher, which is responsible for creating a
// `Actor` object (`Person` in this case) for a given actor URI.
// The actor dispatch is not only used for the actor URI, but also for
// the WebFinger resource:
federation.setActorDispatcher(
  "/users/{identifier}",
  async (ctx, identifier) => {
    const blog = await getBlog();
    if (blog == null) return null;
    else if (blog.handle !== identifier) return null;
    // A `Context<TContextData>` object has several purposes, and one of
    // them is to provide a way to get the key pairs for the actor in various
    // formats:
    const keyPairs = await ctx.getActorKeyPairs(identifier);
    return new Person({
      id: ctx.getActorUri(identifier),
      name: blog.title,
      summary: blog.description,
      preferredUsername: identifier,
      url: new URL("/", ctx.url),
      published: blog.published,
      discoverable: true,
      suspended: false,
      indexable: true,
      memorial: false,
      // A `Context<TContextData>` object has several purposes, and one of
      // them is to provide a way to generate URIs for the dispatchers and
      // the collections:
      outbox: ctx.getOutboxUri(identifier),
      inbox: ctx.getInboxUri(identifier),
      endpoints: new Endpoints({
        sharedInbox: ctx.getInboxUri(),
      }),
      following: ctx.getFollowingUri(identifier),
      followers: ctx.getFollowersUri(identifier),
      // The `publicKey` and `assertionMethods` are used by peer servers
      // to verify the signature of the actor:
      publicKey: keyPairs[0].cryptographicKey,
      assertionMethods: keyPairs.map((keyPair) => keyPair.multikey),
    });
  },
)
  .setKeyPairsDispatcher(async (_ctx, identifier) => {
    const blog = await getBlog();
    if (blog == null) return [];
    else if (blog.handle !== identifier) return [];
    return [
      {
        publicKey: blog.publicKey,
        privateKey: blog.privateKey,
      },
      {
        publicKey: blog.ed25519PublicKey,
        privateKey: blog.ed25519PrivateKey,
      },
    ];
  });

// Registers the object dispatcher, which is responsible for creating an
// `Article` object for a given post UUID:
federation.setObjectDispatcher(
  Article,
  "/posts/{uuid}",
  async (ctx, { uuid }) => {
    const blog = await getBlog();
    if (blog == null) return null;
    const post = await getPost(uuid);
    if (post == null) return null;
    const comments = await getComments(post.uuid);
    return toArticle(ctx, blog, post, comments);
  },
);

// Registers the outbox dispatcher, which is responsible for listing
// activities in the outbox:
federation.setOutboxDispatcher(
  "/users/{identifier}/outbox",
  async (ctx, identifier, cursor) => {
    if (cursor == null) return null;
    const blog = await getBlog();
    if (blog == null) return null;
    else if (blog.handle !== identifier) return null;
    const activities: Activity[] = [];
    const { posts, nextCursor } = await getPosts(
      undefined,
      // Treat the empty string as the first cursor:
      cursor === "" ? undefined : cursor,
    );
    for await (const post of posts) {
      const comments = await getComments(post.uuid);
      const activity = new Create({
        id: new URL(`/posts/${post.uuid}#activity`, ctx.request.url),
        actor: ctx.getActorUri(identifier),
        to: new URL("https://www.w3.org/ns/activitystreams#Public"),
        object: toArticle(ctx, blog, post, comments),
      });
      activities.push(activity);
    }
    return {
      items: activities,
      nextCursor,
    };
  },
)
  // Registers the outbox counter, which is responsible for counting the
  // total number of activities in the outbox:
  .setCounter(async (_ctx, identifier) => {
    const blog = await getBlog();
    if (blog == null) return null;
    else if (blog.handle !== identifier) return null;
    return countPosts();
  })
  // Registers the first cursor.  The cursor value here is arbitrary, but
  // it must be parsable by the outbox dispatcher:
  .setFirstCursor(async (_ctx, identifier) => {
    const blog = await getBlog();
    if (blog == null) return null;
    else if (blog.handle !== identifier) return null;
    // Treat the empty string as the first cursor:
    return "";
  });

// Registers the inbox listeners, which are responsible for handling
// incoming activities in the inbox:
federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
  // The `Follow` activity is handled by adding the follower to the
  // follower list:
  .on(Follow, async (ctx, follow) => {
    const blog = await getBlog();
    if (blog == null) return;
    if (follow.id == null || follow.objectId == null) return;
    const parsed = ctx.parseUri(follow.objectId);
    if (parsed?.type !== "actor" || parsed.identifier !== blog.handle) return;
    const recipient = await follow.getActor(ctx);
    if (
      recipient == null || recipient.id == null ||
      recipient.preferredUsername == null ||
      recipient.inboxId == null
    ) return;
    const handle = await getActorHandle(recipient);
    await addFollower({
      activityId: follow.id.href,
      id: recipient.id.href,
      name: recipient.name?.toString() ?? "",
      url: getHref(recipient.url) ?? recipient.id.href,
      handle,
      inbox: recipient.inboxId.href,
      sharedInbox: recipient.endpoints?.sharedInbox?.href,
      typeName: getActorTypeName(recipient),
    });
    // Note that if a server receives a `Follow` activity, it should reply
    // with either an `Accept` or a `Reject` activity.  In this case, the
    // server automatically accepts the follow request:
    await ctx.sendActivity(
      { identifier: blog.handle },
      recipient,
      new Accept({
        id: new URL(`#accept/${handle}`, ctx.getActorUri(blog.handle)),
        actor: follow.objectId,
        object: follow,
      }),
    );
  })
  // The `Create` activity is handled by adding a comment to the post:
  .on(Create, async (ctx, create) => {
    const object = await create.getObject(ctx);
    if (object instanceof Note || object instanceof Article) {
      if (object.id == null || object.content == null) return;
      const author = await object.getAttribution();
      if (
        author == null || author.id == null || author.preferredUsername == null
      ) return;
      const comment: Omit<Comment, "postUuid"> = {
        id: object.id.href,
        content: object.content.toString(),
        url: getHref(object.url) ?? object.id.href,
        author: {
          id: author.id.href,
          name: author.name?.toString() ?? author.preferredUsername.toString(),
          handle: `@${author.preferredUsername.toString()}@${author.id.host}`,
          url: getHref(author.url) ?? author.id.href,
        },
        published: create.published ?? Temporal.Now.instant(),
      };
      // Filters only `Note` objects that are in reply to posts in this blog:
      for (const replyTargetId of object.replyTargetIds) {
        const parsed = ctx.parseUri(replyTargetId);
        if (
          parsed == null || parsed.type !== "object" || parsed.class !== Article
        ) continue;
        const postUuid = parsed.values.uuid;
        await addComment({ ...comment, postUuid });
      }
    } else {
      logger.getChild("inbox").warn(
        "Unsupported object type ({type}) for Create activity: {object}",
        { type: object?.constructor.name, object },
      );
    }
  })
  // The `Undo` activity purposes to undo the previous activity.  In this
  // project, we use the `Undo` activity to represent someone unfollowing
  // the blog:
  .on(Undo, async (ctx, undo) => {
    const activity = await undo.getObject(ctx); // An `Activity` to undo
    if (activity instanceof Follow) {
      if (activity.id == null || activity.actorId == null) return;
      await removeFollower(activity.id.href, activity.actorId.href);
    } else {
      logger.getChild("inbox").warn(
        "Unsupported object type ({type}) for Undo activity: {object}",
        { type: activity?.constructor.name, object: activity },
      );
    }
  });

// Since the blog does not follow anyone, the following dispatcher is
// implemented to return just an empty list:
federation.setFollowingDispatcher(
  "/users/{identifier}/following",
  async (_ctx, identifier, _cursor) => {
    const blog = await getBlog();
    if (blog == null) return null;
    else if (blog.handle !== identifier) return null;
    return { items: [] };
  },
);

// Registers the followers collection dispatcher, which is responsible for
// listing the followers of the blog:
federation
  .setFollowersDispatcher(
    "/users/{identifier}/followers",
    async (_ctx, identifier, cursor) => {
      const blog = await getBlog();
      if (blog == null) return null;
      else if (blog.handle !== identifier) return null;
      if (cursor == null) return null;
      const { followers, nextCursor } = await getFollowers(
        undefined,
        // Treat the empty string as the first cursor:
        cursor === "" ? undefined : cursor,
      );
      return {
        items: followers.map(toRecipient),
        nextCursor,
      };
    },
  )
  // Registers the followers counter, which is responsible for counting
  // the total number of followers:
  .setCounter(async (_ctx, identifier) => {
    const blog = await getBlog();
    if (blog == null) return null;
    else if (blog.handle !== identifier) return null;
    return await countFollowers();
  })
  // Registers the first cursor.  The cursor value here is arbitrary, but
  // it must be parsable by the followers collection dispatcher:
  .setFirstCursor(async (_ctx, identifier) => {
    const blog = await getBlog();
    if (blog == null) return null;
    else if (blog.handle !== identifier) return null;
    // Treat the empty string as the first cursor:
    return "";
  });

// Registers the NodeInfo dispatcher, which is responsible for providing
// the server information:
federation.setNodeInfoDispatcher("/nodeinfo/2.1", async (_ctx) => {
  const rootDenoFile = join(
    dirname(dirname(dirname(import.meta.dirname!))),
    "deno.json",
  );
  const denoJson = JSON.parse(await Deno.readTextFile(rootDenoFile));
  const { posts } = await getPosts(1);
  const recentPost = posts.length > 0 ? posts[0] : null;
  const now = Temporal.Now.instant();
  return {
    software: {
      name: "fedify-example-blog",
      version: denoJson.version,
      repository: new URL(
        "https://github.com/fedify-dev/fedify/tree/main/examples/blog",
      ),
    },
    protocols: ["activitypub"],
    usage: {
      users: {
        total: 1,
        activeMonth: recentPost == null ||
            Temporal.Instant.compare(
                recentPost.published,
                now.subtract({ hours: 24 * 30 }),
              ) < 0
          ? 0
          : 1,
        activeHalfyear: recentPost == null ||
            Temporal.Instant.compare(
                recentPost.published,
                now.subtract({ hours: 24 * 30 * 6 }),
              ) < 0
          ? 0
          : 1,
      },
      localComments: 0,
      localPosts: Number(await countPosts()),
    },
  };
});

function getHref(link: Link | URL | string | null): string | null {
  if (link == null) return null;
  if (link instanceof Link) return link.href?.href ?? null;
  if (link instanceof URL) return link.href;
  return link;
}
