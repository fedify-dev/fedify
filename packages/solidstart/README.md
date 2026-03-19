<!-- deno-fmt-ignore-file -->

@fedify/solidstart: Integrate Fedify with solidstart
====================================================

[![npm][npm badge]][npm]
[![Matrix][Matrix badge]][Matrix]
[![Follow @fedify@hollo.social][@fedify@hollo.social badge]][@fedify@hollo.social]

This package provides a simple way to integrate [Fedify] with [SolidStart].

The integration code looks like this:

~~~~ typescript
// src/middleware/index.ts
import { fedifyMiddleware } from "@fedify/solidstart";
import federation from "../lib/federation";

export default fedifyMiddleware(federation, (event) => "context data");
~~~~

Put the above code in your *src/middleware/index.ts* file, and set
`middleware: "src/middleware/index.ts"` in your *app.config.ts*.

[npm badge]: https://img.shields.io/npm/v/@fedify/solidstart?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/solidstart
[Matrix badge]: https://img.shields.io/matrix/fedify%3Amatrix.org
[Matrix]: https://matrix.to/#/#fedify:matrix.org
[@fedify@hollo.social badge]: https://fedi-badge.deno.dev/@fedify@hollo.social/followers.svg
[@fedify@hollo.social]: https://hollo.social/@fedify
[Fedify]: https://fedify.dev/
[SolidStart]: https://start.solidjs.com/
