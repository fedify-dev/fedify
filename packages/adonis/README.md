<!-- deno-fmt-ignore-file -->

@fedify/adonis: Integrate Fedify with adonisjs
==============================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]
[![Matrix][Matrix badge]][Matrix]
[![Follow @fedify@hollo.social][@fedify@hollo.social badge]][@fedify@hollo.social]

This package provides a simple way to integrate [Fedify] with [AdonisJS]
(v6 and v7).

[JSR badge]: https://jsr.io/badges/@fedify/adonis
[JSR]: https://jsr.io/@fedify/adonis
[npm badge]: https://img.shields.io/npm/v/@fedify/adonis?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/adonis
[Matrix badge]: https://img.shields.io/matrix/fedify%3Amatrix.org
[Matrix]: https://matrix.to/#/#fedify:matrix.org
[@fedify@hollo.social badge]: https://fedi-badge.deno.dev/@fedify@hollo.social/followers.svg
[@fedify@hollo.social]: https://hollo.social/@fedify
[Fedify]: https://fedify.dev/
[AdonisJS]: https://adonisjs.com/


Installation
------------

~~~~ bash
npm add @fedify/adonis
# or
pnpm add @fedify/adonis
# or
yarn add @fedify/adonis
# or
bun add @fedify/adonis
~~~~


Usage
-----

First, create your `Federation` instance in a service file,
e.g., *app/services/federation.ts*:

~~~~ typescript
import { createFederation, MemoryKvStore } from "@fedify/fedify";

const federation = createFederation({
  kv: new MemoryKvStore(),
});

// ... configure your federation ...

export default federation;
~~~~

Then, create a middleware file, e.g., *app/middleware/fedify\_middleware.ts*:

~~~~ typescript
import { fedifyMiddleware } from "@fedify/adonis";
import federation from "#services/federation";

export default fedifyMiddleware(federation);
~~~~

Finally, register it as a server middleware in *start/kernel.ts*:

~~~~ typescript
import server from "@adonisjs/core/services/server";

server.use([
  () => import("#middleware/fedify_middleware"),
  // ... other middleware
]);
~~~~

The middleware intercepts incoming requests and delegates federation traffic
(ActivityPub, WebFinger, etc.) to Fedify.  All other requests pass through
to your AdonisJS routes.
