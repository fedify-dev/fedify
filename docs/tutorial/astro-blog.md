---
description: >-
  In this tutorial, we will build a federated blog that uses Astro for static
  content and Fedify for ActivityPub federation, allowing blog posts to be
  delivered to followers across the fediverse.
---

Building a federated blog
=========================

In this tutorial, we will build a [federated blog] using [Fedify] and [Astro].
Blog posts are authored as [Markdown] files and compiled to static HTML at
build time, while [ActivityPub] federation is handled by dynamic server routes.
When you publish a new post (by deploying a new version of the site), your
followers in the fediverse automatically receive it—no extra steps needed.
Remote users can also reply to your posts from their own fediverse accounts,
and those replies appear as comments on your blog.

This tutorial focuses more on how to use Fedify than on understanding the
underlying ActivityPub protocol.  You'll see how Fedify handles the complex
parts of federation for you.

If you have any questions, suggestions, or feedback, please feel free to join
our [Matrix chat space] or [GitHub Discussions].

[federated blog]: https://en.wikipedia.org/wiki/Blog
[Fedify]: https://fedify.dev/
[Astro]: https://astro.build/
[Markdown]: https://en.wikipedia.org/wiki/Markdown
[ActivityPub]: https://www.w3.org/TR/activitypub/
[Matrix chat space]: https://matrix.to/#/#fedify:matrix.org
[GitHub Discussions]: https://github.com/fedify-dev/fedify/discussions


Target audience
---------------

This tutorial is aimed at those who want to learn Fedify and build their own
federated blog software.

We assume that you have some experience creating web pages using HTML and
basic JavaScript, and that you're comfortable using the command line.
However, you don't need to know TypeScript, ActivityPub, or Fedify—we'll
teach you what you need to know as we go along.

You don't need experience building ActivityPub software, but we do assume
that you've used at least one fediverse application such as Mastodon or
Misskey.  This way you'll have a feel for what we're trying to build.

*[HTML]: HyperText Markup Language


Goals
-----

In this tutorial, we'll use Fedify and Astro to create a single-author
federated blog that communicates with other fediverse software via ActivityPub.
The blog will include the following features:

 -  Blog posts are authored as Markdown files in *src/content/posts/*.
 -  The blog can be followed by other actors in the fediverse.
 -  A follower can unfollow the blog.
 -  When the blog is deployed with new posts, those posts are delivered to
    all followers as ActivityPub activities.
 -  Remote users can reply to blog posts from their fediverse account.
 -  Replies appear as comments on the blog post page.

To keep things focused, we'll impose the following limitations:

 -  The author's profile (bio, avatar, etc.) can only be changed by editing
    source files.
 -  Editing or deleting posts after they've been delivered is not supported.
 -  There are no likes or reposts.
 -  There is no search feature.
 -  There are no authentication or authorization features.

The complete source code is available in the [GitHub repository], with commits
corresponding to each step of this tutorial for your reference.

[GitHub repository]: https://github.com/fedify-dev/astro-blog


Setting up the development environment
--------------------------------------

### Installing Bun

Fedify supports three JavaScript runtimes: [Deno], [Node.js], and [Bun].
In this tutorial we'll use [Bun] because it includes a built-in SQLite driver
(`bun:sqlite`) that we'll use later to store followers and comments.

> [!TIP]
> A JavaScript *runtime* is a platform that executes JavaScript code outside
> of a web browser—on a server or in a terminal.  Node.js was the original
> server-side JavaScript runtime; Bun is a newer, faster alternative that also
> comes with a built-in package manager and test runner.

To install Bun, follow the instructions on the [Bun installation page].
Once installed, verify it works:

~~~~ sh
bun --version
~~~~

You should see a version number such as `1.2.0` or later.

[Deno]: https://deno.com/
[Node.js]: https://nodejs.org/
[Bun]: https://bun.sh/
[Bun installation page]: https://bun.sh/docs/installation

### Installing the `fedify` command

To initialize a Fedify project you need the [`fedify`](../cli.md) command.
Install it globally with:

~~~~ sh
bun install -g @fedify/cli
~~~~

Verify the installation:

~~~~ sh
fedify --version
~~~~

Make sure the version is 2.2.0 or higher.

### `fedify init` to initialize the project

Let's create a new directory for our blog and initialize the project.
In this tutorial we'll call it *astro-blog*:

~~~~ sh
fedify init astro-blog
~~~~

When `fedify init` runs, it asks a series of questions.
Select *Bun*, *Astro*, *In-memory*, and *In-process* in order:

~~~~ console
             ___      _____        _ _  __
            /'_')    |  ___|__  __| (_)/ _|_   _
     .-^^^-/  /      | |_ / _ \/ _` | | |_| | | |
   __/       /       |  _|  __/ (_| | |  _| |_| |
  <__.|_|-|_|        |_|  \___|\__,_|_|_|  \__, |
                                           |___/

? Choose the JavaScript runtime to use
  Deno
❯ Bun
  Node.js

? Choose the package manager to use
❯ bun

? Choose the web framework to integrate Fedify with
  Bare-bones
  Hono
  Nitro
  Next
  Elysia
❯ Astro
  Express

? Choose the key–value store to use for caching
❯ In-memory
  Redis
  PostgreSQL

? Choose the message queue to use for background jobs
❯ In-process
  Redis
  PostgreSQL
  AMQP (e.g., RabbitMQ)
~~~~

> [!NOTE]
> Fedify is not a full-stack web framework—it's a library specialized for
> implementing [ActivityPub] servers.  You always use it alongside another
> web framework.  In this tutorial we use [Astro], which is excellent for
> content-focused sites because it compiles Markdown posts to static HTML at
> build time while still supporting dynamic server routes for ActivityPub
> endpoints.

After a moment, you'll have a working project with the following structure:

 -  *src/*
     -  *assets/* — Images and other static assets used in pages
     -  *components/* — Reusable Astro components
     -  *layouts/* — Page layout templates
     -  *pages/* — Routes (each *.astro* file becomes a URL)
         -  *index.astro* — The home page (`/`)
     -  *federation.ts* — ActivityPub server definition (the Fedify part)
     -  *logging.ts* — Logging configuration
     -  *middleware.ts* — Connects Fedify to Astro's request pipeline
 -  *public/* — Files served as-is (favicon, etc.)
 -  *astro.config.ts* — Astro configuration
 -  *biome.json* — Code formatter and linter settings
 -  *package.json* — Package metadata and scripts
 -  *tsconfig.json* — TypeScript settings

Because we're using TypeScript instead of plain JavaScript, source files have
*.ts* or *.astro* extensions.  We'll cover the TypeScript-specific syntax you
need as we go along.

Let's verify the project works.  First, install the dependencies:

~~~~ sh
cd astro-blog
bun install
~~~~

Then start the development server:

~~~~ sh
bun run dev
~~~~

You should see output like this:

~~~~ console
 astro  v6.x.x ready in xxx ms
┃ Local    http://localhost:4321/
┃ Network  use --host to expose
~~~~

Leave the server running and open a second terminal.  Run this command to look
up the demo actor that `fedify init` created:

~~~~ sh
fedify lookup http://localhost:4321/users/john
~~~~

If you see output like this, everything is working:

~~~~ console
✔ Looking up the object...
Person {
  id: URL "http://localhost:4321/users/john",
  name: "john",
  preferredUsername: "john"
}
~~~~

This tells us there's an ActivityPub [*actor*][actor] at */users/john* on our
server.  An actor represents an account that can interact with other servers in
the fediverse.

> [!TIP]
> [`fedify lookup`](../cli.md#fedify-lookup-looking-up-an-activitypub-object)
> fetches and displays any ActivityPub object.  It's like doing a fediverse
> search from the command line.
>
> You can also use `curl` directly if you prefer:
>
> ~~~~ sh
> curl -H "Accept: application/activity+json" \
>   http://localhost:4321/users/john | jq .
> ~~~~
>
> The `-H "Accept: application/activity+json"` header tells Astro to
> return the ActivityPub JSON representation of the page rather than the
> HTML version.  This is called *content negotiation*, and we'll cover it
> in detail when we implement our actor.

Stop the dev server with <kbd>Ctrl</kbd>+<kbd>C</kbd> for now.

[actor]: https://www.w3.org/TR/activitypub/#actors

### Visual Studio Code

We recommend using [Visual Studio Code] while following this tutorial.
TypeScript tooling works best in VS Code, and the generated project already
includes settings for it.

After [installing VS Code], open the project folder: *File* → *Open Folder…*.

If a popup asks you to install the recommended Biome extension, click
*Install*.  Biome will automatically format your code on save, so you don't
need to worry about indentation or code style.

[Visual Studio Code]: https://code.visualstudio.com/
[installing VS Code]: https://code.visualstudio.com/docs/setup/setup-overview


Prerequisites
-------------

### TypeScript

Before we start writing code, let's briefly go over TypeScript.
If you're already familiar with TypeScript, feel free to skip this section.

TypeScript is a superset of JavaScript that adds optional static type
annotations.  The syntax is almost identical to JavaScript; you just add type
information after a colon (`:`).

For example, this declares a variable `name` that must hold a string:

~~~~ typescript twoslash
let name: string = "Alice";
~~~~

If you try to assign a value of the wrong type, your editor will show a red
underline *before you even run the code*:

~~~~ typescript twoslash
// @errors: 2322
let name: string;
// ---cut-before---
name = 42; // ← red underline: Type 'number' is not assignable to type 'string'
~~~~

You can also annotate function parameters and return types:

~~~~ typescript twoslash
function greet(name: string): string {
  return `Hello, ${name}!`;
}
~~~~

Throughout this tutorial we'll encounter a few more TypeScript features and
explain them as they appear.  TypeScript knowledge isn't required—just pay
attention to the red underlines in your editor and read the error messages.
They're usually very helpful.


Building the blog
-----------------

Now that the project is scaffolded, let's turn it into an actual blog.
We'll use [Astro's content collections][content-collections] to manage blog
posts as Markdown files, create a listing page, and add individual post pages.
At the end of this chapter you'll have a working blog—no ActivityPub yet, just
a clean static site.

[content-collections]: https://docs.astro.build/en/guides/content-collections/

### Defining the content collection

Astro uses *content collections* to type-check and manage structured content
like blog posts.  Create the file *src/content.config.ts*:

~~~~ typescript
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const posts = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/posts" }),
  schema: z.object({
    title: z.string(),
    pubDate: z.coerce.date(),
    description: z.string(),
    draft: z.boolean().optional(),
  }),
});

export const collections = { posts };
~~~~

Let's walk through this:

 -  `defineCollection()` declares a named collection of content files.
 -  `glob(...)` tells Astro to find all _\*.md_ files in *src/content/posts/*.
 -  `z.object(...)` is a [Zod] schema that validates and types the frontmatter
    in each Markdown file.

> [!NOTE]
> *Frontmatter* is the YAML block at the top of a Markdown file, enclosed
> in `---`.  It holds metadata like the title and publication date.

The `z` object is a schema validation library called [Zod].  Each field in the
schema corresponds to a frontmatter field in our Markdown posts.  TypeScript
will enforce that all posts have a `title`, `pubDate`, and `description`.

[Zod]: https://zod.dev/

### Writing blog posts

Create three sample posts.  First, *src/content/posts/hello-fediverse.md*:

~~~~ markdown
---
title: "Hello, Fediverse!"
pubDate: 2025-01-15
description: >-
  Welcome to this example federated blog built with Astro and Fedify.
  You can follow it from Mastodon or any other fediverse platform.
---

Welcome to this federated blog example! ...
~~~~

Create two more posts—their exact content isn't important for the tutorial;
what matters is that each post has valid frontmatter matching the schema.

> [!TIP]
> The `>-` syntax in YAML is a *block scalar*—it lets you write a long string
> across multiple lines.  Trailing newlines are stripped.  This is handy for
> `description` fields that would otherwise make the frontmatter too wide.

### The layout component

Replace *src/layouts/Layout.astro* with a minimal layout.  The key parts are
the `Props` interface (which TypeScript uses to type-check component usage) and
a `<slot />` where page content is injected:

~~~~ astro
---
interface Props {
  title?: string;
  description?: string;
}

const { title, description } = Astro.props;
const siteTitle = "Fedify Blog Example";
const pageTitle = title ? `${title} — ${siteTitle}` : siteTitle;
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" href="/favicon.ico" />
    <title>{pageTitle}</title>
    {description && <meta name="description" content={description} />}
  </head>
  <body>
    <header>
      <nav>
        <a href="/" class="site-title">{siteTitle}</a>
      </nav>
    </header>
    <main>
      <slot />
    </main>
    <footer>
      <p>
        Built with <a href="https://astro.build/">Astro</a> and
        <a href="https://fedify.dev/">Fedify</a>.
      </p>
    </footer>
  </body>
</html>

<style is:global>
  *,
  *::before,
  *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  html {
    font-family: system-ui, sans-serif;
    font-size: 18px;
    line-height: 1.6;
    color: #1a1a1a;
    background: #fff;
  }

  body {
    max-width: 48rem;
    margin: 0 auto;
    padding: 1rem 1.25rem;
  }

  a { color: #0066cc; text-decoration: none; }
  a:hover { text-decoration: underline; }

  header {
    padding: 1rem 0;
    margin-bottom: 2rem;
    border-bottom: 1px solid #e5e5e5;
  }

  .site-title { font-size: 1.25rem; font-weight: 600; color: #1a1a1a; }

  main { min-height: 60vh; }

  footer {
    margin-top: 3rem;
    padding-top: 1rem;
    border-top: 1px solid #e5e5e5;
    font-size: 0.875rem;
    color: #666;
  }

  h1 { font-size: 2rem; line-height: 1.2; margin-bottom: 0.5rem; }
  h2 { font-size: 1.5rem; margin-top: 2rem; margin-bottom: 0.5rem; }
  p { margin-bottom: 1rem; }
  ul, ol { margin-bottom: 1rem; padding-left: 1.5rem; }
</style>
~~~~

Notice that the layout uses `<style is:global>` rather than `<style>`.  This
tells Astro to apply these styles globally instead of scoping them to just this
component.

> [!TIP]
> The `{description && <meta .../>}` expression is JSX-style conditional
> rendering.  It renders the `<meta>` tag only when `description` is truthy.

### The blog listing page

Replace *src/pages/index.astro* with the blog listing:

~~~~ astro
---
import { getCollection } from "astro:content";
import Layout from "../layouts/Layout.astro";

const allPosts = await getCollection("posts");
const posts = allPosts
  .filter((post) => !post.data.draft)
  .sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());
---

<Layout>
  <h1>Blog</h1>
  <p class="tagline">A federated blog powered by Astro and Fedify.</p>
  <ul class="post-list">
    {
      posts.map((post) => (
        <li class="post-item">
          <time datetime={post.data.pubDate.toISOString()}>
            {post.data.pubDate.toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </time>
          <h2>
            <a href={`/posts/${post.id}`}>{post.data.title}</a>
          </h2>
          <p>{post.data.description}</p>
        </li>
      ))
    }
  </ul>
</Layout>
~~~~

`getCollection("posts")` fetches all entries in the `posts` collection.
The `post.data` object is typed according to the Zod schema we defined.
For example, `post.data.pubDate` is a `Date` object, not a raw string,
because `z.coerce.date()` converts it automatically.

### The individual post page

Create *src/pages/posts/* and add a file named *\[slug].astro*
(note: the brackets are part of the filename—they tell Astro this is
a dynamic route):

~~~~ astro
---
import { getCollection, render } from "astro:content";
import Layout from "../../layouts/Layout.astro";

const { slug } = Astro.params;
const posts = await getCollection("posts");
const post = posts.find((p) => p.id === slug);

if (!post || post.data.draft) {
  return Astro.redirect("/404");
}

const { Content } = await render(post);
---

<Layout title={post.data.title} description={post.data.description}>
  <article>
    <header class="post-header">
      <h1>{post.data.title}</h1>
      <time datetime={post.data.pubDate.toISOString()}>
        {post.data.pubDate.toLocaleDateString("en-US", { ... })}
      </time>
    </header>
    <div class="post-content">
      <Content />
    </div>
    <footer class="post-footer">
      <a href="/">&larr; Back to all posts</a>
    </footer>
  </article>
</Layout>
~~~~

The brackets in the filename tell Astro this is a [dynamic route]—the name
inside the brackets becomes a URL parameter accessible via `Astro.params`.
When a request comes in for `/posts/hello-fediverse`, Astro sets
`Astro.params.slug` to `"hello-fediverse"` and runs this page.

`render(post)` converts the Markdown content to HTML and returns a `Content`
component.  When you write `<Content />` in the template, Astro renders the
full post body.

[dynamic route]: https://docs.astro.build/en/guides/routing/#dynamic-routes

### Testing the blog

Start the development server:

~~~~ sh
bun run dev
~~~~

Open <http://localhost:4321/> in your browser.  You should see a listing of
all three posts, sorted newest-first:

![Blog home page showing three post listings](./astro-blog/blog-home.png)

Click any post title to see the individual post page:

![Individual blog post page](./astro-blog/blog-post.png)

Stop the server with <kbd>Ctrl</kbd>+<kbd>C</kbd> when you're done.

Implementing the ActivityPub actor
==================================

We now have a working blog, but it's not federated yet.  To make the blog
discoverable by other ActivityPub servers (like Mastodon), we need to expose an
*actor*—a machine-readable description of who or what is publishing content.

In ActivityPub, an actor is a JSON-LD document that describes an entity (a
person, bot, group, or service) and tells other servers how to interact with it.
For our blog, the actor will describe the blog itself: its name, where to send
activities, and which cryptographic keys to use when signing outgoing requests.

*[JSON-LD]: JavaScript Object Notation for Linked Data

### In-memory store

Before we can implement the actor, we need somewhere to store key pairs.
Cryptographic key pairs must be stable—if the keys change between requests,
other servers will reject our signatures.  We'll start with an in-memory
solution and migrate to SQLite in a later chapter.

Create the file *src/lib/store.ts*:

~~~~ typescript [src/lib/store.ts]
// In-memory store for key pairs and followers.
// Uses globalThis to persist across Astro module reloads in dev mode.
// This data is lost when the server restarts — we'll fix that in a later
// chapter when we introduce SQLite.

declare global {
  var _keyPairs: Map<string, CryptoKeyPair[]>; // eslint-disable-line no-var
  var _followers: Map<string, string>; // eslint-disable-line no-var
}

if (globalThis._keyPairs == null) globalThis._keyPairs = new Map();
if (globalThis._followers == null) globalThis._followers = new Map();

export const keyPairs: Map<string, CryptoKeyPair[]> = globalThis._keyPairs;
export const followers: Map<string, string> = globalThis._followers;
~~~~

The `_followers` map is also declared here even though we won't use it until
Chapter 6—it's easier to keep both maps in the same place.

> [!NOTE]
> We use `globalThis` instead of module-level variables because Astro's
> development server uses [Vite's Hot Module Replacement (HMR)], which
> re-evaluates modules whenever you save a file.  If we stored key pairs in
> a plain module variable, they'd be reset to `undefined` on every save,
> causing authentication failures.  Storing them on `globalThis` keeps them
> alive across HMR reloads.

[Vite's Hot Module Replacement (HMR)]: https://vite.dev/guide/features.html#hot-module-replacement

### Updating the federation module

Now let's update *src/federation.ts* to implement the actor.  Replace the
entire file with:

~~~~ typescript [src/federation.ts]
import {
  createFederation,
  generateCryptoKeyPair,
  InProcessMessageQueue,
  MemoryKvStore,
} from "@fedify/fedify";
import { Endpoints, Person } from "@fedify/vocab";
import { getLogger } from "@logtape/logtape";
import { keyPairs } from "./lib/store.ts";

const logger = getLogger("astro-blog");

export const BLOG_IDENTIFIER = "blog";
export const BLOG_NAME = "Fedify Blog Example";
export const BLOG_SUMMARY =
  "A sample federated blog powered by Fedify and Astro.";

const federation = createFederation({
  kv: new MemoryKvStore(),
  queue: new InProcessMessageQueue(),
});

federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    if (identifier !== BLOG_IDENTIFIER) {
      logger.debug("Unknown actor identifier: {identifier}", { identifier });
      return null;
    }
    const kp = await ctx.getActorKeyPairs(identifier);
    return new Person({
      id: ctx.getActorUri(identifier),
      preferredUsername: identifier,
      name: BLOG_NAME,
      summary: BLOG_SUMMARY,
      url: new URL("/", ctx.url),
      inbox: ctx.getInboxUri(identifier),
      endpoints: new Endpoints({
        sharedInbox: ctx.getInboxUri(),
      }),
      followers: ctx.getFollowersUri(identifier),
      publicKey: kp[0].cryptographicKey,
      assertionMethods: kp.map((k) => k.multikey),
    });
  })
  .setKeyPairsDispatcher(async (_ctx, identifier) => {
    if (identifier !== BLOG_IDENTIFIER) return [];
    const stored = keyPairs.get(identifier);
    if (stored) return stored;
    const [rsaKey, ed25519Key] = await Promise.all([
      generateCryptoKeyPair("RSASSA-PKCS1-v1_5"),
      generateCryptoKeyPair("Ed25519"),
    ]);
    const kp = [rsaKey, ed25519Key];
    keyPairs.set(identifier, kp);
    return kp;
  });

federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");

federation.setFollowersDispatcher(
  "/users/{identifier}/followers",
  (_ctx, identifier) => {
    if (identifier !== BLOG_IDENTIFIER) return null;
    return { items: [] };
  },
);

export default federation;
~~~~

Let's walk through the key changes:

**`BLOG_IDENTIFIER`, `BLOG_NAME`, `BLOG_SUMMARY`** are exported constants that
we'll reuse in the HTML profile page.

**`setActorDispatcher`** registers a callback for the route
`/users/{identifier}`. When an ActivityPub client fetches that URL, Fedify
calls this callback and serializes the returned object to JSON-LD.  We return
`null` for any identifier that isn't our blog, which causes Fedify to respond
with `404 Not Found`.

The `Person` object we return carries:

 -  `id` — the canonical URL of the actor, obtained via
    `ctx.getActorUri(identifier)`.
 -  `preferredUsername` — the short handle that ActivityPub software displays
    (e.g., `@blog@example.com`).
 -  `name`, `summary` — display name and description.
 -  `url` — the human-readable profile URL (the blog home page).
 -  `inbox` — where other servers deliver activities (follows, replies, etc.).
    We register the inbox path below.
 -  `endpoints.sharedInbox` — a single inbox URL shared across all actors on
    this server.  Most servers prefer to send bulk deliveries here.
 -  `followers` — the URL of the followers collection.
 -  `publicKey`, `assertionMethods` — cryptographic keys used to verify that
    activities truly came from this actor.

**`setKeyPairsDispatcher`** generates and caches two key pairs: one
[RSA-PKCS1-v1.5] key (for compatibility with older ActivityPub software) and
one [Ed25519] key (faster, modern).  Both are stored in the `keyPairs` map.

**`setInboxListeners`** registers the inbox and shared inbox routes.  We need
to call this even before we add any handlers because Fedify needs to know the
inbox path to include it in the actor's JSON-LD.  We'll add actual handlers in
Chapter 6 (Followers).

**`setFollowersDispatcher`** registers the followers collection route.  For now
it returns an empty list; we'll fill it in Chapter 6.

[RSA-PKCS1-v1.5]: https://en.wikipedia.org/wiki/PKCS_1
[Ed25519]: https://en.wikipedia.org/wiki/EdDSA#Ed25519

### Updating the middleware

Add an import for the logging module in *src/middleware.ts* so that LogTape is
configured before any Fedify code runs:

~~~~ typescript{3} [src/middleware.ts]
import { fedifyMiddleware } from "@fedify/astro";
import federation from "./federation.ts";
import "./logging.ts";

export const onRequest = fedifyMiddleware(federation, (_context) => undefined);
~~~~

The `import "./logging.ts"` side-effect import ensures that the LogTape
configuration we defined in Chapter 2 is loaded before the first request
arrives.  Without it, log messages from the federation layer would be silently
discarded.

### The actor profile page

Right now if a browser visits `/users/blog`, Astro would respond with a 404
because there is no page at that path.  We need to add an HTML page so that
both browsers and ActivityPub clients get useful responses at the same URL.

Create the directory *src/pages/users/blog/* and add *index.astro*:

~~~~ astro [src/pages/users/blog/index.astro]
---
import { getCollection } from "astro:content";
import {
  BLOG_IDENTIFIER,
  BLOG_NAME,
  BLOG_SUMMARY,
} from "../../../federation.ts";
import Layout from "../../../layouts/Layout.astro";

const posts = await getCollection("posts");
const publishedPosts = posts
  .filter((post) => !post.data.draft)
  .sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());

const handle = `@${BLOG_IDENTIFIER}@${Astro.url.host}`;
---

<Layout
  title={`${BLOG_NAME} (@${BLOG_IDENTIFIER})`}
  description={BLOG_SUMMARY}
>
  <section class="profile">
    <h1>{BLOG_NAME}</h1>
    <p class="handle">{handle}</p>
    <p class="summary">{BLOG_SUMMARY}</p>
    <p class="hint">
      Follow this blog from your fediverse account to receive new posts
      automatically.
    </p>
  </section>

  <section class="posts">
    <h2>Posts</h2>
    <ul class="post-list">
      {
        publishedPosts.map((post) => (
          <li class="post-item">
            <time datetime={post.data.pubDate.toISOString()}>
              {post.data.pubDate.toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </time>
            <h3>
              <a href={`/posts/${post.id}`}>{post.data.title}</a>
            </h3>
          </li>
        ))
      }
    </ul>
  </section>
</Layout>

<style>
  .profile {
    margin-bottom: 2.5rem;
    padding-bottom: 2rem;
    border-bottom: 1px solid #e5e5e5;
  }

  .handle {
    color: #666;
    font-family: monospace;
    font-size: 0.95rem;
    margin-bottom: 0.5rem;
  }

  .summary { margin-bottom: 0.75rem; }

  .hint {
    font-size: 0.875rem;
    color: #555;
    background: #f5f5f5;
    padding: 0.75rem 1rem;
    border-radius: 4px;
  }

  .posts h2 { margin-bottom: 1rem; }

  .post-list {
    list-style: none;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .post-item time {
    font-size: 0.875rem;
    color: #666;
    display: block;
  }

  .post-item h3 {
    font-size: 1rem;
    margin-top: 0.1rem;
  }
</style>
~~~~

This page imports the constants from *federation.ts* so the blog name and
description stay in sync between the HTML and JSON-LD views.

> [!TIP]
> The URL `/users/blog` is served by both Fedify and Astro—they share the
> route.  Which one responds depends on the `Accept` header of the request.
> ActivityPub clients send `Accept: application/activity+json`, so Fedify
> handles those and returns JSON-LD.  Browsers send `Accept: text/html`, so
> Astro handles those and renders the HTML profile page.
>
> This HTTP [content negotiation] trick is what makes Fedify and Astro work
> together on the same path.  Fedify's `@fedify/astro` middleware inspects the
> `Accept` header and hands off non-ActivityPub requests to the Astro router.

[content negotiation]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Content_negotiation

### Testing the actor

Start the development server if it isn't running:

~~~~ sh
bun run dev
~~~~

Open <http://localhost:4321/users/blog> in your browser.  You should see the
actor profile page with the blog name, handle, and post list:

![Actor profile page showing blog name, fediverse handle, and post listings](./astro-blog/actor-profile.png)

Now test the ActivityPub response.  Open a new terminal and run:

~~~~ sh
fedify lookup http://localhost:4321/users/blog
~~~~

You should see output like this:

~~~~ console
✔ Looking up the object...
Person {
  id: URL "http://localhost:4321/users/blog",
  name: "Fedify Blog Example",
  summary: "A sample federated blog powered by Fedify and Astro.",
  url: URL "http://localhost:4321/",
  preferredUsername: "blog",
  publicKey: CryptographicKey {
    id: URL "http://localhost:4321/users/blog#main-key",
    owner: URL "http://localhost:4321/users/blog",
    publicKey: CryptoKey { ... },
  },
  ...
}
~~~~

> [!NOTE]
> If `fedify lookup` returns an error about a private object, add the
> `-a`/`--authorized-fetch` flag to sign the request:
>
> ~~~~ sh
> fedify lookup -a http://localhost:4321/users/blog
> ~~~~

The blog now has a valid ActivityPub identity.  However, it can't receive
follows or deliver posts to the fediverse yet—those features require a public
URL, which we'll set up next.

Interoperating with Mastodon
============================

So far we've verified the actor endpoint works locally.  Now let's confirm
it's recognizable to other ActivityPub software—in this case, Mastodon.  To
do that, we need a publicly reachable HTTPS URL.

This chapter has no code changes.  After it you'll commit the tunnel support
from the previous chapter.

### Exposing the server with `fedify tunnel`

The `fedify` CLI includes a built-in tunneling command that creates a secure
public URL pointing at your local server:

~~~~ sh
fedify tunnel 4321
~~~~

You'll see output like this after a few seconds:

~~~~ console
✔ Tunnel is ready!
  Public URL: https://3f8a2b1c4d5e6f.lhr.life/
~~~~

> [!NOTE]
> The tunnel uses one of several free tunneling services
> (localhost.run, serveo.net, or pinggy.io).  The URL changes each
> time you run the command, so you'll need to update any references
> when you restart it.

Keep the tunnel running in a separate terminal while you continue
testing.

However, there's one more thing to do.  The tunnel terminates HTTPS
and forwards plain HTTP to your local server.  Without extra
configuration, Fedify would generate `http://` actor IDs rather than
`https://`, which other servers will reject.

To fix this, update *src/middleware.ts* to rewrite the request URL based on
the `X-Forwarded-Proto` header that the tunnel sets:

~~~~ typescript [src/middleware.ts]
import { fedifyMiddleware } from "@fedify/astro";
import type { MiddlewareHandler } from "astro";
import federation from "./federation.ts";
import "./logging.ts";

export const onRequest: MiddlewareHandler = (context, next) => {
  // Rewrite the request URL scheme based on X-Forwarded-Proto when running
  // behind a reverse proxy or tunnel (e.g. `fedify tunnel`).
  const proto = context.request.headers.get("x-forwarded-proto");
  const url = new URL(context.request.url);
  if (proto != null && url.protocol !== `${proto}:`) {
    url.protocol = proto;
    context.request = new Request(url.toString(), context.request);
  }
  return fedifyMiddleware(federation, (_ctx) => undefined)(context, next);
};
~~~~

Also update *astro.config.ts* to allow requests from external hostnames
(the tunnel assigns a different hostname than `localhost`):

~~~~ typescript{9-13} [astro.config.ts]
import node from "@astrojs/node";
import { fedifyIntegration } from "@fedify/astro";
import { defineConfig } from "astro/config";

export default defineConfig({
  integrations: [fedifyIntegration()],
  output: "server",
  adapter: node({ mode: "standalone" }),
  vite: {
    server: {
      allowedHosts: true,
    },
  },
});
~~~~

> [!WARNING]
> `allowedHosts: true` disables Vite's host checking.  This is fine for
> local development where only you control the server.  Do **not** use
> this setting in production—Astro uses a different server configuration
> when built for deployment.

Restart the dev server after these changes.  Now run `fedify lookup`
with the tunnel URL to confirm the actor ID uses `https://`:

~~~~ sh
fedify lookup https://3f8a2b1c4d5e6f.lhr.life/users/blog
~~~~

You should see:

~~~~ console
✔ Looking up the object...
Person {
  id: URL "https://3f8a2b1c4d5e6f.lhr.life/users/blog",
  name: "Fedify Blog Example",
  ...
}
~~~~

### Searching for the blog on Mastodon

With the server publicly accessible, open your Mastodon account (or
any Mastodon instance), type the blog's handle into the search box, and
press <kbd>Enter</kbd>:

~~~~ console
@blog@3f8a2b1c4d5e6f.lhr.life
~~~~

Mastodon sends a [WebFinger] lookup to your server to resolve the handle.
You should see the blog appear in the search results:

![Mastodon search box showing the blog handle, with matching profile results](./astro-blog/mastodon-search.png)

> [!NOTE]
> You must be signed in to a Mastodon instance for remote actor resolution
> to work.  Unauthenticated searches only show locally cached results.

You can click the blog's profile to see it:

~~~~ console
Fedify Blog Example
@blog@3f8a2b1c4d5e6f.lhr.life

A sample federated blog powered by Fedify and Astro.
~~~~

The blog is now discoverable across the fediverse.  In the next chapter
we'll implement inbox listeners so it can actually receive and respond
to Follow activities.

Implementing followers
======================

Our blog actor is now discoverable, but if a remote user tries to follow it,
nothing happens—we haven't implemented the inbox yet.  In this chapter we'll
handle `Follow` activities (auto-accepting them and storing followers) and
`Undo(Follow)` activities (removing followers).  We'll also display the
follower count on the home page.

[WebFinger]: https://webfinger.net/

### Updating the federation module

Replace *src/federation.ts* with the following:

~~~~ typescript [src/federation.ts]
import {
  createFederation,
  generateCryptoKeyPair,
  InProcessMessageQueue,
  MemoryKvStore,
} from "@fedify/fedify";
import { Accept, Endpoints, Follow, Person, Undo } from "@fedify/vocab";
import { getLogger } from "@logtape/logtape";
import { followers, keyPairs } from "./lib/store.ts";

const logger = getLogger("astro-blog");

export const BLOG_IDENTIFIER = "blog";
export const BLOG_NAME = "Fedify Blog Example";
export const BLOG_SUMMARY =
  "A sample federated blog powered by Fedify and Astro.";

const federation = createFederation({
  kv: new MemoryKvStore(),
  queue: new InProcessMessageQueue(),
});

federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    if (identifier !== BLOG_IDENTIFIER) {
      logger.debug("Unknown actor identifier: {identifier}", { identifier });
      return null;
    }
    const kp = await ctx.getActorKeyPairs(identifier);
    return new Person({
      id: ctx.getActorUri(identifier),
      preferredUsername: identifier,
      name: BLOG_NAME,
      summary: BLOG_SUMMARY,
      url: new URL("/", ctx.url),
      inbox: ctx.getInboxUri(identifier),
      endpoints: new Endpoints({
        sharedInbox: ctx.getInboxUri(),
      }),
      followers: ctx.getFollowersUri(identifier),
      publicKey: kp[0].cryptographicKey,
      assertionMethods: kp.map((k) => k.multikey),
    });
  })
  .setKeyPairsDispatcher(async (_ctx, identifier) => {
    if (identifier !== BLOG_IDENTIFIER) return [];
    const stored = keyPairs.get(identifier);
    if (stored) return stored;
    const [rsaKey, ed25519Key] = await Promise.all([
      generateCryptoKeyPair("RSASSA-PKCS1-v1_5"),
      generateCryptoKeyPair("Ed25519"),
    ]);
    const kp = [rsaKey, ed25519Key];
    keyPairs.set(identifier, kp);
    return kp;
  });

federation
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
  .on(Follow, async (ctx, follow) => {
    if (follow.id == null || follow.actorId == null) return;
    const parsed = ctx.parseUri(follow.objectId);
    if (parsed?.type !== "actor" || parsed.identifier !== BLOG_IDENTIFIER) {
      return;
    }
    const follower = await follow.getActor(ctx);
    if (follower == null || follower.id == null || follower.inboxId == null) {
      return;
    }
    followers.set(follower.id.href, follower.inboxId.href);
    logger.info("New follower: {follower}", { follower: follower.id.href });
    await ctx.sendActivity(
      { identifier: BLOG_IDENTIFIER },
      follower,
      new Accept({
        id: new URL(
          `#accepts/${follower.id.href}`,
          ctx.getActorUri(BLOG_IDENTIFIER),
        ),
        actor: ctx.getActorUri(BLOG_IDENTIFIER),
        object: follow,
      }),
    );
  })
  .on(Undo, async (ctx, undo) => {
    const object = await undo.getObject(ctx);
    if (!(object instanceof Follow)) return;
    if (undo.actorId == null) return;
    followers.delete(undo.actorId.href);
    logger.info("Unfollowed: {actor}", { actor: undo.actorId.href });
  });

federation.setFollowersDispatcher(
  "/users/{identifier}/followers",
  (_ctx, identifier) => {
    if (identifier !== BLOG_IDENTIFIER) return null;
    const items = Array.from(followers.entries()).map(([id, inboxId]) => ({
      id: new URL(id),
      inboxId: new URL(inboxId),
    }));
    return { items };
  },
);

export default federation;
~~~~

Let's walk through the new pieces:

**Importing `Accept`, `Follow`, and `Undo`** from `@fedify/vocab` gives us the
activity types we need to handle.  We also import `followers` from the store.

**`.on(Follow, ...)`** registers a handler for incoming `Follow` activities.
When someone follows the blog:

1.  We use `ctx.parseUri(follow.objectId)` to confirm they're following our
    blog actor (not some other actor).
2.  We call `follow.getActor(ctx)` to fetch the follower's actor document—this
    gives us their `id` and `inboxId`.
3.  We store the follower in the `followers` map.
4.  We send back an `Accept(Follow)` activity to confirm the follow.  Without
    this, the follow request stays pending on the remote server.

**`.on(Undo, ...)`** handles `Undo(Follow)` activities, which are sent when
someone unfollows.  We use `undo.getObject(ctx)` to retrieve the original
`Follow` activity.  If it's a `Follow`, we remove the actor from the
`followers` map.

**`setFollowersDispatcher`** now returns the real follower list instead of an
empty array.  Each item needs both an `id` (the actor's URL) and an `inboxId`
(where to deliver activities)—Fedify uses these when sending activities to all
followers.

### Showing follower count on the home page

Update *src/pages/index.astro* to display the follower count and a link to
the actor profile:

~~~~ astro{2-4,11-14} [src/pages/index.astro]
---
import { getCollection } from "astro:content";
import { BLOG_IDENTIFIER, BLOG_NAME } from "../federation.ts";
import { followers } from "../lib/store.ts";
import Layout from "../layouts/Layout.astro";

const allPosts = await getCollection("posts");
const posts = allPosts
  .filter((post) => !post.data.draft)
  .sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());

const followerCount = followers.size;
const handle = `@${BLOG_IDENTIFIER}@${Astro.url.host}`;
---

<Layout>
  <h1>{BLOG_NAME}</h1>
  <p class="tagline">
    <a href={`/users/${BLOG_IDENTIFIER}`}>{handle}</a>
    · {followerCount} {followerCount === 1 ? "follower" : "followers"}
  </p>
  ...
</Layout>
~~~~

### Testing with ActivityPub.Academy

To test the follow flow, we need a real ActivityPub server to send `Follow`
activities to our blog.  [ActivityPub.Academy] is a sandbox Mastodon instance
designed specifically for this purpose.

Make sure the dev server is running and the tunnel is active:

~~~~ sh
bun run dev
# In a separate terminal:
fedify tunnel 4321
~~~~

On ActivityPub.Academy, sign in (or create a test account) and search for
your blog's handle:

~~~~ console
@blog@3f8a2b1c4d5e6f.lhr.life
~~~~

Click **Follow**.  Within a second or two, you should see a log message in
your dev server terminal:

~~~~ console
18:42:01.123 INF astro-blog New follower: https://activitypub.academy/users/testuser
~~~~

Refresh the home page—the follower count should now read `1 follower`:

![Blog home page showing “1 follower” in the tagline](./astro-blog/blog-home-followers.png)

To test unfollowing, click **Unfollow** on ActivityPub.Academy.  The follower
count should drop back to 0.

> [!NOTE]
> Followers are stored in memory and are lost when you restart the
> server.  We'll fix this in the next chapter when we migrate to SQLite.

[ActivityPub.Academy]: https://activitypub.academy
