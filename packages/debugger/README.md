<!-- deno-fmt-ignore-file -->

@fedify/debugger: Embedded ActivityPub debug dashboard for Fedify
=================================================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]
[![Follow @fedify@hollo.social][@fedify@hollo.social badge]][@fedify@hollo.social]

*This package is available since Fedify 2.0.0.*

This package provides an embedded real-time debug dashboard for inspecting
ActivityPub traces and activities in your federated server app.  It works as
a proxy that wraps your existing `Federation` object, intercepting HTTP requests
matching a configurable path prefix and serving the debug dashboard, while
delegating everything else to the inner federation.

~~~~ typescript
import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { createFederationDebugger } from "@fedify/debugger";

const innerFederation = createFederation<void>({
  kv: new MemoryKvStore(),
  // ... other federation options
});

const federation = createFederationDebugger(innerFederation);
~~~~

The `federation` object returned by `createFederationDebugger()` is a drop-in
replacement for the original.  You can use it everywhere you would normally use
the inner federation object, including with framework integrations such as
[`@fedify/hono`] and [`@fedify/express`].

> [!WARNING]
> The debug dashboard is intended for development use only.  It is strongly
> recommended to enable authentication if the dashboard is accessible over
> a network, as it exposes internal trace data.

For more details on configuration, authentication, dashboard pages, and
advanced setup, see the [Debugging section] of the Fedify manual.

[JSR badge]: https://jsr.io/badges/@fedify/debugger
[JSR]: https://jsr.io/@fedify/debugger
[npm badge]: https://img.shields.io/npm/v/@fedify/debugger?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/debugger
[@fedify@hollo.social badge]: https://fedi-badge.deno.dev/@fedify@hollo.social/followers.svg
[@fedify@hollo.social]: https://hollo.social/@fedify
[`@fedify/hono`]: https://jsr.io/@fedify/hono
[`@fedify/express`]: https://www.npmjs.com/package/@fedify/express
[Debugging section]: https://fedify.dev/manual/debug


Installation
------------

~~~~ sh
deno add jsr:@fedify/debugger  # Deno
npm  add     @fedify/debugger  # npm
pnpm add     @fedify/debugger  # pnpm
yarn add     @fedify/debugger  # Yarn
bun  add     @fedify/debugger  # Bun
~~~~
