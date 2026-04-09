<!-- deno-fmt-ignore-file -->

<!-- Replace `프레임워크` with the name of the framework you are integrating with -->

@fedify/프레임워크: Integrate Fedify with 프레임워크
====================================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]
[![Matrix][Matrix badge]][Matrix]
[![Follow @fedify@hollo.social][@fedify@hollo.social badge]][@fedify@hollo.social]

This package provides a simple way to integrate [Fedify] with [프레임워크].

[JSR badge]: https://jsr.io/badges/@fedify/프레임워크
[JSR]: https://jsr.io/@fedify/프레임워크
[npm badge]: https://img.shields.io/npm/v/@fedify/프레임워크?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/프레임워크
[Matrix badge]: https://img.shields.io/matrix/fedify%3Amatrix.org
[Matrix]: https://matrix.to/#/#fedify:matrix.org
[@fedify@hollo.social badge]: https://fedi-badge.deno.dev/@fedify@hollo.social/followers.svg
[@fedify@hollo.social]: https://hollo.social/@fedify
[Fedify]: https://fedify.dev/
[프레임워크]: https://프레임.워크/


Installation
------------

<!-- Remove scripts from unsupported runtimes. -->

~~~~ bash
deno add jsr:@fedify/프레임워크
# or
npm add @fedify/프레임워크
# or
pnpm add @fedify/프레임워크
# or
yarn add @fedify/프레임워크
# or
bun add @fedify/프레임워크
~~~~


Usage
-----

First, create your `Federation` instance in a server utility file,
e.g., *src/federation.ts*:

~~~~ typescript
import { createFederation, MemoryKvStore } from "@fedify/fedify";

const federation = createFederation({
  kv: new MemoryKvStore(),
});

// ... configure your federation ...

export default federation;
~~~~

Then, add Fedify middleware to your server:

~~~~ typescript
import fedifyHandler from "@fedify/프레임워크";
import federation from "./federation.ts";

const fedifyMiddleware = fedifyHandler(federation);

app.use(fedifyMiddleware);
~~~~
