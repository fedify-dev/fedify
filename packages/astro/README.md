<!-- deno-fmt-ignore-file -->

@fedify/astro: Integrate Fedify with `Astro`
============================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]
[![@fedify@hackers.pub][@fedify@hackers.pub badge]][@fedify@hackers.pub]

*This package is available since Fedify 2.1.0.*

This package provides a simple way to integrate [Fedify] with [Astro].
Astro 5, 6, and 7 are supported.

Fedify needs Astro's on-demand rendering, so install a server adapter for your
runtime.  The following Node.js configuration uses `@astrojs/node` 11 with
Astro 7:

First, add the integration to your *astro.config.mjs*:

~~~~ typescript
import { defineConfig } from "astro/config";
import { fedifyIntegration } from "@fedify/astro";
import node from "@astrojs/node";

export default defineConfig({
  integrations: [fedifyIntegration()],
  output: "server",
  adapter: node({ mode: "standalone" }),
});
~~~~

The `"server"` output is the simplest default because Fedify handles endpoints
such as WebFinger and inboxes that do not have corresponding Astro page files.
Individual Astro pages can still opt into prerendering with
`export const prerender = true`.

Then, create your middleware in *src/middleware.ts*:

~~~~ typescript
import { createFederation } from "@fedify/fedify";
import { fedifyMiddleware } from "@fedify/astro";

const federation = createFederation<void>({
  // Omitted for brevity; see the related section for details.
});

export const onRequest = fedifyMiddleware(
  federation,
  (context) => void 0,
);
~~~~

If your application has other middleware, compose it with the Fedify
middleware using `sequence()`:

~~~~ typescript
import { fedifyMiddleware } from "@fedify/astro";
import { sequence } from "astro:middleware";
import federation from "./federation.ts";

export const onRequest = sequence(
  otherMiddleware,
  fedifyMiddleware(federation, () => undefined),
);
~~~~

[JSR badge]: https://jsr.io/badges/@fedify/astro
[JSR]: https://jsr.io/@fedify/astro
[npm badge]: https://img.shields.io/npm/v/@fedify/astro?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/astro
[@fedify@hackers.pub badge]: https://fedi-badge.minhee.org/@fedify@hackers.pub/followers.svg
[@fedify@hackers.pub]: https://hackers.pub/@fedify
[Fedify]: https://fedify.dev/
[Astro]: https://astro.build/


For Deno users
--------------

Install `@fedify/astro` and the other packages loaded by Astro from npm.  Vite
resolves these imports through *node\_modules/* rather than Deno's JSR import
map.

If you are using Deno, you should import `@deno/astro-adapter` in
*astro.config.mjs* and use it as the adapter:

~~~~ typescript
import { defineConfig } from "astro/config";
import { fedifyIntegration } from "@fedify/astro";
import deno from "@deno/astro-adapter";

export default defineConfig({
  integrations: [fedifyIntegration()],
  output: "server",
  adapter: deno(),
});
~~~~

And the tasks in *deno.json* should be updated to use `deno run npm:astro`
instead of `astro`:

~~~~ json
{
  "tasks": {
    "dev": "deno run -A npm:astro dev",
    "build": "deno run -A npm:astro build",
    "preview": "deno run -A npm:astro preview"
  }
}
~~~~


For Bun users
-------------

Astro 7 does not have a compatible Bun-specific adapter.  The tested Bun
configuration uses `@astrojs/node` 11 in standalone mode, builds Astro with
Bun, and runs the resulting server entry point with Bun:

~~~~ typescript
import { defineConfig } from "astro/config";
import { fedifyIntegration } from "@fedify/astro";
import node from "@astrojs/node";

export default defineConfig({
  integrations: [fedifyIntegration()],
  output: "server",
  adapter: node({ mode: "standalone" }),
});
~~~~

Then use Bun to start Astro in development, and run the generated server entry
point after building for preview or production:

~~~~ json
{
  "scripts": {
    "dev": "bunx --bun astro dev",
    "build": "bunx --bun astro build",
    "preview": "bun ./dist/server/entry.mjs"
  }
}
~~~~


How it works
------------

Fedify behaves as a middleware that wraps around the Astro request handler.
The middleware intercepts the incoming HTTP requests and dispatches them to
the appropriate handler based on the request path and the `Accept` header
(i.e., content negotiation).  This architecture allows Fedify and your Astro
application to coexist in the same domain and port.

The `fedifyIntegration()` function configures Vite's SSR settings to ensure
that `@fedify/fedify` and `@fedify/vocab` are properly bundled during SSR.

For example, if you make a request to */.well-known/webfinger* Fedify will
handle the request by itself, but if you make a request to */users/alice*
(assuming your Astro app has a page for that path) with
`Accept: text/html` header, Fedify will dispatch the request to Astro's
page handler.  Or if you define an actor dispatcher
for `/users/{identifier}` in Fedify, and the request is made with
`Accept: application/activity+json` header, Fedify will dispatch the request
to the appropriate actor dispatcher.


Installation
------------

~~~~ sh
deno add jsr:@fedify/astro  # Deno
npm  add     @fedify/astro  # npm
pnpm add     @fedify/astro  # pnpm
yarn add     @fedify/astro  # Yarn
bun  add     @fedify/astro  # Bun
~~~~
