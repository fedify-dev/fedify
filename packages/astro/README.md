<!-- deno-fmt-ignore-file -->

@fedify/astro: Integrate Fedify with `Astro`
============================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]
[![Follow @fedify@hollo.social][@fedify@hollo.social badge]][@fedify@hollo.social]

*This package is available since Fedify 2.1.0.*

This package provides a simple way to integrate [Fedify] with [Astro].

First, add the integration to your *astro.config.mjs*:

~~~~ typescript
import { defineConfig } from "astro/config";
import { fedifyIntegration } from "@fedify/astro";

export default defineConfig({
  integrations: [fedifyIntegration()],
  output: "server",
});
~~~~

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

[JSR badge]: https://jsr.io/badges/@fedify/astro
[JSR]: https://jsr.io/@fedify/astro
[npm badge]: https://img.shields.io/npm/v/@fedify/astro?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/astro
[@fedify@hollo.social badge]: https://fedi-badge.deno.dev/@fedify@hollo.social/followers.svg
[@fedify@hollo.social]: https://hollo.social/@fedify
[Fedify]: https://fedify.dev/
[Astro]: https://astro.build/


For Deno users
--------------

If you are using Deno, you should import `@deno/vite-adapter` in
*astro.config.mjs* and use it as the adapter:

~~~~ typescript
import { defineConfig } from "astro/config";
import { fedifyIntegration } from "@fedify/astro";
import deno from "@deno/vite-adapter";

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
