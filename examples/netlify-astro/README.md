<!-- deno-fmt-ignore-file -->

Fedify, astro, and Netlify example
==================================

This example combines [`@fedify/astro`], [`@astrojs/netlify`],
[`@fedify/netlify`], and [`@fedify/postgres`].  Astro serves the ActivityPub
routes through Netlify Functions, Netlify Database stores Fedify state, and
Netlify Async Workloads delivers queue jobs to
*netlify/functions/fedify-queue.ts*.

[`@fedify/astro`]: https://jsr.io/@fedify/astro
[`@astrojs/netlify`]: https://docs.astro.build/en/guides/integrations-guide/netlify/
[`@fedify/netlify`]: ../../packages/netlify/
[`@fedify/postgres`]: https://jsr.io/@fedify/postgres


Local development
-----------------

From the repository root:

~~~~ sh
mise deps
pnpm --dir examples/netlify-astro dev
~~~~

Local development uses `MemoryKvStore` and `InProcessMessageQueue`, so it does
not require Netlify credentials.  Open <http://localhost:4321/> and look up
`@netlify@localhost:4321` through a tunnel when testing federation.


Deploying to Netlify
--------------------

1.  Create a Netlify site for this directory.
2.  [Provision Netlify Database] for the site.
3.  [Install and configure Async Workloads].
4.  Deploy with the build command and publish directory from *netlify.toml*.

The production web Function and workload Function both build Fedify with
`manuallyStartQueue: true`.  Queue consumption happens only through
`createNetlifyQueueHandler()`; `NetlifyMessageQueue.listen()` is unsupported.

The workload is disabled when Netlify's `CONTEXT` is not `production`.  Keep
that guard unless deploy previews use an isolated hostname and database and
are intentionally allowed to federate.

Async Workloads accepts payloads smaller than 500 KB.  Store large media
outside queue messages and refer to it by URL.

[Provision Netlify Database]: https://docs.netlify.com/build/data-and-storage/netlify-database/
[Install and configure Async Workloads]: https://docs.netlify.com/build/async-workloads/get-started/
