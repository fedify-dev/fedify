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

> [!TIP]
>
> See also the documentation for [`deno serve`] and
> [Bun's `export default` syntax].

#### HTTPS servers on non-default ports with Bun

On Bun, Fedify connects to the validated address of a remote server while
still verifying its certificate against the original hostname.  Bun versions
before 1.3.11 verify certificates against the `Host` header, which includes
the port for servers on non-default ports, and offer no safe way to verify
them against the hostname otherwise.  Therefore, on these versions, Fedify
refuses requests to HTTPS servers on non-default ports (e.g.,
`https://example.com:8443/`) with a `TypeError` before connecting.  Requests
to HTTPS servers on the default port and to HTTP servers are not affected.
Upgrade to Bun 1.3.11 or later to fetch from such servers.

#### Bun behind an HTTP proxy

On Bun, Fedify sends each outbound request directly to an address that passed
its private address check, with the original `Host` header and TLS server
name, and with `proxy: false`.  Fedify's own requests do not use HTTP proxies.

Bun versions before 1.4.3 ignore `proxy: false` when any of the `HTTP_PROXY`,
`HTTPS_PROXY`, or `ALL_PROXY` environment variables (or their lowercase forms)
is set at startup, and send the requests through the proxy instead.
The proxy still receives the validated IP address as the destination, but
the connection is then made by the proxy, and a proxy that prefers the `Host`
header over the request target may resolve the hostname again.  Fedify logs
a warning once when it detects this configuration.

If your Bun deployment sets proxy environment variables, do one of
the following:

 -  Upgrade to Bun 1.4.3 or later (recommended).
 -  Unset the proxy environment variables for the Fedify process.
 -  Make the proxy refuse private address ranges as destinations.

#### Restricting outbound connections on Deno

> [!WARNING]
> Upgrading Fedify alone does not protect Deno deployments against DNS
> rebinding.  Furthermore, we no longer recommend Deno for new projects
> following its team's recent [announcement][Deno joins Cloudflare].
> Apply the mitigation below.

Fedify checks that a remote hostname resolves only to public addresses before
fetching remote documents or delivering activities.  On Node.js and Bun, it
then connects only to the addresses that passed the check.  Deno's `fetch()`
provides no way to choose the addresses it connects to, so Deno resolves
the hostname again when connecting, and a hostname that answers with a public
address for the check and a private address for the connection
(DNS rebinding) can make Fedify reach internal services.

Deno itself can refuse such connections.  Since Deno 2.8.1, `--deny-net`
checks the resolved IP addresses right before connecting.  Deno 2.8.0 and
earlier check only the hostname, so a hostname that resolves to a denied
address is still allowed (see [GHSA-cpgj-f7g3-2pp2]).  Run Deno 2.8.1 or later
with `--deny-net` listing the IPv4 ranges that Fedify treats as private,
`[::1]`, and `[::]`:

~~~~ bash
deno run --allow-net --allow-read=/run/fedify --allow-write=/run/fedify \
  --deny-net=0.0.0.0/8,10.0.0.0/8,100.64.0.0/10,127.0.0.0/8,169.254.0.0/16,172.16.0.0/12,192.0.0.0/24,192.0.2.0/24,192.88.99.0/24,192.168.0.0/16,198.18.0.0/15,198.51.100.0/24,203.0.113.0/24,224.0.0.0/4,240.0.0.0/4,[::1],[::] \
  server.ts
~~~~

Add the other permissions your application needs.  This mitigation has
the following limitations:

 -  `--deny-net` takes precedence over `--allow-net`, so the server cannot
    listen on an address inside a denied range, such as `127.0.0.1`,
    `0.0.0.0`, `[::]`, or a container address like `172.17.0.2`.  Leaving
    the listening address out of the list does not work either, since it
    lets rebinding reach that address too; for example, on Linux, connecting
    to `0.0.0.0` or `[::]` reaches services listening on the loopback
    interface.  Listen on a Unix domain socket behind a reverse proxy
    instead.  Listening on a socket path requires read and write permissions
    for the path rather than the `net` permission, so all of the addresses
    above can be denied:

    ~~~~ typescript
    Deno.serve(
      { path: "/run/fedify/fedify.sock" },
      (request) => federation.fetch(request, { contextData: undefined }),
    );
    ~~~~

 -  `--deny-net` does not accept IPv6 ranges, only literal addresses like
    `[::1]`.  Unique local addresses (`fc00::/7`) and link-local addresses
    (`fe80::/10`) cannot be denied this way, so block them at the network
    layer or disable outbound IPv6.

If your deployment cannot use `--deny-net`, for example a container that must
listen on `0.0.0.0`, block the same ranges for outbound traffic of the Fedify
process with owner-based `OUTPUT` rules of iptables or nftables, or with
a container network policy.  These can also express IPv6 ranges.  Block `::1`
and `::` as well as `fc00::/7` and `fe80::/10`, since on Linux connecting to
`::` also reaches local services.

The deny list overlaps with Fedify's own check, but because Deno applies it
right before connecting, it also covers the addresses a hostname is rebound to.

For new and long-lived deployments, we recommend Node.js or Bun instead of
Deno.  The Deno team has [announced][Deno is joining Cloudflare] that it will
ship only bug-fix and security releases for one year from October 9, 2026, and
then end its development of the Deno runtime: “We will support the Deno
runtime for another year with monthly releases containing bug fixes and
security updates.  After that year we will end our development of the Deno
runtime.”  Deno remains open source, so others may continue its development.
See also [Cloudflare's announcement][Deno joins Cloudflare].

[`deno serve`]: https://docs.deno.com/runtime/reference/cli/serve/
[Bun's `export default` syntax]: https://bun.sh/docs/api/http#export-default-syntax
[Deno joins Cloudflare]: https://blog.cloudflare.com/deno-joins-cloudflare/
[GHSA-cpgj-f7g3-2pp2]: https://github.com/denoland/deno/security/advisories/GHSA-cpgj-f7g3-2pp2
[Deno is joining Cloudflare]: https://deno.com/blog/cloudflare

### Key–value store and message queue

For traditional server environments, choose persistent storage solutions based
on your infrastructure:

Development
:   Use [`MemoryKvStore`](./kv.md#memorykvstore) and
    [`InProcessMessageQueue`](./mq.md#inprocessmessagequeu) for quick setup.

Production
:   Consider [`PostgresKvStore`](./kv.md#postgreskvstore) and
    [`PostgresMessageQueue`](./mq.md#postgresmessagequeue) if you already use
    PostgreSQL, [`MysqlKvStore`](./kv.md#mysqlkvstore) and
    [`MysqlMessageQueue`](./mq.md#mysqlmessagequeue) if you already use
    MySQL or MariaDB, or [`RedisKvStore`](./kv.md#rediskvstore) and
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

~~~~ jsonc
"compatibility_date": "2025-05-31",
"compatibility_flags": ["nodejs_compat"],
~~~~

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

> [!WARNING]
> The Deno team has [announced][Deno is joining Cloudflare] that Deno Deploy
> will continue operating for six months from October 9, 2026, before shutting
> down.  Consider moving to [Cloudflare Workers](#cloudflare-workers), or to
> a [traditional server environment](#traditional-server-environments) on
> Node.js or Bun.

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
