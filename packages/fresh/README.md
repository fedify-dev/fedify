<!-- hongdown-proper-nouns: Fresh -->

<!-- deno-fmt-ignore-file -->

@fedify/fresh: Integrate Fedify with Fresh 2.x
==============================================

[![@fedify@hackers.pub][@fedify@hackers.pub badge]][@fedify@hackers.pub]

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

[@fedify@hackers.pub badge]: https://fedi-badge.minhee.org/@fedify@hackers.pub/followers.svg
[@fedify@hackers.pub]: https://hackers.pub/@fedify
[Fedify]: https://fedify.dev/
[Fresh]: https://fresh.deno.dev/
