<!-- deno-fmt-ignore-file -->

@fedify/sveltekit: Integrate Fedify with SvelteKit
==================================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]
[![Follow @fedify@hollo.social][@fedify@hollo.social badge]][@fedify@hollo.social]

*This package is available since Fedify 1.9.0.*

This package provides a simple way to integrate [Fedify] with [SvelteKit].

The integration code looks like this:

~~~~ typescript
import { createFederation } from "@fedify/fedify";
import { fedifyHook } from "@fedify/sveltekit";

const federation = createFederation<string>({
  // Omitted for brevity; see the related section for details.
});

// This is the entry point to the Fedify hook from the SvelteKit framework:
export const handle = fedifyHook(federation, (req) => "context data");
~~~~

Put the above code in your *hooks.server.ts* file.

[JSR badge]: https://jsr.io/badges/@fedify/sveltekit
[JSR]: https://jsr.io/@fedify/sveltekit
[npm badge]: https://img.shields.io/npm/v/@fedify/sveltekit?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/sveltekit
[@fedify@hollo.social badge]: https://fedi-badge.deno.dev/@fedify@hollo.social/followers.svg
[@fedify@hollo.social]: https://hollo.social/@fedify
[Fedify]: https://fedify.dev/
[SvelteKit]: https://kit.svelte.dev/


How it works
------------

Fedify behaves as a hook handler that wraps around the SvelteKit request
handler. The hook intercepts the incoming HTTP requests and dispatches them to
the appropriate handler based on the request path and the `Accept` header
(i.e., content negotiation).  This architecture allows Fedify and your
SvelteKit application to coexist in the same domain and port.

For example, if you make a request to */.well-known/webfinger* Fedify will
handle the request by itself, but if you make a request to */users/alice*
(assuming your SvelteKit app has a handler for `/users/[handle]`) with
`Accept: text/html` header, Fedify will dispatch the request to the SvelteKit
app's appropriate handler for `/users/[handle]`.  Or if you define an actor
dispatcher for `/users/{handle}` in Fedify, and the request is made with
`Accept: application/activity+json` header, Fedify will dispatch the request to
the appropriate actor dispatcher.


Installation
------------

~~~~ sh
deno add jsr:@fedify/sveltekit  # Deno
npm  add     @fedify/sveltekit  # npm
pnpm add     @fedify/sveltekit  # pnpm
yarn add     @fedify/sveltekit  # Yarn
bun  add     @fedify/sveltekit  # Bun
~~~~
