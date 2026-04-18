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
