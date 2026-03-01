<!-- deno-fmt-ignore-file -->

Astro integration sample
========================

A comprehensive example of building a federated server application using
[Fedify] with [Astro] via the [`@fedify/astro`] package.  This sample
demonstrates how to create an ActivityPub-compatible federated social media
server that can interact with other federated platforms like Mastodon, Pleroma,
and other ActivityPub implementations.  It supports both [Deno] and [Node.js]
runtimes.

[Fedify]: https://fedify.dev
[Astro]: https://astro.build/
[`@fedify/astro`]: https://jsr.io/@fedify/astro
[Deno]: https://deno.com/
[Node.js]: https://nodejs.org/


Features
--------

 -  **ActivityPub Protocol Support**: Full implementation of ActivityPub for
    federated social networking
 -  **Actor System**: User profile management with cryptographic key pairs
 -  **Follow/Unfollow**: Complete follow relationship handling with Accept/Undo
    activities
 -  **Post System**: Create and distribute posts to followers via the Create
    activity
 -  **Inbox Processing**: Real-time activity processing from federated instances
 -  **Content Negotiation**: Same routes serve HTML for browsers and ActivityPub
    JSON for federated clients
 -  **Dual Runtime**: Supports both Deno and Node.js via separate Astro configs
 -  **TypeScript**: Full type safety throughout the application


How it works
------------

 -  *astro.config.deno.ts* registers `fedifyIntegration()` to configure Vite's
    SSR settings for Fedify compatibility, and uses `@deno/astro-adapter` to
    run on Deno.
 -  *astro.config.node.ts* registers `fedifyIntegration()` without any adapter
    for Node.js.
 -  *src/lib/store.ts* defines in-memory stores for key pairs, follower
    relationships, and posts.
 -  *src/lib/federation.ts* sets up the full `Federation` instance with:
     -  Actor dispatcher at `/users/{identifier}` serving a `Person` object
     -  Key pairs dispatcher for cryptographic signing
     -  Inbox listeners for `Follow` and `Undo` activities
     -  `Note` object dispatcher at `/users/{identifier}/posts/{id}`
     -  Followers collection at `/users/{identifier}/followers`
 -  *src/middleware.ts* wires the federation into Astro via
    `fedifyMiddleware()`.
 -  *src/pages/users/\[identifier\]/index.astro* renders an HTML profile page.
    Fedify and Astro share the route and do content negotiation depending on
    the `Accept` header.
 -  *src/pages/users/\[identifier\]/posts/index.astro* lists posts and handles
    new post creation via a form `POST`.
 -  *src/pages/users/\[identifier\]/posts/[id].astro* renders an individual post
    detail page.

> [!NOTE]
> When using Deno with Astro, you must use `npm:` specifiers (not `jsr:`) for
> `@fedify/fedify` and `@fedify/vocab` in your *deno.json* due to Vite
> compatibility limitations.


Project structure
-----------------

~~~~
src/
├── middleware.ts                  # Fedify middleware entry point
├── lib/
│   ├── federation.ts             # Main federation configuration
│   └── store.ts                  # In-memory data storage
├── layouts/
│   └── Layout.astro              # Base layout with global styles
└── pages/
    ├── index.astro               # Home page (handle & followers)
    └── users/
        └── \[identifier\]/
            ├── index.astro       # User profile page
            └── posts/
                ├── index.astro   # Posts list & create form
                └── [id].astro    # Individual post detail
~~~~


Running
-------

### Deno

To run the dev server with Deno:

~~~~ command
deno task dev
~~~~

This uses *astro.config.deno.ts* as the configuration file.

### Node.js

To run the dev server with Node.js:

~~~~ command
pnpm dev
~~~~

This uses *astro.config.node.ts* as the configuration file.

### Testing

The application will be available at <http://localhost:4321/>.

To fetch the actor as ActivityPub JSON:

~~~~ command
curl -H "Accept: application/activity+json" http://localhost:4321/users/demo
~~~~

Or using the Fedify CLI:

~~~~ command
fedify lookup @demo@localhost:4321
~~~~


Example usage scenarios
-----------------------

### 1. basic federation testing

1.  Start the development server:

    ~~~~ bash
    deno task dev
    # or for Node.js
    pnpm dev
    ~~~~

2.  Visit the home page at <http://localhost:4321/> to see the demo account
    handle and follower list.

3.  Visit the profile page at <http://localhost:4321/users/demo>.

4.  Create a post at <http://localhost:4321/users/demo/posts>.

5.  The ActivityPub actor endpoint is available at:

    ~~~~
    fedify lookup @demo@localhost:4321
    ~~~~

### 2. following from activitypub.academy

[ActivityPub.Academy] is a platform for learning about the ActivityPub
protocol and its implementation.

To test federation with ActivityPub.Academy:

1.  Deploy the application to a public server or use a tunneling service:

    ~~~~ bash
    # Using Fedify CLI to tunnel
    fedify tunnel 4321
    ~~~~

2.  From your ActivityPub.Academy account, search for and follow:

    ~~~~
    @demo@<your-tunnel-host>
    ~~~~

3.  The application will automatically:
     -  Receive the follow request
     -  Send an Accept activity back
     -  Store the follower relationship
     -  Display the follower on the home page

[ActivityPub.Academy]: https://activitypub.academy


Configuration
-------------

### Federation configuration

The federation setup is configured in *src/lib/federation.ts*:

~~~~ typescript
const federation = createFederation<void>({
  kv: new MemoryKvStore(), // In-memory storage for development
});
~~~~

#### Key configuration options

1.  **Storage Backend**:
     -  Development: `MemoryKvStore()` (data lost on restart)
     -  Production: Consider using persistent storage solutions

2.  **Actor Identifier**:
     -  Default: `"demo"`
     -  Modify the `IDENTIFIER` constant to change the demo user

3.  **Demo Actor Profile**:
     -  Name: “Fedify Demo”
     -  Summary: “This is a Fedify Demo account.”
     -  Icon: */demo-profile.png*


Using as a template
-------------------

If you are creating a new project based on this example, you only need the
configuration file for your target runtime.  Delete the unused one and rename
the one you keep to *astro.config.ts*:

### For Deno

~~~~ command
rm astro.config.node.ts
mv astro.config.deno.ts astro.config.ts
~~~~

Then remove the `--config` flags from *deno.json* tasks:

~~~~ json
{
  "tasks": {
    "dev": "deno run -A npm:astro dev",
    "build": "deno run -A npm:astro build",
    "preview": "deno run -A npm:astro preview"
  }
}
~~~~

### For Node.js

~~~~ command
rm astro.config.deno.ts
mv astro.config.node.ts astro.config.ts
~~~~

Then remove the `--config` flags from *package.json* scripts:

~~~~ json
{
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview"
  }
}
~~~~


Links
-----

 -  [Fedify Documentation]
 -  [Astro Documentation]
 -  [`@fedify/astro` on JSR]
 -  [ActivityPub Specification]

[Fedify Documentation]: https://fedify.dev
[Astro Documentation]: https://docs.astro.build/
[`@fedify/astro` on JSR]: https://jsr.io/@fedify/astro
[ActivityPub Specification]: https://www.w3.org/TR/activitypub/
