<!-- deno-fmt-ignore-file -->

@fedify/Nuxt: Integrate Fedify with Nuxt
========================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]
[![Matrix][Matrix badge]][Matrix]
[![Follow @fedify@hollo.social][@fedify@hollo.social badge]][@fedify@hollo.social]

This package provides a simple way to integrate [Fedify] with [Nuxt] 4.x.
It installs a server middleware handler that lets Nuxt and Fedify share the
same routes with content negotiation, and it also provides an error handler
for the final 406 fallback when Nuxt cannot serve HTML for the same path.

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

::: code-group

~~~~ sh [Deno]
deno add jsr:@fedify/nuxt
~~~~

~~~~ sh [npm]
npm add @fedify/nuxt
~~~~

~~~~ sh [pnpm]
pnpm add @fedify/nuxt
~~~~

~~~~ sh [Yarn]
yarn add @fedify/nuxt
~~~~

~~~~ sh [Bun]
bun add @fedify/nuxt
~~~~

:::


Usage
-----

Configure Nuxt's Nitro error handler in *nuxt.config.ts*:

~~~~ typescript
export default defineNuxtConfig({
  nitro: {
    errorHandler: "./server/error",
  },
});
~~~~

Then create *server/error.ts*:

~~~~ typescript
import { fedifyErrorHandler } from "@fedify/nuxt";

export default fedifyErrorHandler;
~~~~

Finally, add the Fedify middleware in *server/middleware/federation.ts*:

~~~~ typescript
import federation from "../federation";
import { fedifyHandler } from "@fedify/nuxt";

export default fedifyHandler(
  federation,
  (event, request) => undefined,
);
~~~~
