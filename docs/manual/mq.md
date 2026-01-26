Message queue
=============

*This API is available since Fedify 0.5.0.*

The `MessageQueue` interface in Fedify provides an abstraction for handling
asynchronous message processing. This document will help you understand
how to choose a `MessageQueue` implementation and how to create your own custom
implementation if needed.


Choosing a `MessageQueue` implementation
----------------------------------------

When choosing an implementation, consider the following factors:

1.  *Runtime environment*: Are you using [Deno], [Node.js], [Bun],
    or another JavaScript runtime?
2.  *Scalability need*: Do you need to support multiple workers or servers?
3.  *Persistence requirements*: Do messages need to survive server restarts?
4.  *Development vs. production*: Are you in a development/testing phase or
    deploying to production?

Fedify provides several built-in `MessageQueue` implementations,
each suited for different use cases:

[Deno]: https://deno.com/
[Node.js]: https://nodejs.org/
[Bun]: https://bun.sh/

### `InProcessMessageQueue`

`InProcessMessageQueue` is a simple in-memory message queue that doesn't persist
messages between restarts. It's best suited for development and testing
environments.

Best for
:   Development and testing.

Pros
:   Simple, no external dependencies.

Cons
:   Not suitable for production, doesn't persist messages between restarts,
    no native retry mechanism.

~~~~ typescript twoslash
import type { KvStore } from "@fedify/fedify";
// ---cut-before---
import { createFederation, InProcessMessageQueue } from "@fedify/fedify";

const federation = createFederation<void>({
// ---cut-start---
  kv: null as unknown as KvStore,
// ---cut-end---
  queue: new InProcessMessageQueue(),  // [!code highlight]
  // ... other options
});
~~~~

### `DenoKvMessageQueue` (Deno only)

To use the [`DenoKvMessageQueue`], you need to install the *@fedify/denokv*
package first:

::: code-group

~~~~ bash [Deno]
deno add jsr:@fedify/denokv
~~~~

:::

[`DenoKvMessageQueue`] is a message queue implementation for [Deno] runtime that
uses Deno's built-in [`Deno.openKv()`] API. It provides persistent storage and
good performance for Deno environments.  It's suitable for production use in
Deno applications.

Best for
:   Production use in Deno environments.

Pros
:   Persistent, scalable, easy to set up, native retry with exponential backoff.

Cons
:   Only available in Deno runtime.

~~~~ typescript
import { createFederation } from "@fedify/fedify";
import { DenoKvMessageQueue } from "@fedify/denokv";

const kv = await Deno.openKv();
const federation = createFederation<void>({
  queue: new DenoKvMessageQueue(kv),  // [!code highlight]
  // ... other options
});
~~~~

[`DenoKvMessageQueue`]: https://jsr.io/@fedify/denokv/doc/mq/~/DenoKvMessageQueue
[`Deno.openKv()`]: https://docs.deno.com/api/deno/~/Deno.openKv

### [`RedisMessageQueue`]

To use [`RedisMessageQueue`], you need to install the *@fedify/redis* package:

::: code-group

~~~~ bash [Deno]
deno add jsr:@fedify/redis
~~~~

~~~~ bash [npm]
npm add @fedify/redis
~~~~

~~~~ bash [pnpm]
pnpm add @fedify/redis
~~~~

~~~~ bash [Yarn]
yarn add @fedify/redis
~~~~

~~~~ bash [Bun]
bun add @fedify/redis
~~~~

:::

[`RedisMessageQueue`] is a message queue implementation that uses Redis as
the backend. It provides scalability and high performance, making it
suitable for production use across various runtimes.  It requires a Redis
server setup and management.

Best for
:   Production use across various runtimes.

Pros
:   Persistent, scalable, supports multiple workers.

Cons
:   Requires Redis setup and management.

~~~~ typescript twoslash
import type { KvStore } from "@fedify/fedify";
// ---cut-before---
import { createFederation } from "@fedify/fedify";
import { RedisMessageQueue } from "@fedify/redis";
import Redis from "ioredis";

const federation = createFederation<void>({
// ---cut-start---
  kv: null as unknown as KvStore,
// ---cut-end---
  queue: new RedisMessageQueue(() => new Redis()),  // [!code highlight]
  // ... other options
});
~~~~

[`RedisMessageQueue`]: https://jsr.io/@fedify/redis/doc/mq/~/RedisMessageQueue

### [`PostgresMessageQueue`]

To use [`PostgresMessageQueue`], you need to install the *@fedify/postgres*
package first:

::: code-group

~~~~ bash [Deno]
deno add jsr:@fedify/postgres
~~~~

~~~~ bash [npm]
npm add @fedify/postgres
~~~~

~~~~ bash [pnpm]
pnpm add @fedify/postgres
~~~~

~~~~ bash [Yarn]
yarn add @fedify/postgres
~~~~

~~~~ bash [Bun]
bun add @fedify/postgres
~~~~

:::

[`PostgresMessageQueue`] is a message queue implementation that uses
a PostgreSQL database as the message queue backend.  Under the hood,
it uses a table for maintaining the queue, and [`LISTEN`]/[`NOTIFY`] for
real-time message delivery.  It's suitable for production use if you
already rely on PostgreSQL in your application.

Best for
:   Production use, a system that already uses PostgreSQL.

Pros
:   Persistent, scalable, supports multiple workers.

Cons
:   Requires PostgreSQL setup.

~~~~ typescript{6-8} twoslash
import type { KvStore } from "@fedify/fedify";
// ---cut-before---
import { createFederation } from "@fedify/fedify";
import { PostgresMessageQueue } from "@fedify/postgres";
import postgres from "postgres";

const federation = createFederation<void>({
// ---cut-start---
  kv: null as unknown as KvStore,
// ---cut-end---
  queue: new PostgresMessageQueue(
    postgres("postgresql://user:pass@localhost/db"),
  ),
  // ... other options
});
~~~~

[`PostgresMessageQueue`]: https://jsr.io/@fedify/postgres/doc/mq/~/PostgresMessageQueue
[`LISTEN`]: https://www.postgresql.org/docs/current/sql-listen.html
[`NOTIFY`]: https://www.postgresql.org/docs/current/sql-notify.html

### `AmqpMessageQueue`

To use [`AmqpMessageQueue`], you need to install the *@fedify/amqp* package
first:

::: code-group

~~~~ bash [Deno]
deno add jsr:@fedify/amqp
~~~~

~~~~ bash [npm]
npm add @fedify/amqp
~~~~

~~~~ bash [pnpm]
pnpm add @fedify/amqp
~~~~

~~~~ bash [Yarn]
yarn add @fedify/amqp
~~~~

~~~~ bash [Bun]
bun add @fedify/amqp
~~~~

:::

> [!NOTE]
>
> Although it's theoretically possible to be used with any AMQP 0-9-1 broker,
> [`AmqpMessageQueue`] is primarily designed for and tested with [RabbitMQ].

[`AmqpMessageQueue`] is a message queue implementation that uses AMQP 0-9-1
for message delivery.  The best-known AMQP broker is [RabbitMQ].  It provides
scalability and high performance, making it suitable for production use across
various runtimes.  It requires an AMQP broker setup and management.

Best for
:   Production use across various runtimes.

Pros
:   Persistent, reliable, scalable, supports multiple workers.

Cons
:   Requires AMQP broker setup and management.

~~~~ typescript twoslash
import type { KvStore } from "@fedify/fedify";
// ---cut-before---
import { createFederation } from "@fedify/fedify";
import { AmqpMessageQueue } from "@fedify/amqp";
import { connect } from "amqplib";

const federation = createFederation({
// ---cut-start---
  kv: null as unknown as KvStore,
// ---cut-end---
  queue: new AmqpMessageQueue(await connect("amqp://localhost")),  // [!code highlight]
  // ... other options
});
~~~~

*[AMQP]: Advanced Message Queuing Protocol
[`AmqpMessageQueue`]: https://jsr.io/@fedify/amqp/doc/mq/~/AmqpMessageQueue
[RabbitMQ]: https://www.rabbitmq.com/

### `SqliteMessageQueue`

*This API is available since Fedify 2.0.0.*

To use [`SqliteMessageQueue`], you need to install the *@fedify/sqlite* package
first:

::: code-group

~~~~ bash [Deno]
deno add jsr:@fedify/sqlite
~~~~

~~~~ bash [npm]
npm add @fedify/sqlite
~~~~

~~~~ bash [pnpm]
pnpm add @fedify/sqlite
~~~~

~~~~ bash [Yarn]
yarn add @fedify/sqlite
~~~~

~~~~ bash [Bun]
bun add @fedify/sqlite
~~~~

:::

[`SqliteMessageQueue`] is a message queue implementation that uses SQLite as
the backend.  It uses polling to check for new messages and is designed for
single-node deployments.  It's suitable for development, testing, and
small-scale production use where simplicity is preferred over high throughput.
It uses native sqlite modules, [`node:sqlite`] for Node.js and Deno,
[`bun:sqlite`] for Bun.

Best for
:   Development and testing.

Pros
:   Simple, persistent with minimal configuration.

Cons
:   Limited scalability, not suitable for high-traffic production.

> [!NOTE]
> `SqliteMessageQueue` uses `DELETE ... RETURNING` to atomically fetch and
> delete the oldest message that is ready to be processed.  This requires
> SQLite 3.35.0 or later.

::: code-group

~~~~ typescript twoslash [Deno]
import type { KvStore } from "@fedify/fedify";
// ---cut-before---
import { DatabaseSync } from "node:sqlite";
import { createFederation } from "@fedify/fedify";
import { SqliteMessageQueue } from "@fedify/sqlite";

const db = new DatabaseSync(":memory:");
const federation = createFederation<void>({
  // ...
  // ---cut-start---
    kv: null as unknown as KvStore,
  // ---cut-end---
  queue: new SqliteMessageQueue(db),  // [!code highlight]
});
~~~~

~~~~ typescript twoslash [Node.js]
import type { KvStore } from "@fedify/fedify";
// ---cut-before---
import { DatabaseSync } from "node:sqlite";
import { createFederation } from "@fedify/fedify";
import { SqliteMessageQueue } from "@fedify/sqlite";

const db = new DatabaseSync(":memory:");
const federation = createFederation<void>({
  // ...
  // ---cut-start---
    kv: null as unknown as KvStore,
  // ---cut-end---
  queue: new SqliteMessageQueue(db),  // [!code highlight]
});
~~~~

~~~~ typescript [Bun]
import type { KvStore } from "@fedify/fedify";
// ---cut-before---
import { Database } from "bun:sqlite";
import { createFederation } from "@fedify/fedify";
import { SqliteMessageQueue } from "@fedify/sqlite";

const db = new Database(":memory:");
const federation = createFederation<void>({
  // ...
  // ---cut-start---
    kv: null as unknown as KvStore,
  // ---cut-end---
  queue: new SqliteMessageQueue(db),  // [!code highlight]
});
~~~~

:::

[`SqliteMessageQueue`]: https://jsr.io/@fedify/sqlite/doc/mq/~/SqliteMessageQueue

### `WorkersMessageQueue` (Cloudflare Workers only)

*This API is available since Fedify 1.6.0.*

To use the [`WorkersMessageQueue`], you need to install the *@fedify/cfworkers*
package first:

::: code-group

~~~~ bash [Deno]
deno add jsr:@fedify/cfworkers
~~~~

~~~~ bash [npm]
npm add @fedify/cfworkers
~~~~

~~~~ bash [pnpm]
pnpm add @fedify/cfworkers
~~~~

~~~~ bash [Yarn]
yarn add @fedify/cfworkers
~~~~

~~~~ bash [Bun]
bun add @fedify/cfworkers
~~~~

:::

`WorkersMessageQueue` is a message queue implementation for [Cloudflare Workers]
that uses Cloudflare's built-in [Cloudflare Queues] API.  It provides
scalability and high performance, making it suitable for production use in
Cloudflare Workers environments.  It requires a Cloudflare Queues setup and
management.

Best for
:   Production use in Cloudflare Workers environments.

Pros
:   Persistent, reliable, scalable, easy to set up, native retry with exponential
    backoff and dead-letter queues.

Cons
:   Only available in Cloudflare Workers runtime.

~~~~ typescript twoslash
// @noErrors: 2322 2345
import type { FederationBuilder, KvStore } from "@fedify/fedify";
const builder = undefined as unknown as FederationBuilder<void>;
// ---cut-before---
import type { Federation, Message } from "@fedify/fedify";
import { WorkersMessageQueue } from "@fedify/cfworkers";

export default {
  async fetch(request, env, ctx) {
    const federation: Federation<void> = await builder.build({
// ---cut-start---
      kv: undefined as unknown as KvStore,
// ---cut-end---
      queue: new WorkersMessageQueue(env.QUEUE_BINDING),
    });
    // Omit the rest of the code for brevity
  },

  // Since defining a `queue()` method is the only way to consume messages
  // from the queue in Cloudflare Workers, we need to define it so that
  // the messages can be manually processed by `Federation.processQueuedTask()`
  // method:
  async queue(batch, env, ctx) {
    const federation: Federation<void> = await builder.build({
// ---cut-start---
      kv: undefined as unknown as KvStore,
// ---cut-end---
      queue: new WorkersMessageQueue(env.QUEUE_BINDING),
    });
    for (const msg of batch.messages) {
      await federation.processQueuedTask(
        undefined,  // You need to pass your context data here
        msg.body as Message,  // You need to cast the message body to `Message`
      );
    }
  }
} satisfies ExportedHandler<{ QUEUE_BINDING: Queue }>;
~~~~

> [!NOTE]
> Since your `Queue` is not bound to a global variable, but rather passed as
> an argument to the `fetch()` and `queue()` methods, you need to instantiate
> your `Federation` object inside these methods, rather than at the top level.
>
> For better organization, you probably want to use a builder pattern to
> register your dispatchers and listeners before instantiating the `Federation`
> object.  See the [*Builder pattern for structuring*
> section](./federation.md#builder-pattern-for-structuring) for details.

> [!NOTE]
> The [Cloudflare Queues] API does not provide a way to poll messages from
> the queue, so `WorkersMessageQueue.listen()` method always throws
> a `TypeError` when invoked.  Instead, you should define a `queue()` method
> in your Cloudflare worker, which will be called by the Cloudflare Queues
> API when new messages are available in the queue.  Inside the `queue()`
> method, you need to call `Federation.processQueuedTask()` method to manually
> process the messages.  The `queue()` method is the only way to consume
> messages from the queue in Cloudflare Workers.

[Cloudflare Workers]: https://workers.cloudflare.com/
[Cloudflare Queues]: https://developers.cloudflare.com/queues/


Implementing a custom `MessageQueue`
------------------------------------

If the built-in implementations don't meet your needs, you can create a custom
`MessageQueue`.  Here's a guide to implementing your own:

### Implement the `MessageQueue` interface

Create a class that implements the `MessageQueue` interface, which includes
the `~MessageQueue.enqueue()` and `~MessageQueue.listen()` methods:

~~~~ typescript twoslash
import type {
  MessageQueue,
  MessageQueueEnqueueOptions,
  MessageQueueListenOptions,
} from "@fedify/fedify";

class CustomMessageQueue implements MessageQueue {
  // Set to true if your backend provides native retry mechanisms
  readonly nativeRetrial = false;

  async enqueue(
    message: any,
    options?: MessageQueueEnqueueOptions,
  ): Promise<void> {
    // Implementation here
  }

  async listen(
    handler: (message: any) => Promise<void> | void,
    options: MessageQueueListenOptions = {},
  ): Promise<void> {
    // Implementation here
  }
}
~~~~

### Implement `~MessageQueue.enqueue()` method

This method should add the message to your queue system.
Handle the `~MessageQueueEnqueueOptions.delay` option if provided in
`MessageQueueEnqueueOptions`.  If provided, handle the
`~MessageQueueEnqueueOptions.orderingKey` option to ensure messages with the
same ordering key are processed sequentially.  Ensure the method is non-blocking
(use async operations where necessary).

### Implement `~MessageQueue.enqueueMany` method (optional)

*This API is available since Fedify 1.5.0.*

This method should add multiple messages to your queue system at once.
Handle the `~MessageQueueEnqueueOptions.delay` option if provided in
`MessageQueueEnqueueOptions`.  Ensure the method is non-blocking
(use async operations where necessary).

Although this method is optional, it's recommended to implement it
for better performance when enqueuing multiple messages at once.
Otherwise, Fedify will call `~MessageQueue.enqueue()` for each message
individually, which may be less efficient.

### Implement `~MessageQueue.listen()` method

This method should start a process that listens for new messages.
When a message is received, it should call the provided `handler` function.
Ensure proper error handling to prevent the listener from crashing.

> [!NOTE]
> A `Promise` object it returns should never resolve unless the given
> `~MessageQueueListenOptions.signal` is triggered.

### Consider additional features

Here's a list of additional features you might want to implement in your
custom `MessageQueue`:

 -  *Message persistence*: Store messages in a database or file system
    if your backend doesn't provide persistence.
 -  *Multiple workers*: Guarantee a queue can be consumed by multiple workers.
 -  *Message acknowledgment*: Implement message acknowledgment to ensure
    messages are processed only once.

However, you don't need to implement retry logic yourself, as Fedify handles
retrying failed messages automatically.  If your message queue backend provides
native retry mechanisms (like exponential backoff, dead-letter queues, etc.),
you can set the `nativeRetrial` property to `true` to indicate this.
When this property is `true`, Fedify will skip its own retry logic and rely
on your backend to handle retries, avoiding duplicate retry mechanisms.


Parallel message processing
---------------------------

*This API is available since Fedify 1.0.0.*

Fedify supports parallel message processing by running multiple workers
concurrently.  To enable parallel processing, wrap your `MessageQueue` with
`ParallelMessageQueue`, a special implementation of the `MessageQueue` interface
designed to process messages in parallel.  It acts as a decorator for another
`MessageQueue` implementation, allowing for concurrent processing of messages
up to a specified number of workers.  The `ParallelMessageQueue` inherits
the `nativeRetrial` property from the wrapped queue:

~~~~ typescript twoslash
import type { KvStore } from "@fedify/fedify";
// ---cut-before---
import { createFederation, ParallelMessageQueue } from "@fedify/fedify";
import { RedisMessageQueue } from "@fedify/redis";
import Redis from "ioredis";

const baseQueue = new RedisMessageQueue(() => new Redis());

// Use parallelQueue in your Federation configuration
const federation = createFederation<void>({
  queue: new ParallelMessageQueue(baseQueue, 5),  // [!code highlight]
  // ... other options
  // ---cut-start---
  kv: null as unknown as KvStore,
  // ---cut-end---
});
~~~~

> [!NOTE]
> The workers do not run in truly parallel, in the sense that they are not
> running in separate threads or processes.  They are running in the same
> process, but are scheduled to run in parallel.  Hence, this is useful for
> I/O-bound tasks, but not for CPU-bound tasks, which is okay for Fedify's
> workloads.
>
> If your [inbox listeners](./inbox.md) are CPU-bound, you should consider
> running multiple nodes of your application so that each node can process
> messages in parallel with the shared message queue.


Separating message processing from the main process
---------------------------------------------------

*This API is available since Fedify 1.0.0.*

On high-traffic servers, it's common to separate message processing from
the main server process to avoid blocking the main event loop.  To achieve this,
you can use the `~FederationOptions.manuallyStartQueue` option and
`Federation.startQueue()` method:

::: code-group

~~~~ typescript{11-17} twoslash [Deno]
import type { KvStore } from "@fedify/fedify";
// ---cut-before---
import { createFederation } from "@fedify/fedify";
import { RedisMessageQueue } from "@fedify/redis";
import Redis from "ioredis";

const federation = createFederation<void>({
  queue: new RedisMessageQueue(() => new Redis()),
  manuallyStartQueue: true,  // [!code highlight]
  // ... other options
  // ---cut-start---
  kv: null as unknown as KvStore,
  // ---cut-end---
});

// Start the message queue manually only in worker nodes.
// On non-worker nodes, the queue won't be started.
if (Deno.env.get("NODE_TYPE") === "worker") {
  const controller = new AbortController();
  Deno.addSignalListener("SIGINT", () => controller.abort());
  await federation.startQueue(undefined, { signal: controller.signal });
}
~~~~

~~~~ typescript{12-18} twoslash [Node.js/Bun]
import type { KvStore } from "@fedify/fedify";
// ---cut-before---
import { createFederation } from "@fedify/fedify";
import { RedisMessageQueue } from "@fedify/redis";
import Redis from "ioredis";
import process from "node:process";

const federation = createFederation<void>({
  queue: new RedisMessageQueue(() => new Redis()),
  manuallyStartQueue: true,  // [!code highlight]
  // ... other options
  // ---cut-start---
  kv: null as unknown as KvStore,
  // ---cut-end---
});

// Start the message queue manually only in worker nodes.
// On non-worker nodes, the queue won't be started.
if (process.env.NODE_TYPE === "worker") {
  const controller = new AbortController();
  process.on("SIGINT", () => controller.abort());
  await federation.startQueue(undefined, { signal: controller.signal });
}
~~~~

:::

The key point is to ensure that messages are enqueued only from
the `NODE_TYPE=web` nodes, and messages are processed only from
the `NODE_TYPE=worker` nodes:

| `NODE_TYPE` | Process messages? | Enqueue messages? |
| ----------- | ----------------- | ----------------- |
| `web`       | Do not process    | Enqueue           |
| `worker`    | Process           | Do not enqueue    |

This separation allows you to scale your application by running multiple worker
nodes that process messages concurrently.  It also helps to keep the main
server process responsive by offloading message processing to worker nodes.

> [!NOTE]
> To ensure that messages are enqueued only from the `NODE_TYPE=web` nodes,
> you should not place the `NODE_TYPE=worker` nodes behind a load balancer.


Native retry mechanisms
-----------------------

*This API is available since Fedify 1.7.0.*

Some message queue backends provide their own retry mechanisms with features
like exponential backoff, dead-letter queues, and automatic failure handling.
To avoid duplicate retry logic and improve efficiency, Fedify supports
the `~MessageQueue.nativeRetrial` property on `MessageQueue` implementations.

When `MessageQueue.nativeRetrial` is `true`, Fedify will skip its own retry
logic and rely entirely on the backend's native retry mechanisms.
When `false` or omitted, Fedify handles retries using its own retry policies.

### Current implementations

The following implementations currently support native retry:

`DenoKvMessageQueue`
:   Deno KV provides automatic retry with exponential backoff
    (`~MessageQueue.nativeRetrial` is `true`).

`WorkersMessageQueue`
:   Cloudflare Queues provide automatic retry with exponential backoff and
    dead-letter queues (`~MessageQueue.nativeRetrial` is `true`).

The following implementations do not yet support native retry:

`InProcessMessageQueue`
:   No native retry support (`~MessageQueue.nativeRetrial` is `false`).

[`RedisMessageQueue`]
:   Native retry support planned for future release.

[`PostgresMessageQueue`]
:   Native retry support planned for future release.

[`AmqpMessageQueue`]
:   Native retry support planned for future release.

[`SqliteMessageQueue`]
:   No native retry support (`~MessageQueue.nativeRetrial` is `false`).

`ParallelMessageQueue` inherits the `~MessageQueue.nativeRetrial` value from
the wrapped queue.

### Benefits of native retry

Using native retry mechanisms provides several advantages:

Reduced overhead
:   Eliminates duplicate retry logic between Fedify and the message queue
    backend.

Better reliability
:   Leverages proven retry mechanisms from established queue backends.

Improved observability
:   Backend-native retry mechanisms often provide better monitoring and
    debugging capabilities.

Optimized performance
:   Backend-specific optimizations for retry logic.


Ordering guarantees
-------------------

*This API is available since Fedify 2.0.0.*

By default, message queues do not guarantee the order in which messages are
processed.  This can cause issues when related messages need to be processed
in a specific order.  For example, when a post is created and quickly deleted,
the `Delete` activity might arrive before the `Create` activity, resulting in
“zombie posts” that should have been deleted.

To address this, you can use the `~MessageQueueEnqueueOptions.orderingKey`
option when enqueuing messages.  Messages with the same ordering key are
guaranteed to be processed in the order they were enqueued.  Messages without
an ordering key or with different ordering keys can be processed in parallel.

~~~~ typescript twoslash
import type { KvStore, MessageQueue } from "@fedify/fedify";
declare const queue: MessageQueue;
// ---cut-before---
// These messages will be processed in order (1, 2, 3)
await queue.enqueue({ action: "create", noteId: "123" }, { orderingKey: "note:123" });
await queue.enqueue({ action: "update", noteId: "123" }, { orderingKey: "note:123" });
await queue.enqueue({ action: "delete", noteId: "123" }, { orderingKey: "note:123" });

// These messages can be processed in parallel with the above
await queue.enqueue({ action: "create", noteId: "456" }, { orderingKey: "note:456" });
await queue.enqueue({ action: "delete", noteId: "456" }, { orderingKey: "note:456" });
~~~~

### Implementation support

The following implementations support ordering keys:

| Implementation           | Ordering Key Support |
| ------------------------ | -------------------- |
| `InProcessMessageQueue`  | Yes                  |
| [`DenoKvMessageQueue`]   | Not yet              |
| [`RedisMessageQueue`]    | Yes                  |
| [`PostgresMessageQueue`] | Yes                  |
| [`AmqpMessageQueue`]     | Not yet              |
| [`SqliteMessageQueue`]   | Yes                  |
| `WorkersMessageQueue`    | Not yet              |

> [!NOTE]
> When using `ParallelMessageQueue`, the ordering guarantee is preserved.
> Messages with the same ordering key will never be processed concurrently
> by different workers, ensuring sequential processing within each key.


Using different message queues for different tasks
--------------------------------------------------

*This API is available since Fedify 1.3.0.*

In some cases, you may want to use different message queues for different tasks,
such as using a faster-but-less-persistent queue for outgoing activities and
a slower-but-more-persistent queue for incoming activities.  To achieve this,
you can pass `FederationQueueOptions` to the `FederationOptions.queue`
option.

For example, the following code shows how to use a [`PostgresMessageQueue`] for
the inbox and a [`RedisMessageQueue`] for the outbox:

~~~~ typescript twoslash
import {
  createFederation,
  type KvStore,
  MemoryKvStore,
  type MessageQueue,
} from "@fedify/fedify";
import { PostgresMessageQueue } from "@fedify/postgres";
import { RedisMessageQueue } from "@fedify/redis";
import postgres from "postgres";
import Redis from "ioredis";

// ---cut-before---
const federation = createFederation<void>({
// ---cut-start---
  kv: null as unknown as KvStore,
// ---cut-end---
  queue: {
    inbox: new PostgresMessageQueue(
      postgres("postgresql://user:pass@localhost/db")
    ),
    outbox: new RedisMessageQueue(() => new Redis()),
  },
  // ... other options
});
~~~~

Or, you can provide a message queue for only the `inbox` or `outbox` by omitting
the other:

~~~~ typescript twoslash
import {
  createFederation,
  type KvStore,
  MemoryKvStore,
  type MessageQueue,
} from "@fedify/fedify";
import { PostgresMessageQueue } from "@fedify/postgres";
import postgres from "postgres";

// ---cut-before---
const federation = createFederation<void>({
// ---cut-start---
  kv: null as unknown as KvStore,
// ---cut-end---
  queue: {
    inbox: new PostgresMessageQueue(
      postgres("postgresql://user:pass@localhost/db")
    ),
    // outbox is not provided; outgoing activities will not be queued
  },
  // ... other options
});
~~~~

When you [manually start a task
worker](#separating-message-processing-from-the-main-process), you can specify
which queue to start (if `queue` is not provided in the options, it will start
all queues).  The following example shows how to start only the `inbox` queue:

::: code-group

~~~~ typescript twoslash [Deno]
import type { KvStore } from "@fedify/fedify";
import { createFederation } from "@fedify/fedify";
import { RedisMessageQueue } from "@fedify/redis";
import Redis from "ioredis";

const federation = createFederation<void>({
  queue: new RedisMessageQueue(() => new Redis()),
  manuallyStartQueue: true,  // [!code highlight]
  // ... other options
  // ---cut-start---
  kv: null as unknown as KvStore,
  // ---cut-end---
});

// ---cut-before---
if (Deno.env.get("NODE_TYPE") === "worker") {
  const controller = new AbortController();
  Deno.addSignalListener("SIGINT", () => controller.abort());
  await federation.startQueue(undefined, {
    signal: controller.signal,
    queue: "inbox",  // [!code highlight]
  });
}
~~~~

~~~~ typescript twoslash [Node.js/Bun]
import type { KvStore } from "@fedify/fedify";
import { createFederation } from "@fedify/fedify";
import { RedisMessageQueue } from "@fedify/redis";
import Redis from "ioredis";
import process from "node:process";

const federation = createFederation<void>({
  queue: new RedisMessageQueue(() => new Redis()),
  manuallyStartQueue: true,  // [!code highlight]
  // ... other options
  // ---cut-start---
  kv: null as unknown as KvStore,
  // ---cut-end---
});

// ---cut-before---
if (process.env.NODE_TYPE === "worker") {
  const controller = new AbortController();
  process.on("SIGINT", () => controller.abort());
  await federation.startQueue(undefined, {
    signal: controller.signal,
    queue: "inbox",  // [!code highlight]
  });
}
~~~~

:::
