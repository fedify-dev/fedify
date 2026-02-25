<!-- deno-fmt-ignore-file -->

Astro integration sample
========================

This project is a sample application that demonstrates how to integrate Fedify
with [Astro] using the [`@fedify/astro`] package.  It supports both [Deno] and
[Node.js] runtimes.

[Astro]: https://astro.build/
[`@fedify/astro`]: https://jsr.io/@fedify/astro
[Deno]: https://deno.com/
[Node.js]: https://nodejs.org/


How it works
------------

 -  *astro.config.deno.ts* registers `fedifyIntegration()` to configure Vite's
    SSR settings for Fedify compatibility, and uses `@deno/astro-adapter` to
    run on Deno.
 -  *astro.config.node.ts* registers `fedifyIntegration()` without any adapter
    for Node.js.
 -  *src/middleware.ts* sets up a `Federation` with `fedifyMiddleware()`.
    It defines an actor dispatcher for `/{identifier}` that serves a `Person`
    object for the `sample` actor.
 -  *src/pages/identifier.astro* renders an HTML page for the same route.
    Fedify and Astro share the route and do content negotiation depending on
    the `Accept` header.

> [!NOTE]
> When using Deno with Astro, you must use `npm:` specifiers (not `jsr:`) for
> `@fedify/fedify` and `@fedify/vocab` in your *deno.json* due to Vite
> compatibility limitations.


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
curl -H "Accept: application/activity+json" http://localhost:4321/sample
~~~~


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
