<!-- deno-fmt-ignore-file -->

@fedify/koa: Integrate Fedify with Koa
======================================

[![npm][npm badge]][npm]
[![Matrix][Matrix badge]][Matrix]
[![Follow @fedify@hollo.social][@fedify@hollo.social badge]][@fedify@hollo.social]

This package provides a simple way to integrate [Fedify] with [Koa].

Supports Koa v2.x and v3.x.

The integration code looks like this:

~~~~ typescript
import Koa from "koa";
import { createMiddleware } from "@fedify/koa";
import { federation } from "./federation.ts";  // Your `Federation` instance

const app = new Koa();

app.proxy = true;  // Trust proxy headers

app.use(createMiddleware(federation, (ctx) => "context data goes here"));
~~~~

[npm badge]: https://img.shields.io/npm/v/@fedify/koa?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/koa
[Matrix badge]: https://img.shields.io/matrix/fedify%3Amatrix.org
[Matrix]: https://matrix.to/#/#fedify:matrix.org
[@fedify@hollo.social badge]: https://fedi-badge.deno.dev/@fedify@hollo.social/followers.svg
[@fedify@hollo.social]: https://hollo.social/@fedify
[Fedify]: https://fedify.dev/
[Koa]: https://koajs.com/
