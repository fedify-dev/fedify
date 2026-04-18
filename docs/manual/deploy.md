---
description: >-
  A production deployment guide for Fedify applications.  Covers runtime
  selection, reverse proxies, persistent backends, container and traditional
  deployments, serverless platforms, security, observability, and the
  ActivityPub-specific operational concerns that general web-app deployment
  guides don't cover.
---

Deployment
==========

This document is a practical guide to putting a Fedify application into
production.  It is written primarily for readers who have already built
something with Fedify locally and are about to deploy it for the first time—
and secondarily for readers who deploy web applications routinely but have not
worked with Fedify or the fediverse before.

It does *not* retread general web-application deployment advice that is
already well-covered elsewhere.  Instead, it focuses on the choices and
pitfalls that are specific to Fedify and to ActivityPub: how to pin your
canonical origin, where to terminate TLS, how to keep inbox delivery healthy
at scale, how to sanitize federated HTML, how to defend the fetches Fedify
can't protect for you, and how to retire a server without orphaning every
remote follower.

The document assumes you already have a working Fedify app.  If you are still
getting started, read the [*Manual* chapters](./federation.md) first, then
come back here when you are ready to ship.


Choosing a JavaScript runtime
-----------------------------

Fedify supports Deno, Node.js, and Bun as first-class runtimes, and has
dedicated support for Cloudflare Workers.  The choice matters for production.

Node.js
:   The default recommendation.  Mature, widely deployed, extensive package
    ecosystem, well-understood operational tooling.  Node.js does not provide
    a built-in HTTP server that accepts `fetch()`-style handlers, so you
    will need [@hono/node-server] (or an equivalent adapter).

Deno
:   A strong choice if you prefer TypeScript-first tooling, a built-in HTTP
    server (`Deno.serve()`), permission-based sandboxing, and native
    OpenTelemetry support via the `--unstable-otel` flag.  If you are already
    comfortable with Deno, there is no reason to switch to Node.js for
    production.

Bun
:   Bun runs Fedify, but has known memory-leak issues that make it a
    difficult recommendation for long-running production workloads at the time
    of writing.  A common compromise is to develop on Bun (for its fast
    install and test loops) and deploy on Node.js, since both consume the same
    npm-style package sources.  Revisit Bun for production once the memory
    profile stabilizes for your workload.

Cloudflare Workers
:   A cost-effective option for servers that do not need persistent
    long-running processes.  Workers impose architectural constraints—no
    global mutable state across requests, bindings-only access to queues and
    KV, execution time limits—that Fedify accommodates through a dedicated
    [builder pattern](./federation.md#builder-pattern-for-structuring) and the
    [`@fedify/cfworkers`] package.

The rest of this guide assumes a traditional server environment (Node.js or
Deno) unless noted otherwise.

[@hono/node-server]: https://github.com/honojs/node-server
[`@fedify/cfworkers`]: https://jsr.io/@fedify/cfworkers


Configuration fundamentals
--------------------------

These decisions apply to every deployment target.  Make them once, early, and
document them—changing them after launch ranges from painful to impossible
(see [*Domain name permanence*](#domain-name-permanence)).

### Canonical origin

Pin your canonical origin explicitly with the
`~FederationOptions.origin` option unless you are intentionally hosting
multiple domains on the same Fedify instance:

~~~~ typescript twoslash
import { type KvStore } from "@fedify/fedify";
// ---cut-before---
import { createFederation } from "@fedify/fedify";

const federation = createFederation<void>({
  origin: "https://example.com",
  // ---cut-start---
  kv: null as unknown as KvStore,
  // ---cut-end---
  // Other options...
});
~~~~

When `~FederationOptions.origin` is set, Fedify constructs actor URIs,
activity IDs, and collection URLs using the canonical origin rather than the
origin derived from the incoming `Host` header.  Without this option, an
attacker who bypasses your reverse proxy and hits the upstream directly can
coerce Fedify into constructing URLs with the upstream's address—leaking
infrastructure details and potentially producing activities that other
fediverse servers reject or cache under the wrong identity.

See [*Explicitly setting the canonical
origin*](./federation.md#explicitly-setting-the-canonical-origin) for the
full API, including the
`~FederationOrigin.handleHost`/`~FederationOrigin.webOrigin` split for
separating WebFinger handles from the server origin.

### Behind a reverse proxy

If you cannot pin a single canonical origin—typically because you host
multiple domains on the same process—the alternative is to trust your
reverse proxy's forwarded headers and let Fedify reconstruct the request URL
from them.  The [x-forwarded-fetch] package does exactly this: it rewrites
the incoming `Request` so that `request.url` reflects the `X-Forwarded-Host`,
`X-Forwarded-Proto`, and related headers instead of the internal address the
proxy connected on.

On Node.js with Hono or similar frameworks, wrap your handler:

~~~~ typescript
import { serve } from "@hono/node-server";
import { behindProxy } from "x-forwarded-fetch";

serve({
  fetch: process.env.BEHIND_PROXY === "true"
    ? behindProxy(app.fetch.bind(app))
    : app.fetch.bind(app),
  port: 3000,
});
~~~~

On Deno with Fresh (or anywhere you have direct access to a middleware
chain), call `getXForwardedRequest()`:

~~~~ typescript
import { getXForwardedRequest } from "@hongminhee/x-forwarded-fetch";

app.use(async (ctx) => {
  if (Deno.env.get("BEHIND_PROXY") === "true") {
    ctx.req = await getXForwardedRequest(ctx.req);
    ctx.url = new URL(ctx.req.url);
  }
  return await ctx.next();
});
~~~~

> [!WARNING]
> Only enable `x-forwarded-fetch` when you actually sit behind a proxy you
> control.  If the process is ever reachable directly from the public
> internet, a malicious client can spoof `X-Forwarded-Host` and impersonate
> any hostname.  The common pattern is to gate the middleware behind a
> `BEHIND_PROXY=true` environment variable and set it only in the deployment
> that runs behind your proxy.

If you can pin a canonical `~FederationOptions.origin`, prefer that over
`x-forwarded-fetch`—it is the simpler, safer default.

[x-forwarded-fetch]: https://github.com/dahlia/x-forwarded-fetch

### Persistent KV store and message queue

The in-memory defaults are for development only.
`MemoryKvStore` loses data on restart, and `InProcessMessageQueue` loses every
in-flight activity; neither survives horizontal scaling.  Pick a persistent
backend before you take traffic:

| Backend                | KV store          | Message queue          | When to choose                        |
| ---------------------- | ----------------- | ---------------------- | ------------------------------------- |
| PostgreSQL             | `PostgresKvStore` | `PostgresMessageQueue` | You already run Postgres for app data |
| Redis                  | `RedisKvStore`    | `RedisMessageQueue`    | Dedicated cache/queue infrastructure  |
| MySQL / MariaDB        | `MysqlKvStore`    | `MysqlMessageQueue`    | You already run MySQL or MariaDB      |
| SQLite                 | `SqliteKvStore`   | `SqliteMessageQueue`   | Single-node / embedded deployments    |
| RabbitMQ               | —                 | `AmqpMessageQueue`     | Existing AMQP infrastructure          |
| Deno KV                | `DenoKvStore`     | `DenoKvMessageQueue`   | Deno Deploy                           |
| Cloudflare KV + Queues | `WorkersKvStore`  | `WorkersMessageQueue`  | Cloudflare Workers                    |

See the [*Key–value store*](./kv.md) and [*Message queue*](./mq.md) chapters
for setup details and trade-offs between backends (connection pooling,
ordering guarantees, native retry support).

A reasonable default if you have no prior preference: PostgreSQL for both
KV and MQ, on the same database you already use for your application data.
Single operational surface, one backup strategy, one set of metrics.

### Actor key lifecycle

Actor key pairs must be generated **once** per actor and stored durably—
typically in the same row as the actor record itself.  Do not regenerate them
on startup or during deploys.  Other fediverse servers cache your public keys
(often for hours or days), and a key rotation they don't know about will
cause every incoming signature verification to fail against the cached key
and every outgoing activity you sign with the new key to be rejected.  The
symptoms—silent federation breakage with no clear error—are among the most
frustrating to diagnose after the fact.

Keep two distinct categories of secret separate:

 -  **Instance-wide secrets** (session secret, instance actor private key,
    database credentials) live in environment variables or a secret manager.
    See [*Secret and key management*](#secret-and-key-management).
 -  **Per-actor key pairs** live in the database, one pair per actor, created
    at registration time.

If you need to rotate a compromised key, use the `Update` activity to
announce the new key and keep serving both the old and new keys from the
actor document for a transition window.  Fediverse clients will eventually
pick up the new one as caches expire.
