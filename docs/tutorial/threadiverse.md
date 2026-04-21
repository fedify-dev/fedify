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

### Signup form and password hashing

Now that we have a `users` table, let's give visitors a way to create a row
in it.  We'll keep authentication minimal: a username and a password.  No
email, no email verification, no social logins; you're welcome to add any
of these as a follow-up project.

Create a helper module for password hashing first.  Passwords must never be
stored as plain text; instead, we store a one-way *hash* computed with a
deliberately slow function, [scrypt], built into Node's standard library:

~~~~ typescript [lib/auth.ts]
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LEN);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
~~~~

`hashPassword` generates a fresh 16-byte salt, runs scrypt, and returns
`salt:hash` as a single hex-encoded string.  `verifyPassword` parses that
string back out, re-runs scrypt with the same salt, and uses
`timingSafeEqual` to compare the results (a constant-time comparison that
doesn't leak timing information to attackers).  We'll call these two
functions from the signup and login server actions.

Now add the signup page itself.  In Next.js App Router a page is a React
component exported from *app/some/route/page.tsx*; when you visit
`/some/route` in the browser, Next.js renders that component on the server
and sends the resulting HTML down:

~~~~ tsx [app/signup/page.tsx]
import Link from "next/link";
import { signup } from "./actions";

type SignupPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const { error } = await searchParams;
  return (
    <>
      <h1>Sign up</h1>
      {error && <p className="muted">{error}</p>}
      <form action={signup}>
        <label>
          Username
          <input
            type="text"
            name="username"
            required
            pattern="[a-zA-Z0-9_]{2,32}"
            title="2–32 letters, digits, or underscores"
          />
        </label>
        <label>
          Password
          <input type="password" name="password" required minLength={8} />
        </label>
        <button type="submit">Create account</button>
      </form>
      <p className="muted">
        Already have an account? <Link href="/login">Log in</Link>.
      </p>
    </>
  );
}
~~~~

> [!NOTE]
> The `searchParams` prop is how an App Router page reads the query string.
> We use it to show a flash error message when something went wrong: the
> server action redirects back to `/signup?error=...`, the page receives
> `error="..."` via `searchParams`, and the template renders it above the
> form.

The `action={signup}` attribute is what turns an ordinary HTML form into a
[*server action*].  When the user clicks *Create account*, Next.js
serializes the form fields into a `FormData` object, ships it to the
server, and invokes the `signup` function there.  No client-side fetch, no
JSON endpoint, no API route, no `onSubmit` handler needed.

Write that server action in a sibling file.  The `"use server"` directive
at the top marks every exported function as a server action that's callable
from client components and from `<form action>`:

~~~~ typescript [app/signup/actions.ts]
"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, users } from "@/db";
import { hashPassword } from "@/lib/auth";

export async function signup(formData: FormData): Promise<void> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!/^[a-zA-Z0-9_]{2,32}$/.test(username)) {
    redirect("/signup?error=Invalid+username");
  }
  if (password.length < 8) {
    redirect("/signup?error=Password+must+be+at+least+8+characters");
  }

  const existing = db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .get();
  if (existing) {
    redirect("/signup?error=Username+already+taken");
  }

  const passwordHash = await hashPassword(password);
  db.insert(users).values({ username, passwordHash }).run();

  redirect("/login?message=Account+created,+please+log+in");
}
~~~~

The action re-validates the input server-side (browsers can skip HTML
validation, so we can't trust `pattern="..."` alone), checks that the
username isn't already taken by querying the table with
`db.select(...).where(eq(users.username, username)).get()`, hashes the
password, inserts the row with `db.insert(users).values({...}).run()`, and
redirects to the login page with a success message.

> [!TIP]
> The `eq()` helper from `drizzle-orm` builds an SQL equality comparison.
> Drizzle has a whole set of comparison helpers (`and`, `or`, `inArray`,
> `gt`, `lt`, …).  They compose by nesting, so you can write something
> like `and(eq(users.id, 42), gt(users.createdAt, lastWeek))` for more
> complex `WHERE` clauses.

Open `http://localhost:3000/signup` in the browser and you should see the
form:

![Screenshot: the signup form](./threadiverse/signup-form.png)

Fill in a username and password and click *Create account*.  The browser
will redirect to `/login?message=...`, which currently 404s because we
haven't built the login page yet.  That's fine; the signup half of the
flow worked, and the row is in the database.  We'll verify that, and build
the login half, in the next section.

[scrypt]: https://en.wikipedia.org/wiki/Scrypt
[*server action*]: https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations

### Login and sessions

A user who signed up last section ended up at a `/login` URL that doesn't
exist yet.  Let's build login and cookie-based sessions so the account is
usable.

There are lots of ways to do session management in a web app.  We'll use the
simplest one that's safe for our purposes: a server-side `sessions` table
keyed by an opaque random token, and an HTTP-only cookie that stores just
that token.  The browser never sees the user ID or any other data; when a
request comes in, we look the token up in the database to find the user it
belongs to.  This keeps the cookie cheap to invalidate (delete the row, the
cookie becomes useless) and means we don't need to pick or rotate a cookie
signing secret.

Add the table to *db/schema.ts*:

~~~~ typescript{16-27} [db/schema.ts]
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

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Session = typeof sessions.$inferSelect;
~~~~

`onDelete: "cascade"` on the `userId` reference means that deleting a user
automatically deletes their sessions too, so there are no dangling rows.

Re-run the schema sync:

~~~~ sh
npm run db:push
~~~~

Install the `server-only` package so that importing server-side code from a
client component fails at build time instead of leaking secrets:

~~~~ sh
npm install -D server-only
~~~~

Now write the session helpers.  Create *lib/session.ts*:

~~~~ typescript [lib/session.ts]
import "server-only";

import { randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { db, sessions, type User, users } from "@/db";

const COOKIE_NAME = "session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export async function createSession(userId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + MAX_AGE_SECONDS * 1000);
  db.insert(sessions).values({ token, userId, expiresAt }).run();
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const row = db
    .select()
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .get();
  return row?.users ?? null;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) {
    db.delete(sessions).where(eq(sessions.token, token)).run();
  }
  store.delete(COOKIE_NAME);
}
~~~~

A few notes:

 -  `randomBytes(32).toString("base64url")` produces a 43-character
    URL-safe random string.  That's our session token.
 -  `httpOnly: true` hides the cookie from JavaScript running in the page
    and rules out a whole class of cross-site scripting attacks.
 -  `sameSite: "lax"` means the cookie is included on top-level cross-site
    navigations but not on cross-site embeds, which keeps CSRF exposure
    small for our purposes.
 -  `secure: process.env.NODE_ENV === "production"` sets the `Secure` flag
    in production (the browser will only send the cookie over HTTPS) but
    leaves it off in development so you can log in over `http://localhost`.
 -  The join in `getCurrentUser` does `sessions ⨝ users ON user_id`, and
    the `where` filters out expired rows so we don't treat them as valid.

Now the login page.  Create *app/login/page.tsx*:

~~~~ tsx [app/login/page.tsx]
import Link from "next/link";
import { login } from "./actions";

type LoginPageProps = {
  searchParams: Promise<{ error?: string; message?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error, message } = await searchParams;
  return (
    <>
      <h1>Log in</h1>
      {message && <p className="muted">{message}</p>}
      {error && <p className="muted">{error}</p>}
      <form action={login}>
        <label>
          Username
          <input type="text" name="username" required />
        </label>
        <label>
          Password
          <input type="password" name="password" required />
        </label>
        <button type="submit">Log in</button>
      </form>
      <p className="muted">
        Need an account? <Link href="/signup">Sign up</Link>.
      </p>
    </>
  );
}
~~~~

And the login and logout server actions in *app/login/actions.ts*:

~~~~ typescript [app/login/actions.ts]
"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, users } from "@/db";
import { verifyPassword } from "@/lib/auth";
import { createSession, destroySession } from "@/lib/session";

export async function login(formData: FormData): Promise<void> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const user = db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .get();
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    redirect("/login?error=Invalid+username+or+password");
  }

  await createSession(user.id);
  redirect("/");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/");
}
~~~~

Finally, change the root layout into an async server component so that
every page knows whether a user is signed in.  Replace *app/layout.tsx*
with:

~~~~ tsx{3-4,15,16,35-47} [app/layout.tsx]
import type { Metadata } from "next";
import Link from "next/link";
import { logout } from "./login/actions";
import "./globals.css";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Threadiverse",
  description: "A small federated community platform built with Fedify.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentUser();
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
            {user ? (
              <form action={logout} className="session-controls">
                <span className="muted">@{user.username}</span>
                <button type="submit" className="link-button">
                  Log out
                </button>
              </form>
            ) : (
              <div className="session-controls">
                <Link href="/login">Log in</Link>
                <Link href="/signup">Sign up</Link>
              </div>
            )}
          </div>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
~~~~

Append a few more lines to *app/globals.css* for the new nav elements:

~~~~ css [app/globals.css]
nav.site-nav .session-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 0;
}

nav.site-nav .link-button {
  margin: 0;
  padding: 0;
  background: transparent;
  color: var(--color-accent);
  border: 0;
  cursor: pointer;
  font: inherit;
}

nav.site-nav .link-button:hover {
  background: transparent;
  color: var(--color-accent-hover);
  text-decoration: underline;
}
~~~~

Reload `/signup`, create an account, and you'll now land on a working
login page.  Sign in with the same credentials and the nav bar flips over
to show `@yourusername` and a *Log out* button:

![Screenshot: the home page after logging in](./threadiverse/home-logged-in.png)

Clicking *Log out* submits the logout action, which deletes the session
row and clears the cookie, and the nav bar flips back to *Log in / Sign
up*.

> [!TIP]
> You can inspect the cookie with your browser's developer tools (usually
> under *Application → Cookies*).  You should see a `session` cookie whose
> value is the same 43-character token as the `token` column of the
> `sessions` table.

### Profile page

Every user needs a page to call their own.  For now we'll keep it simple:
URL path, display name, join date.  Create *app/users/\[username]/page.tsx*:

~~~~ tsx [app/users/[username]/page.tsx]
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, users } from "@/db";

type ProfilePageProps = {
  params: Promise<{ username: string }>;
};

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { username } = await params;
  const user = db
    .select({
      id: users.id,
      username: users.username,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.username, username))
    .get();
  if (!user) notFound();
  return (
    <>
      <h1>@{user.username}</h1>
      <p className="muted">
        Joined{" "}
        {user.createdAt.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      </p>
      <p>Threads and replies by this user will appear here.</p>
    </>
  );
}
~~~~

A few things to notice:

 -  The square brackets in the folder name `[username]` make `username`
    a *dynamic segment*.  The Next.js router will match any path of the
    form `/users/<something>` and pass that `something` as
    `params.username`.
 -  `params` is a Promise in recent versions of Next.js, so we `await` it
    before destructuring.
 -  `notFound()` aborts rendering and shows the nearest `not-found.tsx`
    (or, if there isn't one, the default 404 page).

While we're here, turn the `@username` label in the nav bar into a link
that points to the current user's profile.  In *app/layout.tsx*, replace
the `<span>` with a `<Link>`:

~~~~ tsx{2} [app/layout.tsx]
<form action={logout} className="session-controls">
  <Link href={`/users/${user.username}`}>@{user.username}</Link>
  <button type="submit" className="link-button">
    Log out
  </button>
</form>
~~~~

Reload and visit `/users/alice` (or whatever username you signed up with).
You should see something like this:

![Screenshot: the user profile page](./threadiverse/profile-page.png)

The same URL right now, when you open it with a browser, renders the HTML
page above.  But if a fediverse server asks for it with an
`Accept: application/activity+json` header, Fedify's middleware intercepts
the request and returns the default placeholder `Person` actor we saw
earlier.  In the next chapter we'll swap that placeholder for a proper
actor backed by our `users` table, so searching `@alice@<your-host>` in
Mastodon or Lemmy actually finds the account we just created.


Federating your user: the person actor
--------------------------------------

All the pieces we've built so far have been local.  In this chapter we turn
a local user into a *federated* `Person` actor: a server-side entity that
other fediverse software can look up by handle, send follow requests to,
and verify signatures from.  This is the first chapter where ActivityPub
itself shows up.

### The keys table

Every federated actor needs a pair of cryptographic keys.  HTTP Signatures,
the scheme that authenticates server-to-server requests, uses an RSA key.
[Object Integrity Proofs] (sometimes called *LD Signatures* or *FEP-8b32*)
use an Ed25519 key.  We'll generate one of each per actor and store both.

Open *db/schema.ts* and add a `keys` table:

~~~~ typescript{3-8,30-48} [db/schema.ts]
import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Session = typeof sessions.$inferSelect;

export const keys = sqliteTable(
  "keys",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actorIdentifier: text("actor_identifier").notNull(),
    type: text("type", { enum: ["RSASSA-PKCS1-v1_5", "Ed25519"] }).notNull(),
    privateKey: text("private_key").notNull(),
    publicKey: text("public_key").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex("keys_actor_type_idx").on(table.actorIdentifier, table.type),
  ],
);

export type Key = typeof keys.$inferSelect;
~~~~

A couple of things about this schema worth calling out:

 -  `actorIdentifier` is a plain string rather than a foreign key to a
    specific table.  That's deliberate: in the next chapter we'll add a
    second kind of actor (communities, i.e. `Group` actors).  Keeping
    keys keyed by identifier lets the same table serve both user and
    community keys without a schema change.
 -  The `type` column uses Drizzle's `enum` option, which in Drizzle +
    SQLite produces a `CHECK` constraint that rejects rows whose `type`
    isn't one of the two values we listed.
 -  The composite unique index `(actor_identifier, type)` makes sure
    each actor has at most one key of each algorithm.

Apply the schema change:

~~~~ sh
npm run db:push
~~~~

[Object Integrity Proofs]: https://www.w3.org/TR/vc-data-integrity/

### Actor dispatcher and key pairs dispatcher

Now rewrite *federation/index.ts* to replace the placeholder `Person` that
`fedify init` left behind with a real one backed by the database:

~~~~ typescript [federation/index.ts]
import {
  createFederation,
  exportJwk,
  generateCryptoKeyPair,
  importJwk,
  InProcessMessageQueue,
  MemoryKvStore,
} from "@fedify/fedify";
import { Endpoints, Person } from "@fedify/vocab";
import { and, eq } from "drizzle-orm";
import { db, keys, users } from "@/db";

const federation = createFederation({
  kv: new MemoryKvStore(),
  queue: new InProcessMessageQueue(),
});

federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    const user = db
      .select()
      .from(users)
      .where(eq(users.username, identifier))
      .get();
    if (!user) return null;

    const keyPairs = await ctx.getActorKeyPairs(identifier);
    return new Person({
      id: ctx.getActorUri(identifier),
      preferredUsername: identifier,
      name: identifier,
      inbox: ctx.getInboxUri(identifier),
      endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
      url: new URL(`/users/${identifier}`, ctx.url),
      publicKey: keyPairs[0]?.cryptographicKey,
      assertionMethods: keyPairs.map((k) => k.multikey),
    });
  })
  .setKeyPairsDispatcher(async (_ctx, identifier) => {
    const user = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, identifier))
      .get();
    if (!user) return [];

    const pairs: CryptoKeyPair[] = [];
    for (const keyType of ["RSASSA-PKCS1-v1_5", "Ed25519"] as const) {
      const existing = db
        .select()
        .from(keys)
        .where(
          and(eq(keys.actorIdentifier, identifier), eq(keys.type, keyType)),
        )
        .get();
      if (existing) {
        pairs.push({
          privateKey: await importJwk(
            JSON.parse(existing.privateKey),
            "private",
          ),
          publicKey: await importJwk(JSON.parse(existing.publicKey), "public"),
        });
      } else {
        const pair = await generateCryptoKeyPair(keyType);
        db.insert(keys)
          .values({
            actorIdentifier: identifier,
            type: keyType,
            privateKey: JSON.stringify(await exportJwk(pair.privateKey)),
            publicKey: JSON.stringify(await exportJwk(pair.publicKey)),
          })
          .run();
        pairs.push(pair);
      }
    }
    return pairs;
  });

federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");

export default federation;
~~~~

A walk-through of what changed:

 -  `setActorDispatcher` is the hook Fedify calls whenever an
    ActivityPub client wants a specific actor.  The `path` argument is
    the URL template the actor lives at (`/users/{identifier}`), and
    the callback returns an actor object or `null` for “no such actor”.
    Returning `null` makes Fedify respond with an HTTP 404.
 -  `ctx.getActorKeyPairs(identifier)` is how the dispatcher gets the
    actor's keys in the right format.  It calls our
    `setKeyPairsDispatcher` internally, wraps each pair with metadata
    that Fedify needs, and caches the result.  The returned
    `keyPairs[0]` is always the RSA pair, which is what `publicKey`
    wants; `keyPairs.map((k) => k.multikey)` produces the `Multikey`
    array that goes into `assertionMethods` for FEP-8b32 verification.
 -  `new Endpoints({ sharedInbox: ctx.getInboxUri() })` advertises a
    single *shared inbox* URL the actor is reachable through.  Large
    fediverse servers use the shared inbox to deliver one copy of an
    activity to many followers on the same host.
 -  `setKeyPairsDispatcher` is the hook that reads (or lazily creates)
    the two key pairs for an actor.  The first time you look up an
    actor, both keys are missing and we generate them; every subsequent
    lookup returns the stored pair.
 -  `setInboxListeners` registers the URL template Fedify should use
    for the per-actor inbox and the path for the shared inbox.  We
    haven't attached any `on(Activity, ...)` handlers yet, so the
    inbox accepts no activities for now; we'll add those in later
    chapters.  But registering the paths is what lets
    `ctx.getInboxUri()` resolve in the actor dispatcher above.

> [!TIP]
> Fedify's inbox and actor URLs are derived from the templates you pass
> to `setActorDispatcher` and `setInboxListeners`.  If you later want to
> change the URL scheme (for example from `/users/{identifier}` to
> `/u/{identifier}`), you only have to change the template; everything
> that calls `ctx.getActorUri(identifier)` or `ctx.getInboxUri(identifier)`
> follows along.

### Verifying locally

Start (or restart) the dev server with `npm run dev` and sign up if you
haven't already.  Then in a second terminal, ask Fedify to look up the
actor:

~~~~ sh
fedify lookup http://localhost:3000/users/alice
~~~~

You should see output that starts like this:

~~~~ console
Person {
  id: URL 'http://localhost:3000/users/alice',
  preferredUsername: 'alice',
  name: 'alice',
  inbox: URL 'http://localhost:3000/users/alice/inbox',
  ...
  publicKey: CryptographicKey { ... },
  assertionMethods: [ Multikey { ... }, Multikey { ... } ],
}
~~~~

Check the WebFinger endpoint directly too:

~~~~ sh
curl -H 'Accept: application/jrd+json' \
  "http://localhost:3000/.well-known/webfinger?resource=acct:alice@localhost:3000"
~~~~

The response is a JRD document pointing `rel="self"` at the actor URL:

~~~~ json
{
  "subject": "acct:alice@localhost:3000",
  "aliases": ["http://localhost:3000/users/alice"],
  "links": [
    { "rel": "self", "href": "http://localhost:3000/users/alice",
      "type": "application/activity+json" },
    { "rel": "http://webfinger.net/rel/profile-page",
      "href": "http://localhost:3000/users/alice" }
  ]
}
~~~~

Peek at the database too: every time the dispatcher runs for a user
with no stored keys, two rows appear in the `keys` table, one with
`type = "RSASSA-PKCS1-v1_5"` and one with `type = "Ed25519"`.

### Letting the wider fediverse see your actor

Right now the actor is reachable only at `http://localhost:3000`, and no
remote server can verify a connection to `localhost`.  To let an outside
server discover this actor we need two things: a reverse proxy, and a
bit of code that tells Fedify to trust the `Host` and `Proto` that the
proxy forwards in.

#### Running the tunnel

Fedify ships a convenience command, `fedify tunnel`, that wraps [Serveo]
to give you a free public HTTPS URL pointing at a local port.  In a new
terminal, run:

~~~~ sh
fedify tunnel 3000
~~~~

After a few seconds the command prints a line like:

~~~~ console
✔ Your local server is now publicly accessible:

  https://<random-subdomain>.serveo.net

Press ^C to stop the server.
~~~~

Leave that terminal running as long as you want the public URL to exist.

> [!WARNING]
> Tunnel services come and go, and occasionally a given provider is
> unavailable or drops your session silently after a few minutes of
> idle traffic.  If `fedify tunnel` hangs on *Creating a secure tunnel*
> or your tunnel URL stops responding, the easiest workaround is to
> restart the command (or fall back to [cloudflared] or [ngrok]).  The
> URL usually changes on restart, so expect to re-paste it anywhere
> you typed it in.

#### Honouring X-forwarded-\* headers

When a request comes in through a tunnel, Next.js sees the tunnel as a
reverse proxy.  The real public host is in the `X-Forwarded-Host` and
`X-Forwarded-Proto` headers; the `Host` header itself says `localhost:3000`.
Without any changes Fedify builds its actor URLs from `Host`, so remote
servers see `https://localhost:3000/users/alice` and can't fetch it.

Fix this by wrapping the request with [*x-forwarded-fetch*] inside the
middleware.  Install the package first:

~~~~ sh
npm install x-forwarded-fetch
~~~~

Then rewrite *middleware.ts*:

~~~~ typescript [middleware.ts]
import { integrateFederation, isFederationRequest } from "@fedify/next";
import { NextResponse } from "next/server";
import { getXForwardedRequest } from "x-forwarded-fetch";
import federation from "./federation";

const federationHandler = integrateFederation(federation);

export default async function middleware(request: Request) {
  const forwarded = await getXForwardedRequest(request);
  if (isFederationRequest(forwarded)) {
    return await federationHandler(forwarded);
  }
  return NextResponse.next();
}

export const config = {
  runtime: "nodejs",
  matcher: [
    {
      source: "/:path*",
      has: [
        {
          type: "header",
          key: "Accept",
          value: ".*application\\/((jrd|activity|ld)\\+json|xrd\\+xml).*",
        },
      ],
    },
    {
      source: "/:path*",
      has: [
        {
          type: "header",
          key: "content-type",
          value: ".*application\\/((jrd|activity|ld)\\+json|xrd\\+xml).*",
        },
      ],
    },
    { source: "/.well-known/nodeinfo" },
    { source: "/.well-known/x-nodeinfo2" },
  ],
};
~~~~

`getXForwardedRequest()` returns a new `Request` whose `url`, `protocol`,
and `host` reflect `X-Forwarded-*` headers when they're present.  We then
pass that rewritten request through to either Fedify (if it's an ActivityPub
or NodeInfo request) or the normal Next.js pipeline.

> [!WARNING]
> Only call `getXForwardedRequest()` when you know that every HTTP request
> reaches your app through a trusted proxy.  If your server also serves
> requests directly from the public internet, a malicious client can
> set its own `X-Forwarded-Host` and impersonate any domain.

#### Searching from the academy

With the tunnel running and the middleware fixed, fetch your actor
through the public URL to confirm the IDs now match the tunnel host:

~~~~ sh
curl -H 'Accept: application/activity+json' \
  https://<your-tunnel>.serveo.net/users/alice
~~~~

The JSON's `id`, `inbox`, and `endpoints.sharedInbox` should all say
`https://<your-tunnel>.serveo.net/...`, not `http://localhost:3000/...`.

Next, open [ActivityPub.Academy] — a throwaway Mastodon instance the
fediverse community runs for exactly this kind of testing — in a browser.
Sign up for a temporary account, then paste `@alice@<your-tunnel>.serveo.net`
into the search box:

![Screenshot: the academy found @alice via WebFinger](./threadiverse/academy-search-alice.png)

Academy looks your account up via WebFinger, fetches the actor JSON, and
shows it as a result.  That's all we need from Ch. 8: the wider
fediverse can now *see* the user we created.  In the Community chapters
we'll pair this with a Follow handler so the academy (and other servers)
can actually subscribe.

[Serveo]: https://serveo.net/
[cloudflared]: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
[ngrok]: https://ngrok.com/
[*x-forwarded-fetch*]: https://github.com/dahlia/x-forwarded-fetch
[ActivityPub.Academy]: https://activitypub.academy/


Communities as group actors
---------------------------

In the threadiverse, the unit of organisation is the *community*: a topic
bucket that local and remote users can subscribe to, post threads into, and
reply inside.  Every community is itself an actor, just like a user, but
represented as a [`Group`] in ActivityPub.  This chapter adds communities
to the local database, gives them a UI, and teaches Fedify to serve them
as `Group` actors alongside the `Person` actors we already have.

[`Group`]: ../manual/pragmatics.md#group

### The `communities` table

Add a new table to *db/schema.ts*:

~~~~ typescript [db/schema.ts]
export const communities = sqliteTable("communities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  creatorId: integer("creator_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Community = typeof communities.$inferSelect;
export type NewCommunity = typeof communities.$inferInsert;
~~~~

`slug` is the machine-readable identifier, the part that appears in URLs
and in the federated handle `!slug@host`.  `name` is the human-readable
title, displayed to users.  `creator_id` is a foreign key to the local
user who opened the community.

Apply it:

~~~~ sh
npm run db:push
~~~~

### Shared identifier namespace

Fedify's `setActorDispatcher` registers exactly one URL template per
`Federation` instance.  The scaffold uses `/users/{identifier}` for
`Person` actors, and we'll reuse the same template for `Group` actors
too, because Fedify routes every actor through the same dispatcher.

That means a username like `alice` and a community slug like `alice`
can't both exist: when someone fetches `/users/alice`, the dispatcher
has to pick *one* interpretation.  Put the uniqueness check in a
helper so signup and community creation can share it.  Create
*lib/identifiers.ts*:

~~~~ typescript [lib/identifiers.ts]
import "server-only";

import { eq } from "drizzle-orm";
import { communities, db, users } from "@/db";

export const IDENTIFIER_PATTERN = /^[a-zA-Z0-9_]{2,32}$/;

export function isValidIdentifier(identifier: string): boolean {
  return IDENTIFIER_PATTERN.test(identifier);
}

export function isIdentifierTaken(identifier: string): boolean {
  const user = db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, identifier))
    .get();
  if (user) return true;
  const community = db
    .select({ id: communities.id })
    .from(communities)
    .where(eq(communities.slug, identifier))
    .get();
  return community != null;
}
~~~~

Then rewrite the signup action to consult it (replace the hand-rolled
regex and the direct user lookup):

~~~~ typescript{5,10,13} [app/signup/actions.ts]
"use server";

import { redirect } from "next/navigation";
import { db, users } from "@/db";
import { hashPassword } from "@/lib/auth";
import { isIdentifierTaken, isValidIdentifier } from "@/lib/identifiers";

export async function signup(formData: FormData): Promise<void> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!isValidIdentifier(username)) {
    redirect("/signup?error=Invalid+username");
  }
  if (password.length < 8) {
    redirect("/signup?error=Password+must+be+at+least+8+characters");
  }
  if (isIdentifierTaken(username)) {
    redirect("/signup?error=Username+already+taken");
  }

  const passwordHash = await hashPassword(password);
  db.insert(users).values({ username, passwordHash }).run();

  redirect("/login?message=Account+created,+please+log+in");
}
~~~~

### Community creation form

Create *app/communities/new/page.tsx*.  It's an async server component
that redirects anonymous visitors to `/login` and otherwise renders a
slug + name + description form:

~~~~ tsx [app/communities/new/page.tsx]
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { createCommunity } from "./actions";

type NewCommunityPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function NewCommunityPage({
  searchParams,
}: NewCommunityPageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?message=Log+in+to+create+a+community");
  const { error } = await searchParams;
  return (
    <>
      <h1>Create a community</h1>
      <p className="muted">
        You are opening this community as <strong>@{user.username}</strong>.
      </p>
      {error && <p className="muted">{error}</p>}
      <form action={createCommunity}>
        <label>
          Slug
          <input
            type="text"
            name="slug"
            required
            pattern="[a-zA-Z0-9_]{2,32}"
            title="2–32 letters, digits, or underscores"
          />
        </label>
        <label>
          Name
          <input type="text" name="name" required maxLength={64} />
        </label>
        <label>
          Description
          <textarea name="description" maxLength={500} />
        </label>
        <button type="submit">Create community</button>
      </form>
      <p className="muted">
        The slug becomes the community's federated handle, e.g.{" "}
        <code>!slug@your-host</code>.
      </p>
    </>
  );
}
~~~~

And the server action in *app/communities/new/actions.ts*:

~~~~ typescript [app/communities/new/actions.ts]
"use server";

import { redirect } from "next/navigation";
import { communities, db } from "@/db";
import { isIdentifierTaken, isValidIdentifier } from "@/lib/identifiers";
import { getCurrentUser } from "@/lib/session";

export async function createCommunity(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?message=Log+in+to+create+a+community");

  const slug = String(formData.get("slug") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!isValidIdentifier(slug)) {
    redirect("/communities/new?error=Invalid+slug");
  }
  if (!name) {
    redirect("/communities/new?error=Name+is+required");
  }
  if (isIdentifierTaken(slug)) {
    redirect(
      `/communities/new?error=${encodeURIComponent(
        "Slug is already taken by a user or another community",
      )}`,
    );
  }

  db.insert(communities)
    .values({ slug, name, description, creatorId: user.id })
    .run();

  redirect(`/users/${slug}`);
}
~~~~

The action re-checks the session (never trust that a client-side
redirect ran), validates the slug and name, ensures the slug doesn't
collide with a username or another community, inserts the row, and
redirects to the community's URL.

Log in, open `http://localhost:3000/communities/new`, and fill the
form:

![Screenshot: the new-community form](./threadiverse/new-community-form.png)

Submitting redirects to `/users/<slug>`, which 404s for now; the
profile page only knows about users.  The next section fixes that.

### Rendering the community page

Teach the profile page to fall through to `communities` when the
identifier doesn't match a user.  Rewrite *app/users/\[username]/page.tsx*:

~~~~ tsx [app/users/[username]/page.tsx]
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { communities, db, users } from "@/db";

type ProfilePageProps = {
  params: Promise<{ username: string }>;
};

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { username: identifier } = await params;

  const user = db
    .select({
      id: users.id,
      username: users.username,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.username, identifier))
    .get();
  if (user) {
    return (
      <>
        <h1>@{user.username}</h1>
        <p className="muted">
          Joined{" "}
          {user.createdAt.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
        <p>Threads and replies by this user will appear here.</p>
      </>
    );
  }

  const community = db
    .select()
    .from(communities)
    .where(eq(communities.slug, identifier))
    .get();
  if (community) {
    return (
      <>
        <h1>!{community.slug}</h1>
        <h2 style={{ fontWeight: "normal", marginTop: 0 }}>{community.name}</h2>
        {community.description && <p>{community.description}</p>}
        <p className="muted">
          Created{" "}
          {community.createdAt.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
        <p>Threads posted in this community will appear here.</p>
      </>
    );
  }

  notFound();
}
~~~~

Reload `/users/<slug>` after creating a community and the page now
renders the community's slug, name, description, and a placeholder
for future threads:

![Screenshot: the community page](./threadiverse/community-page.png)

### The `Group` actor dispatcher

Now the federation side.  Teach the actor dispatcher to return a
`Group` when the identifier belongs to a community, and extend the
key pairs dispatcher so community slugs also get lazily generated
keys.  Replace the body of *federation/index.ts* with:

~~~~ typescript [federation/index.ts]
import {
  createFederation,
  exportJwk,
  generateCryptoKeyPair,
  importJwk,
  InProcessMessageQueue,
  MemoryKvStore,
} from "@fedify/fedify";
import { Endpoints, Group, Person } from "@fedify/vocab";
import { and, eq } from "drizzle-orm";
import { communities, db, keys, users } from "@/db";

const federation = createFederation({
  kv: new MemoryKvStore(),
  queue: new InProcessMessageQueue(),
});

federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    const user = db
      .select()
      .from(users)
      .where(eq(users.username, identifier))
      .get();
    if (user) {
      const keyPairs = await ctx.getActorKeyPairs(identifier);
      return new Person({
        id: ctx.getActorUri(identifier),
        preferredUsername: identifier,
        name: identifier,
        inbox: ctx.getInboxUri(identifier),
        endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
        url: new URL(`/users/${identifier}`, ctx.url),
        publicKey: keyPairs[0]?.cryptographicKey,
        assertionMethods: keyPairs.map((k) => k.multikey),
      });
    }

    const community = db
      .select()
      .from(communities)
      .where(eq(communities.slug, identifier))
      .get();
    if (community) {
      const keyPairs = await ctx.getActorKeyPairs(identifier);
      return new Group({
        id: ctx.getActorUri(identifier),
        preferredUsername: identifier,
        name: community.name,
        summary: community.description || undefined,
        inbox: ctx.getInboxUri(identifier),
        endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
        url: new URL(`/users/${identifier}`, ctx.url),
        publicKey: keyPairs[0]?.cryptographicKey,
        assertionMethods: keyPairs.map((k) => k.multikey),
      });
    }

    return null;
  })
  .setKeyPairsDispatcher(async (_ctx, identifier) => {
    const user = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, identifier))
      .get();
    const community = user
      ? null
      : db
          .select({ id: communities.id })
          .from(communities)
          .where(eq(communities.slug, identifier))
          .get();
    if (!user && !community) return [];

    const pairs: CryptoKeyPair[] = [];
    for (const keyType of ["RSASSA-PKCS1-v1_5", "Ed25519"] as const) {
      const existing = db
        .select()
        .from(keys)
        .where(
          and(eq(keys.actorIdentifier, identifier), eq(keys.type, keyType)),
        )
        .get();
      if (existing) {
        pairs.push({
          privateKey: await importJwk(
            JSON.parse(existing.privateKey),
            "private",
          ),
          publicKey: await importJwk(JSON.parse(existing.publicKey), "public"),
        });
      } else {
        const pair = await generateCryptoKeyPair(keyType);
        db.insert(keys)
          .values({
            actorIdentifier: identifier,
            type: keyType,
            privateKey: JSON.stringify(await exportJwk(pair.privateKey)),
            publicKey: JSON.stringify(await exportJwk(pair.publicKey)),
          })
          .run();
        pairs.push(pair);
      }
    }
    return pairs;
  });

federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");

export default federation;
~~~~

Two dispatchers, one URL template, two actor types.

### Testing the group federation

Bring up `fedify tunnel 3000` again if you stopped it, and with the
tunnel URL fresh, fetch the community actor:

~~~~ sh
curl -H 'Accept: application/activity+json' \
  https://<your-tunnel>/users/pictures | jq '.type, .name, .preferredUsername'
~~~~

The response says `"type": "Group"`, `"name": "Pictures"`,
`"preferredUsername": "pictures"`.

Paste `@pictures@<your-tunnel>` into ActivityPub.Academy's search box
and the community shows up, just like a user did in the last chapter:

![Screenshot: the academy found @pictures via WebFinger](./threadiverse/academy-search-community.png)

Academy, like Mastodon, calls this a *group* in its UI.  Threadiverse
software that speaks the same protocol (Lemmy, Mbin, NodeBB) will
recognise it as a community they can subscribe to.  In the next two
sections we'll add the follow half of the story: receiving and
accepting Follow requests.
