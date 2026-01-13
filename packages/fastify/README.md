<!-- deno-fmt-ignore-file -->

@fedify/fastify: Integrate Fedify with Fastify
==============================================

[![npm][npm badge]][npm]
[![Matrix][Matrix badge]][Matrix]
[![Follow @fedify@hollo.social][@fedify@hollo.social badge]][@fedify@hollo.social]

This package provides a simple way to integrate [Fedify] with [Fastify].

The integration code looks like this:

~~~~ typescript
import Fastify from "fastify";
import { fedifyPlugin } from "@fedify/fastify";
import { federation } from "./federation.ts";  // Your `Federation` instance

const fastify = Fastify({ logger: true });

await fastify.register(fedifyPlugin, {
  federation,
  contextDataFactory: () => undefined,
});

fastify.listen({ port: 3000 });
~~~~

[npm badge]: https://img.shields.io/npm/v/@fedify/fastify?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/fastify
[Matrix badge]: https://img.shields.io/matrix/fedify%3Amatrix.org
[Matrix]: https://matrix.to/#/#fedify:matrix.org
[@fedify@hollo.social badge]: https://fedi-badge.deno.dev/@fedify@hollo.social/followers.svg
[@fedify@hollo.social]: https://hollo.social/@fedify
[Fedify]: https://fedify.dev/
[Fastify]: https://fastify.dev/
