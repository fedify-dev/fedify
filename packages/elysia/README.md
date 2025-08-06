<!-- deno-fmt-ignore-file -->

@fedify/elysia: Integrate Fedify with Elysia
============================================

[![npm][npm badge]][npm]
[![Matrix][Matrix badge]][Matrix]
[![Follow @fedify@hollo.social][@fedify@hollo.social badge]][@fedify@hollo.social]

This package provides a simple way to integrate [Fedify] with [Elysia].

The integration code looks like this:

~~~~ typescript
import { fedify } from "@fedify/elysia";
import { federation } from "./federation.ts";  // Your `Federation` instance
import { Elysia } from "elysia";

const app = new Elysia();

app
  .use(fedify(federation, () => "context data goes here"))
  .listen(3000);

console.log("Elysia App Start!");
~~~~

[npm]: https://www.npmjs.com/package/@fedify/elysia
[npm badge]: https://img.shields.io/npm/v/@fedify/elysia?logo=npm
[Matrix]: https://matrix.to/#/#fedify:matrix.org
[Matrix badge]: https://img.shields.io/matrix/fedify%3Amatrix.org
[@fedify@hollo.social badge]: https://fedi-badge.deno.dev/@fedify@hollo.social/followers.svg
[@fedify@hollo.social]: https://hollo.social/@fedify
[Fedify]: https://fedify.dev/
[Elysia]: https://elysiajs.com/
