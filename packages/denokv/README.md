<!-- deno-fmt-ignore-file -->

@fedify/denokv: Adapt Fedify with Deno KV
=========================================

[![JSR][JSR badge]][JSR]
[![Follow @fedify@hollo.social][@fedify@hollo.social badge]][@fedify@hollo.social]

*This package is available since Fedify 1.9.0.*

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
[@fedify@hollo.social badge]: https://fedi-badge.deno.dev/@fedify@hollo.social/followers.svg
[@fedify@hollo.social]: https://hollo.social/@fedify
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
