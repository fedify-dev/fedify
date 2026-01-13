<!-- deno-fmt-ignore-file -->

@fedify/cfworkers: Adapt Fedify with Cloudflare Workers
=======================================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]
[![Follow @fedify@hollo.social][@fedify@hollo.social badge]][@fedify@hollo.social]

*This package is available since Fedify 1.9.0.*

This package provides [Fedify]'s [`KvStore`] and [`MessageQueue`]
implementations for [Cloudflare Workers]:

 -  [`WorkersKvStore`]
 -  [`WorkersMessageQueue`]

~~~~ typescript
import type { Federation } from "@fedify/fedify";
import { WorkersKvStore, WorkersMessageQueue } from "@fedify/cfworkers";

export default {
  async fetch(request, env, ctx) {
    const federation = createFederation({
      kv: new WorkersKvStore(env.KV_BINDING),
      queue: new WorkersMessageQueue(env.QUEUE_BINDING),
      // ... other options
    });
    
    return federation.handle(request, { contextData: env });
  },
  
  async queue(batch, env, ctx) {
    const federation = createFederation({
      kv: new WorkersKvStore(env.KV_BINDING),
      queue: new WorkersMessageQueue(env.QUEUE_BINDING),
      // ... other options
    });
    
    for (const message of batch.messages) {
      await federation.processQueuedTask(message.body);
    }
  }
} satisfies ExportedHandler<{ 
  KV_BINDING: KVNamespace<string>;
  QUEUE_BINDING: Queue;
}>;
~~~~

[JSR badge]: https://jsr.io/badges/@fedify/cfworkers
[JSR]: https://jsr.io/@fedify/cfworkers
[npm badge]: https://img.shields.io/npm/v/@fedify/cfworkers?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/cfworkers
[@fedify@hollo.social badge]: https://fedi-badge.deno.dev/@fedify@hollo.social/followers.svg
[@fedify@hollo.social]: https://hollo.social/@fedify
[Fedify]: https://fedify.dev/
[`KvStore`]: https://jsr.io/@fedify/fedify/doc/federation/~/KvStore
[`MessageQueue`]: https://jsr.io/@fedify/fedify/doc/federation/~/MessageQueue
[Cloudflare Workers]: https://workers.cloudflare.com/
[`WorkersKvStore`]: https://jsr.io/@fedify/cfworkers/doc/~/WorkersKvStore
[`WorkersMessageQueue`]: https://jsr.io/@fedify/cfworkers/doc/~/WorkersMessageQueue


`WorkersKvStore`
----------------

`WorkersKvStore` is a key–value store implementation for [Cloudflare Workers]
that uses Cloudflare's built-in [Cloudflare Workers KV] API.  It provides
persistent storage and good performance for Cloudflare Workers environments.
It's suitable for production use in Cloudflare Workers applications.

[Cloudflare Workers KV]: https://developers.cloudflare.com/kv/


`WorkersMessageQueue`
---------------------

`WorkersMessageQueue` is a message queue implementation for [Cloudflare Workers]
that uses Cloudflare's built-in [Cloudflare Queues] API.  It provides
scalability and high performance, making it suitable for production use in
Cloudflare Workers environments.  It requires a Cloudflare Queues setup and
management.

> [!NOTE]
> Since your `KVNamespace` and `Queue` are not bound to global variables, but
> rather passed as arguments to the `fetch()` and `queue()` methods, you need
> to instantiate your `Federation` object inside these methods, rather than at
> the top level.
>
> For better organization, you probably want to use a builder pattern to
> register your dispatchers and listeners before instantiating the `Federation`
> object.

> [!NOTE]
> The [Cloudflare Queues] API does not provide a way to poll messages from
> the queue, so `WorkersMessageQueue.listen()` method always throws
> a `TypeError` when invoked.  Instead, you should define a `queue()` method
> in your Cloudflare worker, which will be called by the Cloudflare Queues
> API when new messages are available in the queue.  Inside the `queue()`
> method, you need to call `Federation.processQueuedTask()` method to manually
> process the messages.  The `queue()` method is the only way to consume
> messages from the queue in Cloudflare Workers.

[Cloudflare Queues]: https://developers.cloudflare.com/queues/


Installation
------------

~~~~ sh
deno add jsr:@fedify/cfworkers  # Deno
npm  add     @fedify/cfworkers  # npm
pnpm add     @fedify/cfworkers  # pnpm
yarn add     @fedify/cfworkers  # Yarn
bun  add     @fedify/cfworkers  # Bun
~~~~
