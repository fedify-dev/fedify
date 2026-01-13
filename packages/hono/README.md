<!-- deno-fmt-ignore-file -->

@fedify/hono: Integrate Fedify with Hono
========================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]
[![Follow @fedify@hollo.social][@fedify@hollo.social badge]][@fedify@hollo.social]

*This package is available since Fedify 1.9.0.*

This package provides a simple way to integrate [Fedify] with [Hono].

The integration code looks like this:

~~~~ typescript
import { createFederation } from "@fedify/fedify";
import { federation } from "@fedify/hono";
import { Hono } from "hono";

const fedi = createFederation<string>({
  // Omitted for brevity; see the related section for details.
});

const app = new Hono();
app.use(federation(fedi, (ctx) => "context data"));
~~~~

[JSR badge]: https://jsr.io/badges/@fedify/hono
[JSR]: https://jsr.io/@fedify/hono
[npm badge]: https://img.shields.io/npm/v/@fedify/hono?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/hono
[@fedify@hollo.social badge]: https://fedi-badge.deno.dev/@fedify@hollo.social/followers.svg
[@fedify@hollo.social]: https://hollo.social/@fedify
[Fedify]: https://fedify.dev/
[Hono]: https://hono.dev/


How it works
------------

Fedify behaves as a middleware that wraps around the Hono request handler.
The middleware intercepts the incoming HTTP requests and dispatches them to
the appropriate handler based on the request path and the `Accept` header
(i.e., content negotiation).  This architecture allows Fedify and your Hono
application to coexist in the same domain and port.

For example, if you make a request to */.well-known/webfinger* Fedify will
handle the request by itself, but if you make a request to */users/alice*
(assuming your Hono app has a handler for `/users/:handle`) with
`Accept: text/html` header, Fedify will dispatch the request to the Hono app's
appropriate handler for `/users/:handle`.  Or if you define an actor dispatcher
for `/users/{handle}` in Fedify, and the request is made with
`Accept: application/activity+json` header, Fedify will dispatch the request to
the appropriate actor dispatcher.


Installation
------------

~~~~ sh
deno add jsr:@fedify/hono  # Deno
npm  add     @fedify/hono  # npm
pnpm add     @fedify/hono  # pnpm
yarn add     @fedify/hono  # Yarn
bun  add     @fedify/hono  # Bun
~~~~
