---
description: >-
  In this tutorial, we will build a small Pixelfed-style federated image
  sharing service on top of Nuxt and Fedify, an ActivityPub server framework.
  The focus is on learning Fedify rather than Nuxt, and the result will
  federate with Mastodon, Pixelfed, and any other ActivityPub software.
---

Creating a federated image sharing service
==========================================

In this tutorial we will build a small federated image sharing service,
similar to [Pixelfed] or, in a way, to [Instagram] with the locks blown off,
using [Nuxt] on the client and server side and [Fedify] for everything
ActivityPub.  The goal is to learn Fedify rather than Nuxt, but a brief tour
of Nuxt's building blocks is included so that a reader with only vanilla
JavaScript experience can follow along.

If you have any questions, suggestions, or feedback, please feel free to join
our [Matrix chat space] or [GitHub Discussions].

[Pixelfed]: https://pixelfed.org/
[Instagram]: https://instagram.com/
[Nuxt]: https://nuxt.com/
[Fedify]: https://fedify.dev/
[Matrix chat space]: https://matrix.to/#/#fedify:matrix.org
[GitHub Discussions]: https://github.com/fedify-dev/fedify/discussions


Target audience
---------------

This tutorial is aimed at web developers who want to learn Fedify and try
their hand at building federated software.

We assume you have some experience building small web applications with HTML
and JavaScript, and that you are comfortable with a terminal.  You do *not*
need to know TypeScript, Vue, Nuxt, SQL, ActivityPub, or Fedify.  We will teach
just enough of each along the way.

You don't need experience creating ActivityPub software, but we do assume
that you have used at least one fediverse service, like [Mastodon], [Pixelfed],
or [Misskey], so you have a feel for what we are trying to build.

If you have already worked through the [*Creating your own federated
microblog*](./microblog.md) tutorial, you will find many of the concepts
familiar.  This tutorial treads similar ground but swaps Hono and JSX for
Nuxt and Vue, and focuses on image posts instead of text posts.  The two
tutorials are designed to complement each other rather than stack on top,
so you can read them in either order.

[Mastodon]: https://joinmastodon.org/
[Misskey]: https://misskey-hub.net/


Goals
-----

We will end up with a single-user image sharing service that can talk to the
rest of the fediverse via ActivityPub.  Its features are:

 -  Only one account can be created on the instance.
 -  Other accounts in the fediverse can follow the local user.
 -  Followers can unfollow the local user.
 -  The user can view their list of followers.
 -  The user can upload image posts with captions.
 -  Posts published by the user fan out to their followers' timelines.
 -  The user can follow other accounts in the fediverse.
 -  The user can view the accounts they are following.
 -  The user sees a chronological home timeline of posts from accounts they
    follow.
 -  The user can like posts, and likes coming from remote actors are recorded.
 -  The user can leave comments on posts, and replies coming from remote
    actors are recorded.

To keep the tutorial focused, we impose these constraints:

 -  Each post has exactly one image; no carousels.
 -  Account profiles (bio, profile picture) cannot be edited.
 -  Posts cannot be edited or deleted once published.
 -  No boosts (reposts), no direct messages, no search.
 -  No pagination.
 -  No authentication: whoever opens the browser first owns the instance.

You are encouraged to add any of these features yourself after finishing the
tutorial.  The closing chapter lists a few natural extensions as a starting
point.

The full source code is available in the [GitHub repository], with one commit
per tutorial chapter so you can follow along by checking out the commit that
matches the chapter you are reading.

[GitHub repository]: https://github.com/fedify-dev/content-sharing


Setting up the development environment
--------------------------------------

### Installing Node.js

Fedify supports three JavaScript runtimes: [Deno], [Bun], and [Node.js].
Among the three, Node.js is the most widely used, and Nuxt targets Node.js
by default, so that is what we will use.

> [!TIP]
> A JavaScript runtime is a platform that executes JavaScript code outside
> a web browser.  Node.js is the most widely used one for server applications
> and command-line tools.  Nuxt runs on top of Node.js (it also runs on Bun
> and Deno, but Node.js gives the smoothest experience).

To use Fedify 2.2.0 and Nuxt 4, you need Node.js 22.0.0 or higher.  There
are [various installation methods]; pick the one that suits your system.

Once Node.js is installed, the `node` and `npm` commands become available:

~~~~ sh
node --version
npm --version
~~~~

[Deno]: https://deno.com/
[Bun]: https://bun.sh/
[Node.js]: https://nodejs.org/
[various installation methods]: https://nodejs.org/en/download/package-manager

### Installing the `fedify` command

To scaffold a Fedify project, install the [`fedify`](../cli.md) command on
your system.  There are [several installation methods](../cli.md#installation),
but using `npm` is the simplest:

~~~~ sh
npm install -g @fedify/cli
~~~~

After installation, check the version:

~~~~ sh
fedify --version
~~~~

Make sure the version is 2.2.0 or higher; older versions do not ship the
Nuxt integration we rely on.

### `fedify init` to scaffold the project

Pick a directory where you want to work.  We will call ours
*content-sharing*.  Then run
[`fedify init`](../cli.md#fedify-init-initializing-a-fedify-project) with four
non-interactive options so the command does not ask you any questions:

~~~~ sh
fedify init -w nuxt -p npm -k in-memory -m in-process content-sharing
~~~~

The flags tell `fedify init` to use:

[`-w nuxt`]
:   Nuxt as the web framework.

[`-p npm`]
:   npm as the package manager.

[`-k in-memory`]
:   An in-memory [key&ndash;value store](../manual/kv.md) for Fedify.  This is
    perfect for development; once you deploy, you would swap it for Redis or
    a relational database.

[`-m in-process`]
:   An in-process [message queue](../manual/mq.md) for Fedify.  The same
    reasoning applies: fine for development, swap for Redis or RabbitMQ in
    production.

After a short install you will see something like this printed at the end:

~~~~ console
✨ Nuxt project has been created with the minimal template.

╭── 👉 Next steps ───╮
│                    │
│   › npm run dev    │
│                    │
╰────────────────────╯

  To start the server, run the following command:

`npm run dev`

Then, try to look up an actor from your server:

`fedify lookup http://localhost:3000/users/john`

      Start by editing the server/federation.ts file to define your federation!
~~~~

Move into the directory and take a look at what got generated:

~~~~ sh
cd content-sharing
ls -a
~~~~

The most interesting files and directories are:

 -  *app/*: the Vue side of the app.
     -  *app.vue*: the root Vue component that Nuxt renders on every page.
        Right now it shows a `<NuxtWelcome />` component, which is the page
        you will see in a moment.
 -  *public/*: static assets served as-is (favicon, *robots.txt*, and any
    uploaded images we will add later).
 -  *server/*: code that runs on the server only.
     -  *federation.ts*: the Fedify federation object.  This is where actors,
        inbox listeners, and object dispatchers are registered.  Most of our
        work will land here.
     -  *logging.ts*: [LogTape] configuration used by Fedify.
 -  *nuxt.config.ts*: Nuxt's configuration file; already has `@fedify/nuxt`
    wired up as a module.
 -  *package.json*: npm metadata and dependencies.
 -  *biome.json*: [Biome] formatter and import-sorting configuration.
 -  *tsconfig.json*: TypeScript compiler references to the generated Nuxt
    type files.

We are using TypeScript, so most source files end in *.ts* (for pure
TypeScript) or *.vue* (for Vue single-file components that may contain
TypeScript in their `<script>` blocks).

[LogTape]: https://logtape.org/
[Biome]: https://biomejs.dev/

### Running the dev server for the first time

Let's make sure the scaffolded project boots:

~~~~ sh
npm run dev
~~~~

Keep this terminal open; the server will keep running until you stop it with
<kbd>Ctrl</kbd>+<kbd>C</kbd>:

~~~~ console
●  Nuxt 4.4.2 (with Nitro 2.13.3, Vite 7.3.2 and Vue 3.5.33)

  ➜ Local:    http://localhost:3000/
  ➜ Network:  use --host to expose
~~~~

Open <http://localhost:3000/> in a browser.  You should see Nuxt's default
welcome page:

![Nuxt's welcome page at http://localhost:3000/ after running `npm run dev`
for the first time.](./content-sharing/nuxt-welcome-page.png)

We will replace this page with our own in the next chapter.  But first,
let's prove that Fedify is actually serving federation routes on the same
server.  In a **new terminal** (keep `npm run dev` running in the first
one), run:

~~~~ sh
fedify lookup http://localhost:3000/users/alice
~~~~

You should see output like this:

~~~~ console
✔ Fetched object: http://localhost:3000/users/alice
Person {
  id: URL 'http://localhost:3000/users/alice',
  name: 'alice',
  preferredUsername: 'alice'
}
✔ Successfully fetched the object.
~~~~

That tells us a few important things at once:

 -  The same HTTP server that rendered the welcome page at */* also serves
    an ActivityPub `Person` object at */users/alice*.  `@fedify/nuxt` is
    doing content negotiation for us: browsers get HTML; ActivityPub clients
    (which send `Accept: application/activity+json`) get JSON-LD.
 -  The `alice` we asked for was *not* predefined anywhere.  The scaffolded
    *server/federation.ts* contains an actor dispatcher that happily turns
    any identifier into a stub `Person`.  We will tighten this up later so
    only the real local user has an actor.

> [!TIP]
> [`fedify lookup`](../cli.md#fedify-lookup-looking-up-an-activitypub-object)
> queries ActivityPub objects from the command line.  It is equivalent to
> pasting the URI into Mastodon's search box, except it works against your
> local server too.
>
> If you prefer `curl`, you can also query the actor directly (note the
> `Accept` header):
>
> ~~~~ sh
> curl -H "Accept: application/activity+json" http://localhost:3000/users/alice
> ~~~~
>
> The response is compact JSON, so pipe it through `jq` if you have it
> installed for easier reading.

### Visual Studio Code

[Visual Studio Code] may not be your favorite editor, but we recommend it
while following this tutorial.  We are about to write a lot of TypeScript
and Vue, and VS Code is currently the smoothest editor for both.  The
scaffolded project even ships with a *.vscode/* directory that recommends
the right extensions (Biome for formatting, Volar for Vue).

> [!WARNING]
> Don't confuse Visual Studio Code with Visual Studio.  The two share a
> brand name and nothing else.

After [installing Visual Studio Code], open the project folder via
*File* → *Open Folder…*.  If you see a popup asking <q>Do you want to
install the recommended extensions?</q>, click *Install*.

> [!TIP]
> Emacs and Vim users: we are not here to talk you out of your editor, but
> please do set up TypeScript LSP and the Volar Vue language server.  The
> difference in productivity when editing large Vue components is
> substantial.

*[LSP]: Language Server Protocol

[Visual Studio Code]: https://code.visualstudio.com/
[installing Visual Studio Code]: https://code.visualstudio.com/docs/setup/setup-overview


Prerequisites
-------------

### TypeScript in a nutshell

Before we dive in, let's glance at TypeScript.  If you already know it,
skip this section.

TypeScript is JavaScript plus static type checking.  The syntax is almost
identical, except you can annotate variables and function parameters with
types by writing a colon followed by the type:

~~~~ typescript twoslash
let username: string;
~~~~

If you try to assign a value of a different type, the editor will show a
red squiggle *before you even run it*:

~~~~ typescript twoslash
// @errors: 2322
let username: string;
// ---cut-before---
username = 123;
~~~~

The single most common type error you will see is the `null` possibility
error.  For example, if a function can return either a `string` or `null`,
TypeScript forces you to handle both:

~~~~ typescript twoslash
function loadCaption(): string | null { return ""; }
// ---cut-before---
const caption: string | null = loadCaption();
~~~~

Trying to call a string method on this value fails:

~~~~ typescript twoslash
// @errors: 18047
function loadCaption(): string | null { return ""; }
const caption: string | null = loadCaption();
// ---cut-before---
const firstChar = caption.charAt(0);
~~~~

TypeScript is telling you that `caption` might be `null`, and
`null.charAt(0)` would blow up.  The fix is to handle the `null` branch
explicitly:

~~~~ typescript twoslash
function loadCaption(): string | null { return ""; }
const caption: string | null = loadCaption();
// ---cut-before---
const firstChar = caption === null ? "" : caption.charAt(0);
~~~~

This catches bugs you would otherwise find only at runtime.  Another
incidental benefit is auto-completion: type `caption.` in your editor and
you will see every method `string` has.  Fedify ships hand-written types
for every ActivityPub object, so you get the same experience for actors,
activities, and objects.

> [!TIP]
> For a deeper tour of TypeScript, *[The TypeScript Handbook]* takes about
> 30 minutes to read.

[The TypeScript Handbook]: https://www.typescriptlang.org/docs/handbook/intro.html

### Vue and Nuxt in a nutshell

[Vue] is a component-based UI framework.  A component is a *.vue* file with
three optional blocks: `<script>` for JavaScript or TypeScript, `<template>`
for HTML, and `<style>` for CSS.  For example:

~~~~ vue
<script setup lang="ts">
const count = ref(0);
</script>

<template>
  <button type="button" @click="count++">
    Clicked {{ count }} times
  </button>
</template>
~~~~

A few things are worth noting:

 -  `<script setup>` lets you expose variables from the script block to the
    template just by declaring them.
 -  `ref(0)` creates a reactive value.  When `count` changes, any template
    using `{{ count }}` re-renders.
 -  `@click="count++"` attaches a click listener.

[Nuxt] is a meta-framework built on top of Vue.  It adds:

 -  **File-based routing**: *app/pages/index.vue* becomes */*, and a file
    named *&#91;username&#93;.vue* inside *app/pages/users/* becomes
    */users/:username*.
 -  **Server routes**: *server/api/posts.ts* becomes an HTTP endpoint at
    */api/posts*.
 -  **Built-in TypeScript**, Vite-based hot reloading, SSR, and a modules
    system.  [`@fedify/nuxt`][fedify-nuxt] is one such module.

Think of Nuxt as Vue with Next.js-style conveniences bolted on.  In this
tutorial, we will write Vue components for HTML views and plain TypeScript
for server-side logic.  Whenever the two need to talk, we will define a
small JSON API in *server/api/*.

[Vue]: https://vuejs.org/
[fedify-nuxt]: https://www.npmjs.com/package/@fedify/nuxt

### What is ActivityPub, roughly?

ActivityPub is a decentralized social networking protocol.  Every user has
an **actor** (usually of type `Person`), which is just a JSON-LD object
hosted at a stable URL.  Actors can send each other **activities** (like
`Follow`, `Create`, `Like`, `Announce`, `Delete`) by POSTing them to the
recipient's **inbox** URL.  Each actor also advertises a **followers**
collection, an **outbox**, a few cryptographic keys, and so on.

You do not need to know any of this in detail to follow the tutorial.
Fedify gives you typed helpers for every activity and object, so you can
think in terms like “when someone follows alice, insert a row in the
`followers` table” instead of “parse JSON-LD, verify HTTP signatures,
dereference the actor”.  Whenever we introduce a new activity or property,
we will explain what it means.
