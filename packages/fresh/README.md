<!-- deno-fmt-ignore-file -->

@fedify/fresh: Integrate Fedify with Fresh 2.x
==============================================

[![Follow @fedify@hollo.social][@fedify@hollo.social badge]][@fedify@hollo.social]

This package provides a simple way to integrate [Fedify] with [Fresh].

The integration code looks like this:

~~~~ typescript
import { integrateHandler } from "@fedify/fresh";
import { App, staticFiles } from "fresh";
import { federation } from "./federation.ts";
import { define, type State } from "./utils.ts";

const fedifyMiddleware = define.middleware(
  integrateHandler<void, State>(federation, () => undefined),
);

app.use(fedifyMiddleware);
~~~~

[Matrix]: https://matrix.to/#/#fedify:matrix.org
[Matrix badge]: https://img.shields.io/matrix/fedify%3Amatrix.org
[@fedify@hollo.social badge]: https://fedi-badge.deno.dev/@fedify@hollo.social/followers.svg
[@fedify@hollo.social]: https://hollo.social/@fedify
[Fedify]: https://fedify.dev/
[Elysia]: https://fresh.deno.dev/
