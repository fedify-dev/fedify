<!-- hongdown-proper-nouns: Fresh -->

<!-- deno-fmt-ignore-file -->

@fedify/fresh: Integrate Fedify with Fresh 2.x
==============================================

[![@fedify@hackers.pub][@fedify@hackers.pub badge]][@fedify@hackers.pub]

This package provides a simple way to integrate [Fedify] with [Fresh].

> [!WARNING]
> This integration remains supported throughout the Fedify 2.x series, but
> Fresh is not recommended for new projects.  Deno's team will end its own
> development of the Deno runtime after another year of bug fixes and security
> updates, and this package targets Fresh 2.x, which runs on Deno.  Fresh has
> announced plans for non-Deno runtimes in Fresh 3, but that support is not yet
> released or stable enough for this integration and its example.
>
> The integration is tentatively planned for removal in Fedify 3.0.0; see
> [#1326] for the removal plan and the reassessment it requires.  That plan may
> be reconsidered if Fresh gains stable support that lets Fedify run and test
> the integration and its example on a supported non-Deno runtime.  See the
> [Deno announcement] and the [Fresh announcement] for background.

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
[#1326]: https://github.com/fedify-dev/fedify/issues/1326
[Deno announcement]: https://deno.com/blog/cloudflare
[Fresh announcement]: https://github.com/freshframework/fresh/discussions/3830
