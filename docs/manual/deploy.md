---
description: >-
  This document explains how to deploy Fedify applications to various platforms
  and runtime environments, with specific guidance for serverless platforms
  that have unique architectural constraints.
---

Deployment
==========

Fedify applications can be deployed to various platforms and runtime
environments.  While the core development patterns remain consistent across
platforms, some deployment targets—particularly serverless environments—require
specific architectural considerations and configuration patterns.

This document covers deployment-specific concerns that go beyond basic
application development, focusing on platform-specific requirements,
configuration patterns, and operational considerations.


General deployment considerations
---------------------------------

### Environment configuration

Fedify applications typically require several environment-specific
configurations that should be managed through environment variables or secure
configuration systems:

Domain configuration
:   Set your canonical domain through
    the [`origin`](./federation.md#explicitly-setting-the-canonical-origin)
    option or ensure proper `Host` header handling.

Database connections
:   Configure your chosen [key–value store](./kv.md) and
    [message queue](./mq.md) implementations.

Cryptographic keys
:   Securely manage actor key pairs outside your application code.

### Observability

Fedify provides comprehensive observability features that should be configured
for production deployments:

Logging
:   [Configure loggers](./log.md) with appropriate log levels and sinks (output
    destinations) for your environment.

Tracing
:   Enable [OpenTelemetry](./opentelemetry.md) integration to trace ActivityPub
    operations across your infrastructure.

Monitoring
:   Set up monitoring for queue depths, delivery success rates, and response
    times to ensure your application is performing optimally.

### Scaling considerations

ActivityPub applications have unique scaling characteristics due to their
federated nature.  Consider the following when deploying:

Message processing
:   [Consider separating web traffic from background message
    processing](./mq.md#separating-message-processing-from-the-main-process)
    for better resource utilization.

Database performance
:   Optimize your [key–value store](./kv.md) and [message queue](./mq.md) for
    the expected load patterns, including read/write ratios and concurrency.


Traditional server environments
-------------------------------

While Fedify works seamlessly with traditional server deployments on Node.js,
Bun, and Deno, each runtime has specific considerations for production use.

### Node.js

Node.js does not provide a built-in HTTP server that accepts `fetch()`-style
handlers, so you will need an adapter.  The [@hono/node-server] package provides
this functionality:

~~~~ typescript twoslash
import { MemoryKvStore } from "@fedify/fedify";
// ---cut-before---
import { serve } from "@hono/node-server";
import { createFederation } from "@fedify/fedify";

const federation = createFederation<void>({
// ---cut-start---
  kv: new MemoryKvStore(),
// ---cut-end---
  // Configuration...
});

serve({
  async fetch(request) {
    return await federation.fetch(request, { contextData: undefined });
  },
});
~~~~

For production deployments, consider using process managers like [PM2] or
[systemd] to ensure reliability and automatic restarts.

[@hono/node-server]: https://github.com/honojs/node-server
[PM2]: https://pm2.keymetrics.io/
[systemd]: https://systemd.io/

### Bun and Deno

Both Bun and Deno provide built-in HTTP servers with `fetch()`-style handlers,
making integration straightforward:

~~~~ typescript twoslash [index.ts]
import { MemoryKvStore } from "@fedify/fedify";
// ---cut-before---
import { createFederation } from "@fedify/fedify";

const federation = createFederation<void>({
// ---cut-start---
  kv: new MemoryKvStore(),
// ---cut-end---
  // Configuration...
});

export default {
  async fetch(request: Request): Promise<Response> {
    return await federation.fetch(request, { contextData: undefined });
  },
};
~~~~

Then, you can run your application using the built-in server commands:

::: code-group

~~~~ bash [Deno]
deno serve index.ts
~~~~

~~~~ bash [Bun]
bun run index.ts
~~~~

:::

> [!TIP] SEE ALSO
>
> See also the documentation for [`deno serve`] and
> [Bun's `export default` syntax].

[`deno serve`]: https://docs.deno.com/runtime/reference/cli/serve/
[Bun's `export default` syntax]: https://bun.sh/docs/api/http#export-default-syntax

### Key–value store and message queue

For traditional server environments, choose persistent storage solutions based
on your infrastructure:

Development
:   Use [`MemoryKvStore`](./kv.md#memorykvstore) and
    [`InProcessMessageQueue`](./mq.md#inprocessmessagequeu) for quick setup.

Production
:   Consider [`PostgresKvStore`](./kv.md#postgreskvstore) and
    [`PostgresMessageQueue`](./mq.md#postgresmessagequeue) if you already use
    PostgreSQL, or [`RedisKvStore`](./kv.md#rediskvstore) and
    [`RedisMessageQueue`](./mq.md#redismessagequeue) for dedicated caching
    infrastructure. There is also [`AmqpMessageQueue`](./mq.md#amqpmessagequeue)
    for RabbitMQ users.

### Key management

In traditional server environments, actor key pairs should be generated once
during user registration and securely stored in your database.  Avoid generating
keys on every server restart—this will break federation with other servers that
have cached your public keys.

### Web frameworks

For web framework integration patterns,
see the [*Integration* section](./integration.md), which covers Express, Hono,
Fresh, SvelteKit, and other popular frameworks.


Cloudflare Workers
------------------

*Cloudflare Workers support is available in Fedify 1.6.0 and later.*

[Cloudflare Workers] presents a unique deployment environment with specific
constraints and architectural requirements.  Unlike traditional server
environments, Workers operate within strict execution time limits and provide
access to platform services through binding mechanisms rather than global
imports.

[Cloudflare Workers]: https://workers.cloudflare.com/

### Node.js compatibility

Fedify requires [Node.js compatibility flag] to function properly on Cloudflare
Workers.  Add the following to your *wrangler.jsonc* configuration file:

```jsonc
"compatibility_date": "2025-05-31",
"compatibility_flags": ["nodejs_compat"],
```

This enables essential Node.js APIs that Fedify depends on, including
cryptographic functions and DNS resolution.

[Node.js compatibility flag]: https://developers.cloudflare.com/workers/runtime-apis/nodejs/

### Builder pattern

Unlike other environments where you can initialize a `Federation` object
globally, Workers only provide access to bindings (KV, Queues, etc.) through
`env` parameter in request handlers.  This makes the [builder
pattern](./federation.md#builder-pattern-for-structuring) mandatory:

~~~~ typescript twoslash
// @noErrors: 2345
type Env = {
  KV_NAMESPACE: KVNamespace<string>;
  QUEUE: Queue;
};
import { Person } from "@fedify/vocab";
// ---cut-before---
import { createFederationBuilder } from "@fedify/fedify";
import { WorkersKvStore, WorkersMessageQueue } from "@fedify/cfworkers";

const builder = createFederationBuilder<Env>();

// Configure your federation using the builder
builder.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
  // Your actor logic here
// ---cut-start---
  return new Person({});
// ---cut-end---
});

// Export the default handler
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const federation = await builder.build({
      kv: new WorkersKvStore(env.KV_NAMESPACE),
      queue: new WorkersMessageQueue(env.QUEUE),
      // Other options...
    });

    return federation.fetch(request, { contextData: env });
  },
};
~~~~

### Manual queue processing

Cloudflare Queues don't provide polling-based APIs, so the `WorkersMessageQueue`
cannot implement a traditional `~MessageQueue.listen()` method.  Instead, you
must manually connect queue handlers:

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederationBuilder, type Message } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
import { WorkersKvStore, WorkersMessageQueue } from "@fedify/cfworkers";

type Env = {
  KV_NAMESPACE: KVNamespace<string>;
  QUEUE: Queue;
};

const builder = createFederationBuilder<Env>();
// ---cut-before---
// Handle queue messages
export default {
  // ... fetch handler above

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    const federation = await builder.build({
      kv: new WorkersKvStore(env.KV_NAMESPACE),
      queue: new WorkersMessageQueue(env.QUEUE),
    });

    for (const message of batch.messages) {
      try {
        await federation.processQueuedTask(
          message.body as unknown as Message,
          env,
        );
        message.ack();
      } catch (error) {
        message.retry();
      }
    }
  },
};
~~~~

### Example deployment

For a complete working example, see the [Cloudflare Workers example]
in the Fedify repository, which demonstrates a simple functional ActivityPub
server deployed to Cloudflare Workers.

[Cloudflare Workers example]: https://github.com/fedify-dev/fedify/tree/main/examples/cloudflare-workers


Deno Deploy
-----------

[Deno Deploy] is a serverless platform optimized for Deno applications, offering
global distribution and built-in persistence through Deno KV.  Fedify provides
first-class support for Deno Deploy through [dedicated key–value
store](./kv.md#denokvstore-deno-only) and [message
queue](./mq.md#denokvmessagequeue-deno-only) implementations.

Deno Deploy applications can use Deno KV and leverage it for message queueing
as well:

~~~~ typescript
import { createFederation } from "@fedify/fedify";
import { DenoKvStore, DenoKvMessageQueue } from "@fedify/denokv";

// Open Deno KV (automatically available on Deno Deploy)
const kv = await Deno.openKv();

const federation = createFederation<void>({
  kv: new DenoKvStore(kv),
  queue: new DenoKvMessageQueue(kv),
  // Other configuration...
});

// Standard Deno Deploy handler
Deno.serve((request) => federation.fetch(request, { contextData: undefined }));
~~~~

[Deno Deploy]: https://deno.com/deploy


Other platforms
---------------

Support for additional serverless platforms is planned for future releases.
Each platform may have similar architectural requirements to Cloudflare Workers,
particularly around resource binding and execution constraints.

If you are interested in support for a specific platform, please [open an issue]
to discuss requirements and implementation approaches.

[open an issue]: https://github.com/fedify-dev/fedify/issues
