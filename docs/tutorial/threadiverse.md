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
