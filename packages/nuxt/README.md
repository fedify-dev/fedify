<!-- deno-fmt-ignore-file -->

@fedify/nuxt: Integrate Fedify with Nuxt
========================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]
[![Matrix][Matrix badge]][Matrix]
[![Follow @fedify@hollo.social][@fedify@hollo.social badge]][@fedify@hollo.social]

This package provides a simple way to integrate [Fedify] with [Nuxt].

Supported framework versions:

 -  Nuxt 4.x
 -  Nitro 2.x (Nuxt 4 runtime)

[JSR badge]: https://jsr.io/badges/@fedify/nuxt
[JSR]: https://jsr.io/@fedify/nuxt
[npm badge]: https://img.shields.io/npm/v/@fedify/nuxt?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/nuxt
[Matrix badge]: https://img.shields.io/matrix/fedify%3Amatrix.org
[Matrix]: https://matrix.to/#/#fedify:matrix.org
[@fedify@hollo.social badge]: https://fedi-badge.deno.dev/@fedify@hollo.social/followers.svg
[@fedify@hollo.social]: https://hollo.social/@fedify
[Fedify]: https://fedify.dev/
[Nuxt]: https://nuxt.com/


Installation
------------

~~~~ bash
deno add jsr:@fedify/nuxt
# or
npm add @fedify/nuxt
# or
pnpm add @fedify/nuxt
# or
yarn add @fedify/nuxt
# or
bun add @fedify/nuxt
~~~~


Usage
-----

Create your `Federation` instance in *server/federation.ts*:

~~~~ typescript
import { createFederation, MemoryKvStore } from "@fedify/fedify";

const federation = createFederation({
  kv: new MemoryKvStore(),
});

// ... configure your federation ...

export default federation;
~~~~

Then enable the Nuxt module in *nuxt.config.ts*:

~~~~ typescript
export default defineNuxtConfig({
  modules: ["@fedify/nuxt"],
});
~~~~

By default, `@fedify/nuxt` loads your Federation instance from
*~/server/federation*.

If your project uses a different file path or context data factory,
configure the module options:

~~~~ typescript
export default defineNuxtConfig({
  modules: ["@fedify/nuxt"],
  fedify: {
    federationModule: "~/server/federation",
    contextDataFactoryModule: "~/server/fedify-context",
  },
});
~~~~

The context data factory module should export either:

 -  default function, or
 -  `contextDataFactory` named export

with this signature:

~~~~ typescript
import type { ContextDataFactory } from "@fedify/nuxt";

const contextDataFactory: ContextDataFactory<unknown> = async (event, request) => {
  return {
    ip: event.node.req.socket.remoteAddress,
    method: request.method,
  };
};

export default contextDataFactory;
~~~~
