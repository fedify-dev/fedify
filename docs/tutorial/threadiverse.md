---
description: >-
  In this tutorial, we will build a small threadiverse-style community platform
  that federates with Lemmy, Mbin, and NodeBB using Fedify and Next.js.
---

Building a threadiverse community platform
==========================================

In this tutorial, we will build a small threadiverse-style community platform
that federates with [Lemmy], [Mbin], and [NodeBB].  The server we build will
host federated *communities* that remote users can subscribe to, threads
posted inside those communities, and threaded replies to those threads.  We
will use [Fedify] as the ActivityPub framework and [Next.js] as the web
framework.

This tutorial focuses on how to use Fedify rather than on Next.js itself.  If
you have never used Next.js before, don't worry: we'll only touch the parts of
it that we need, and in a very shallow way.

If you have any questions, suggestions, or feedback, please feel free to join
our [Matrix chat space] or [GitHub Discussions].

[Lemmy]: https://join-lemmy.org/
[Mbin]: https://joinmbin.org/
[NodeBB]: https://nodebb.org/
[Fedify]: https://fedify.dev/
[Next.js]: https://nextjs.org/
[Matrix chat space]: https://matrix.to/#/#fedify:matrix.org
[GitHub Discussions]: https://github.com/fedify-dev/fedify/discussions


Target audience
---------------

This tutorial is aimed at readers who want to learn how to build a
community-centric ActivityPub application, something shaped like Lemmy rather
than like Mastodon.

We assume that you have experience creating web applications with HTML and
HTTP, that you understand command-line interfaces, JSON, and basic JavaScript.
You don't need to know TypeScript, JSX, SQL, ORMs, ActivityPub, Next.js, or
Fedify.  We'll teach you what you need to know about each of these as we go
along.

You don't need prior experience building ActivityPub software, but we do
assume that you have used at least one piece of threadiverse software such as
Lemmy, Mbin, NodeBB, or [Piefed].  That way you already have a mental picture
of the kind of product we are building.

If you are looking for a tutorial that builds a Mastodon-style microblog
(actor- and timeline-centric) instead, see
[*Creating your own federated microblog*](./microblog.md).

*[JSX]: JavaScript XML
*[ORM]: Object–Relational Mapping

[Piefed]: https://piefed.social/


Goals
-----

We will build a multi-user community platform whose local users can host
federated *communities* and subscribe to remote ones.  It will include the
following features:

 -  Users can sign up and log in with a username and password.
 -  Local users are federated as `Person` actors: other fediverse software can
    look them up by their handle.
 -  Local users can create and host federated *communities*.  A community is
    federated as a `Group` actor with its own inbox, outbox, and followers
    collection.
 -  Users can subscribe to a community on any threadiverse-compatible server
    (Lemmy, Mbin, another Fedify-based app, and so on).
 -  Users can unsubscribe from a community.
 -  Users can create a text thread inside a subscribed community.  A thread is
    federated as a `Create(Page)` activity addressed to the community.
 -  When a local community receives a thread, it redistributes that thread to
    all of its subscribers as an `Announce` activity.  This is the pattern
    threadiverse servers use to fan discussion out to every follower of a
    community.
 -  Users can reply to a thread or to another reply.  Replies are federated as
    `Create(Note)` activities.
 -  Users can up-vote (`Like`) or down-vote (`Dislike`) any thread or reply.
    The community redistributes these votes the same way it redistributes
    threads and replies.
 -  Users see a front page that lists recent threads from every community they
    subscribe to.

To keep the tutorial focused on federation mechanics, we leave out the
following features:

 -  Link threads (threads whose body is a URL instead of prose).
 -  Thread and reply editing, deletion, and `Tombstone`.
 -  Moderator roles, removals, bans, and reports.
 -  Ranking algorithms such as *Hot* or *Active*.
 -  Private communities.
 -  Media uploads.
 -  Direct messages.

After finishing the tutorial you are encouraged to add whichever of these you
want; they're all good practice.

The complete source code is available in the [GitHub repository], with
commits separated according to each implementation step for your reference.

[GitHub repository]: https://github.com/fedify-dev/threadiverse


Setting up the development environment
--------------------------------------

### Installing Node.js

Fedify supports three JavaScript runtimes: [Deno], [Bun], and [Node.js].
Next.js itself runs on Node.js, so we'll use Node.js here as well.

You need Node.js version 22.0.0 or higher.  There are
[several installation methods]; pick whichever is most convenient.  Once
Node.js is installed you should have access to the `node` and `npm` commands:

~~~~ sh
node --version
npm --version
~~~~

[Deno]: https://deno.com/
[Bun]: https://bun.sh/
[Node.js]: https://nodejs.org/
[several installation methods]: https://nodejs.org/en/download/package-manager

### Installing the `fedify` command

To scaffold a Fedify project we'll use the [`fedify`](../cli.md) command.
There are [several installation methods](../cli.md#installation); the simplest
is to install it as a global npm package:

~~~~ sh
npm install -g @fedify/cli
~~~~

Check that it works:

~~~~ sh
fedify --version
~~~~

Make sure the version number is 2.1.0 or higher.  Older versions of the CLI
don't know how to scaffold a Next.js project.

### `fedify init` to initialize the project

Pick a directory to work in.  In this tutorial we'll call it *threadiverse*.
Run the [`fedify init`](../cli.md#fedify-init-initializing-a-fedify-project)
command with a few options so it picks all of our choices non-interactively:

~~~~ sh
fedify init -w next -p npm -k in-memory -m in-process threadiverse
~~~~

The command scaffolds a Next.js App Router project that already knows how to
serve ActivityPub.  The options mean:

 -  `-w next`: integrate with [Next.js] using
    [`@fedify/next`](../manual/integration.md).
 -  `-p npm`: use `npm` as the package manager.
 -  `-k in-memory`: keep Fedify's key–value cache in memory (good enough for
    local development).  We'll swap in a persistent store in the *Next steps*
    chapter.
 -  `-m in-process`: run Fedify's background message queue in-process instead
    of on an external broker (Redis, RabbitMQ, and so on).

> [!WARNING]
> At the time of writing, `create-next-app` (which `fedify init` runs under
> the hood) defaults to Next.js 16, but `@fedify/next` 2.1.x still requires
> Next.js 15.4 or later in the 15.x line.  After `fedify init` finishes it
> will try to run `npm install` and fail with an `ERESOLVE` error.  Open
> *package.json*, change the `next`, `react`, `react-dom`, and
> `eslint-config-next` versions so they point at Next.js 15.5.x, then run
> `npm install` again:
>
> ~~~~ json
> "dependencies": {
>   "next": "^15.5.15",
>   "react": "^19.2.4",
>   "react-dom": "^19.2.4",
>   ...
> },
> "devDependencies": {
>   ...
>   "eslint-config-next": "^15.5.15",
>   ...
> }
> ~~~~
>
> This workaround will go away once Fedify ships support for Next.js 16.

After a moment your working directory will contain something like this:

 -  *app/* — Next.js App Router pages and layouts
     -  *layout.tsx* — root layout
     -  *page.tsx* — home page
     -  *globals.css* — global stylesheet
 -  *federation/* — ActivityPub server code
     -  *index.ts* — Fedify `Federation` instance
 -  *public/* — static assets served as-is
 -  *biome.json* — formatter and linter configuration
 -  *logging.ts* — logging setup
 -  *middleware.ts* — Next.js middleware that hands federation requests off
    to Fedify
 -  *next.config.ts* — Next.js configuration
 -  *package.json* — package metadata
 -  *tsconfig.json* — TypeScript configuration

As you may have guessed, we're using [TypeScript] instead of plain JavaScript,
so every source file ends in *.ts* or *.tsx* instead of *.js*.  TypeScript is
JavaScript with type annotations, and Fedify leans heavily on those types to
guide you into writing correct ActivityPub code.  If you've never used
TypeScript before, don't worry: we'll introduce each piece of syntax the
first time we use it.

*[TSX]: TypeScript XML

[TypeScript]: https://www.typescriptlang.org/

### Checking that the dev server runs

Now let's make sure the scaffold actually runs.  From inside the *threadiverse*
directory, start the Next.js development server:

~~~~ sh
npm run dev
~~~~

The dev server will keep running until you press
<kbd>Ctrl</kbd>+<kbd>C</kbd>:

~~~~ console
  ▲ Next.js 15.5.15
  - Local:        http://localhost:3000
  - Network:      http://192.168.x.x:3000

 ✓ Starting...
 ✓ Ready in 971ms
~~~~

Open a new terminal tab and use the `fedify lookup` command to confirm that
the ActivityPub side of the server is responding:

~~~~ sh
fedify lookup http://localhost:3000/users/testuser
~~~~

You should see Fedify print out a `Person` actor with `preferredUsername`
equal to `testuser`.  That placeholder actor comes from the default
`setActorDispatcher()` call that `fedify init` generated in
*federation/index.ts*.  We'll replace it with one backed by a real database
in [Federating your user](#federating-your-user-the-person-actor).

> [!TIP]
> The dev server responds to any `/users/{identifier}` URL with a generic
> actor whose only information is the identifier itself.  That's intentional:
> it lets you verify that the ActivityPub middleware is wired up correctly
> before you have any real user data.

If you ever see an `EMFILE: too many open files` error from Next.js on
Linux, you've hit the default `fs.inotify.max_user_instances` limit.
Restarting `npm run dev` with `WATCHPACK_POLLING=true` in front of it makes
Next.js fall back to polling-based file watching and sidesteps the problem.

### Swapping ESLint for biome

The Next.js scaffold that `create-next-app` dropped into the project comes
with [ESLint] for linting, while the Fedify side of the scaffold prefers
[Biome].  `fedify init` tries to accommodate both by shipping them side by
side, but that means you have to install two tools that disagree with each
other on style.  Since Biome can do both the formatting *and* the linting we
need, let's delete ESLint and let Biome run the whole show.

Open *biome.json* and turn the linter on with the recommended rule set:

~~~~ json [biome.json]
{
  "$schema": "https://biomejs.dev/schemas/2.4.12/schema.json",
  "assist": { "actions": { "source": { "organizeImports": "on" } } },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2
  },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "files": {
    "includes": ["**", "!.next", "!node_modules", "!public"]
  }
}
~~~~

Delete the two ESLint configs:

~~~~ sh
rm eslint.config.mjs eslint.config.ts
~~~~

In *package.json*, drop the `eslint`, `eslint-config-next`, and `@fedify/lint`
packages from `devDependencies`, and rewrite the `lint` and `format` scripts
so they call Biome instead:

~~~~ json [package.json]
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "biome check",
  "format": "biome check --write"
},
~~~~

Then reinstall dependencies so the lockfile reflects the smaller dep tree:

~~~~ sh
npm install
~~~~

From now on you can format and lint the whole project with a single command:

~~~~ sh
npm run format
~~~~

Running it once right now will flag one pre-existing issue:
*federation/index.ts* imports `getLogger` from LogTape and assigns the result
to a `logger` constant, but nothing ever reads that `logger`.  Biome's
`noUnusedVariables` rule flags it.  Delete the unused import and declaration:

~~~~ typescript{2,4} [federation/index.ts]
import {
  createFederation,
  InProcessMessageQueue,
  MemoryKvStore,
} from "@fedify/fedify";
import { Person } from "@fedify/vocab";

const federation = createFederation({
  kv: new MemoryKvStore(),
  queue: new InProcessMessageQueue(),
});

federation.setActorDispatcher(
  "/users/{identifier}",
  async (ctx, identifier) => {
    return new Person({
      id: ctx.getActorUri(identifier),
      preferredUsername: identifier,
      name: identifier,
    });
  },
);

export default federation;
~~~~

We'll add logging back later when there's something worth logging.

[ESLint]: https://eslint.org/
[Biome]: https://biomejs.dev/


Layout and navigation
---------------------

Every page we build in the rest of the tutorial shares the same shell: a top
navigation bar with a brand link, a centered content area underneath it, and
a single colour palette.  We'll set that up once now so later chapters don't
have to re-specify it on every page.

Open *app/layout.tsx* and replace the `create-next-app` boilerplate with a
minimal root layout:

~~~~ tsx [app/layout.tsx]
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Threadiverse",
  description: "A small federated community platform built with Fedify.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <nav className="site-nav">
          <div className="inner">
            <Link href="/" className="brand">
              Threadiverse
            </Link>
            <ul>
              <li>
                <Link href="/">Home</Link>
              </li>
              <li>
                <Link href="/communities/new">New community</Link>
              </li>
            </ul>
          </div>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
~~~~

> [!NOTE]
> A *root layout* in the [Next.js App Router] is the top-most React tree that
> wraps every page under *app/*.  Whatever it renders shows up on every
> route.  The `children` prop is the page for the current URL, rendered in
> place.  We haven't written any pages yet besides the home page, but as soon
> as we do they'll all inherit this nav bar.

Replace *app/page.tsx* with a temporary welcome blurb.  This is the page
rendered at the root URL (`/`).  We'll revisit it in a later chapter and turn
it into the *subscribed feed* once users can follow communities:

~~~~ tsx [app/page.tsx]
export default function Home() {
  return (
    <>
      <h1>Welcome to Threadiverse</h1>
      <p>
        This is a small federated community platform built with Fedify and
        Next.js.  In the next chapters of the tutorial we'll add user
        accounts, communities, threads, replies, and votes.
      </p>
    </>
  );
}
~~~~

Next, replace the whole contents of *app/globals.css* with the small
stylesheet below.  You can copy and paste it verbatim; we won't touch CSS
again for the rest of the tutorial:

~~~~ css [app/globals.css]
:root {
  --color-bg: #fafafa;
  --color-surface: #ffffff;
  --color-border: #e5e5e5;
  --color-text: #1a1a1a;
  --color-muted: #666;
  --color-accent: #4a6cf7;
  --color-accent-hover: #3453d8;
  --radius: 6px;
  --space: 1rem;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  line-height: 1.5;
  background: var(--color-bg);
  color: var(--color-text);
}

a {
  color: var(--color-accent);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

nav.site-nav {
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  padding: 0.75rem var(--space);
}

nav.site-nav .inner {
  max-width: 800px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 1.5rem;
}

nav.site-nav .brand {
  font-weight: 700;
  font-size: 1.1rem;
  color: var(--color-text);
}

nav.site-nav ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  gap: 1rem;
  flex: 1;
}

main {
  max-width: 800px;
  margin: 0 auto;
  padding: var(--space);
}

h1,
h2,
h3 {
  margin-top: 1.5rem;
  margin-bottom: 0.5rem;
}

.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: var(--space);
  margin-bottom: var(--space);
}

.muted {
  color: var(--color-muted);
  font-size: 0.9rem;
}

label {
  display: block;
  margin-top: 0.75rem;
  font-size: 0.9rem;
  color: var(--color-muted);
}

input,
textarea {
  display: block;
  width: 100%;
  margin-top: 0.25rem;
  padding: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  font: inherit;
  background: var(--color-surface);
}

textarea {
  min-height: 6rem;
  resize: vertical;
}

button,
.button {
  display: inline-block;
  margin-top: 1rem;
  padding: 0.5rem 1rem;
  border: 0;
  border-radius: var(--radius);
  background: var(--color-accent);
  color: #fff;
  font: inherit;
  cursor: pointer;
}

button:hover,
.button:hover {
  background: var(--color-accent-hover);
  text-decoration: none;
  color: #fff;
}

.reply-tree {
  list-style: none;
  margin: 0;
  padding: 0;
}

.reply-tree .reply-tree {
  margin-left: 1.5rem;
  border-left: 2px solid var(--color-border);
  padding-left: 1rem;
}
~~~~

Finally, delete the four leftover files that `create-next-app` shipped but
we're no longer using:

~~~~ sh
rm app/page.module.css
rm public/file.svg public/globe.svg public/next.svg public/vercel.svg public/window.svg
~~~~

Reload `http://localhost:3000` in your browser.  You should see a nav bar
with a *Threadiverse* brand on the left, two links (*Home* and
*New community*), and the welcome blurb below it.  Clicking *New community*
will 404 for now; we'll build that page in the *Communities as Group actors*
chapter.

[Next.js App Router]: https://nextjs.org/docs/app


User accounts
-------------

Before we start federating anything we need *local* user accounts.  A local
user is just a row in our own database; we'll only turn those rows into
federated `Person` actors in the next chapter.  Getting accounts working
first gives us something concrete (a user, a username, a password) that the
federation layer can then point at.

### Drizzle ORM and SQLite

We'll keep data in [SQLite], the single-file embedded database.  SQLite is
ideal for a tutorial: the whole database lives in one *.sqlite3* file in your
project directory, there's no server to set up, and it's plenty fast for a
single-node app.  In production you would pick something like PostgreSQL, but
the code we'll write is almost identical; swapping databases is a matter of
changing the connection string.

To talk to SQLite we'll use [Drizzle ORM].  An ORM (*Object–Relational
Mapper*) lets you describe your tables as TypeScript values and then query
them with chained function calls instead of writing raw SQL strings.  The
benefit over raw SQL is that TypeScript understands your schema, so a typo
like `users.usernaem` is a compile error rather than a runtime mystery.

> [!NOTE]
> If you already know SQL, you'll find that Drizzle barely hides it: a
> Drizzle query reads almost word-for-word like the SQL it generates.  If
> you don't know SQL yet, that's fine; we'll introduce each piece of syntax
> the first time it appears.

[SQLite]: https://sqlite.org/
[Drizzle ORM]: https://orm.drizzle.team/

### Installing dependencies

Install Drizzle, the SQLite driver, and Drizzle's CLI:

~~~~ sh
npm install drizzle-orm better-sqlite3
npm install -D drizzle-kit @types/better-sqlite3
~~~~

The first line adds the runtime pieces: *drizzle-orm* is the query builder,
and [*better-sqlite3*] is a synchronous SQLite driver well-suited to
server-side rendering.  The second line adds Drizzle's CLI for managing the
schema, plus TypeScript types for *better-sqlite3*.

[*better-sqlite3*]: https://github.com/WiseLibs/better-sqlite3

### Declaring the `users` table

Create *db/schema.ts* and describe the first table:

~~~~ typescript [db/schema.ts]
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
~~~~

Reading the file top to bottom:

 -  `sqliteTable("users", { ... })` defines a table named `users` with four
    columns.
 -  `id` is an auto-incrementing integer primary key.
 -  `username` is a required text column with a `UNIQUE` constraint; two
    users can't share the same username.
 -  `passwordHash` is a required text column; we'll store a *hash* of the
    password, never the password itself.
 -  `createdAt` is a Unix timestamp with a SQL default of `unixepoch()`, so
    SQLite fills in the time on insert.

The two `type` exports are a Drizzle convention.  `User` is the type of a
row as it comes out of the database (every column populated).  `NewUser` is
the shape of a row ready to *insert* (so `id` and `createdAt` are optional
because they have defaults).  Using these types means you never write out
column types by hand.

> [!TIP]
> The ``sql`(unixepoch())` `` bit is a *tagged template literal*: it embeds a
> raw SQL snippet in a Drizzle schema definition.  We use it here because
> Drizzle doesn't ship a helper for SQLite's `unixepoch()` function, and
> `unixepoch()` is the simplest way to default a column to “now” in seconds.

### Opening the database

Create *db/index.ts* next.  This is the module every server-side file will
import from when it needs to query the database:

~~~~ typescript [db/index.ts]
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const sqlite = new Database("threadiverse.sqlite3");
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export * from "./schema";
~~~~

The file opens (or creates) *threadiverse.sqlite3* in the project root, sets
two pragmas that every SQLite app should set (`journal_mode = WAL` for
better concurrency, `foreign_keys = ON` so foreign-key constraints are
actually enforced), and wraps the connection with Drizzle.  The
`export * from "./schema"` re-exports every table and type so callers can
`import { db, users, type User } from "@/db"` from a single path.

### Wiring up drizzle kit

[Drizzle Kit] is Drizzle's companion CLI.  It reads your schema and either
generates migration SQL or pushes the schema directly to the database.
Create *drizzle.config.ts* at the project root:

~~~~ typescript [drizzle.config.ts]
import type { Config } from "drizzle-kit";

export default {
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: "threadiverse.sqlite3",
  },
} satisfies Config;
~~~~

Add two npm scripts to *package.json* so the CLI is a short command:

~~~~ json [package.json]
"scripts": {
  ...
  "db:push": "drizzle-kit push",
  "db:studio": "drizzle-kit studio"
}
~~~~

`db:push` synchronizes the database schema with *db/schema.ts* in one
step.  `db:studio` opens a small web UI that lets you browse the database
contents; you don't need it now, but it's handy later when debugging
federation state.

[Drizzle Kit]: https://orm.drizzle.team/docs/kit-overview

### Creating the database

Create the database file by running:

~~~~ sh
npm run db:push
~~~~

Drizzle Kit prints a short summary and exits.  You should now have a
*threadiverse.sqlite3* file in the project root with an empty `users` table
inside.

Finally, add the SQLite database file to *.gitignore* so every developer
starts from their own empty copy:

~~~~ [.gitignore]
# sqlite database (regenerated locally)
*.sqlite3
*.sqlite3-journal
*.sqlite3-wal
*.sqlite3-shm
~~~~

> [!TIP]
> Throughout the rest of the tutorial, whenever we add or change a table,
> you'll re-run `npm run db:push` to sync the change to the database.  For
> a real app you would switch to generated migration files
> (`drizzle-kit generate` followed by `drizzle-kit migrate`) so deployments are
> reproducible; push is fine for local development and for tutorials.
