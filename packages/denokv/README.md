<!-- deno-fmt-ignore-file -->

@fedify/denokv: Adapt Fedify with Deno KV
=========================================

[![JSR][JSR badge]][JSR]
[![@fedify@hackers.pub][@fedify@hackers.pub badge]][@fedify@hackers.pub]

*This package is available since Fedify 1.9.0.*

> [!WARNING]
> This package is deprecated since Fedify 2.5.0.
> [Deno's team is joining Cloudflare][deno-announcement], and Deno KV was built
> primarily for Deno Deploy, which is shutting down.  Fedify keeps supporting
> `@fedify/denokv` throughout the 2.x series, but the package will be removed
> in Fedify 3.0.0. Use [`@fedify/sqlite`] for local or single-node deployments,
> or [`@fedify/postgres`], [`@fedify/redis`], [`@fedify/mysql`], or
> [`@fedify/cfworkers`] for production deployments.  See [#1336] for the
> removal plan.

This package provides [Fedify]'s [`KvStore`] and [`MessageQueue`]
implementations for [Deno] runtime that uses Deno's built-in [`Deno.openKv()`]
API:

 -  [`DenoKvStore`]
 -  [`DenoKvMessageQueue`]

~~~~ typescript
import { createFederation } from "@fedify/fedify";
import { DenoKvStore, DenoKvMessageQueue } from "@fedify/denokv";

const kv = await Deno.openKv();

const federation = createFederation({
  kv: new DenoKvStore(kv),
  queue: new DenoKvMessageQueue(kv),
  // ... other options
});
~~~~

[JSR badge]: https://jsr.io/badges/@fedify/denokv
[JSR]: https://jsr.io/@fedify/denokv
[@fedify@hackers.pub badge]: https://fedi-badge.minhee.org/@fedify@hackers.pub/followers.svg
[@fedify@hackers.pub]: https://hackers.pub/@fedify
[deno-announcement]: https://deno.com/blog/cloudflare
[`@fedify/sqlite`]: https://jsr.io/@fedify/sqlite
[`@fedify/postgres`]: https://jsr.io/@fedify/postgres
[`@fedify/redis`]: https://jsr.io/@fedify/redis
[`@fedify/mysql`]: https://jsr.io/@fedify/mysql
[`@fedify/cfworkers`]: https://jsr.io/@fedify/cfworkers
[#1336]: https://github.com/fedify-dev/fedify/issues/1336
[Fedify]: https://fedify.dev/
[`KvStore`]: https://jsr.io/@fedify/fedify/doc/federation/~/KvStore
[`MessageQueue`]: https://jsr.io/@fedify/fedify/doc/federation/~/MessageQueue
[Deno]: https://deno.com/
[`Deno.openKv()`]: https://docs.deno.com/api/deno/~/Deno.openKv
[`DenoKvStore`]: https://jsr.io/@fedify/denokv/doc/~/DenoKvStore
[`DenoKvMessageQueue`]: https://jsr.io/@fedify/denokv/doc/~/DenoKvMessageQueue


`DenoKvStore`
-------------

`DenoKvStore` is a key–value store implementation for [Deno] runtime that uses
Deno's built-in [`Deno.openKv()`] API. It provides persistent storage and good
performance for Deno environments.  It's suitable for production use in Deno
applications.


`DenoKvMessageQueue`
--------------------

`DenoKvMessageQueue` is a message queue implementation for [Deno] runtime that
uses Deno's built-in [`Deno.openKv()`] API. It provides persistent storage and
good performance for Deno environments.  It's suitable for production use in
Deno applications.


Installation
------------

~~~~ sh
deno add jsr:@fedify/denokv  # Deno
~~~~
