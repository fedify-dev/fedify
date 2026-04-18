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


Traditional deployments
-----------------------

The most common way to run a Fedify application in production is as a
long-lived Node.js or Deno process, managed by a service supervisor, behind
a reverse proxy that terminates TLS.  The pieces are deliberately boring:
everything in this section predates the fediverse by decades and is
thoroughly documented by its upstream projects.  This section focuses on the
details that matter specifically for Fedify.

### Running the process

Node.js needs an adapter because it has no built-in `fetch()`-style HTTP
server; [@hono/node-server] is the usual choice:

~~~~ typescript twoslash
import { type KvStore } from "@fedify/fedify";
// ---cut-before---
import { serve } from "@hono/node-server";
import { createFederation } from "@fedify/fedify";

const federation = createFederation<void>({
  // ---cut-start---
  kv: null as unknown as KvStore,
  // ---cut-end---
  // Configuration...
});

serve({
  fetch: (request) => federation.fetch(request, { contextData: undefined }),
  port: 3000,
});
~~~~

Deno ships a native server; export a default object with a `fetch` method
and launch it with `deno serve`:

~~~~ typescript twoslash [index.ts]
import { type KvStore } from "@fedify/fedify";
// ---cut-before---
import { createFederation } from "@fedify/fedify";

const federation = createFederation<void>({
  // ---cut-start---
  kv: null as unknown as KvStore,
  // ---cut-end---
  // Configuration...
});

export default {
  fetch(request: Request): Promise<Response> {
    return federation.fetch(request, { contextData: undefined });
  },
};
~~~~

~~~~ bash
deno serve index.ts
~~~~

For framework integration patterns (Hono, Express, Fresh, SvelteKit, and
others), see the [*Integration* chapter](./integration.md).

### Running under systemd

A Fedify process that exits unexpectedly—for any reason, from an OOM kill to
an unhandled rejection—must be restarted automatically, or federation
stalls silently while outgoing activities pile up and remote servers time
out waiting for responses.  On Linux, [systemd] is the standard way to do
this.

A minimal service unit for a Node.js-based Fedify application might look
like:

~~~~ ini [/etc/systemd/system/fedify.service]
[Unit]
Description=Fedify application
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=fedify
Group=fedify
WorkingDirectory=/srv/fedify
EnvironmentFile=/etc/fedify/env
ExecStart=/usr/bin/node --enable-source-maps dist/server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/fedify

[Install]
WantedBy=multi-user.target
~~~~

The `EnvironmentFile=` path should be `chmod 600` and owned by `root:root`
(or by the service user)—it contains database passwords, session secrets,
and similar material that must not be world-readable.  Keep the actual
application code in a path the service user cannot modify
(`ProtectSystem=strict` enforces this for system directories; the
`ReadWritePaths=` list is for any local storage you do need).

Enable and start the unit:

~~~~ bash
systemctl enable --now fedify.service
journalctl -u fedify.service -f
~~~~

On Deno, replace the `ExecStart=` line with
`/usr/bin/deno serve --allow-net --allow-env --allow-read=/srv/fedify --allow-write=/var/lib/fedify /srv/fedify/index.ts`
(tighten the permission flags to the minimum your app needs—that's the point of
running on Deno).

If you plan to split web traffic from background queue processing into
separate processes, see [*Separating web and worker
nodes*](#separating-web-and-worker-nodes) below; you will typically run two
service units (or a templated `fedify@.service` instantiated twice) rather
than one.

[systemd]: https://systemd.io/

### Process managers: PM2 and friends

[PM2] and similar Node.js process managers work with Fedify, but they
duplicate responsibilities that systemd already handles on any Linux
server—respawn, log rotation, resource limits—and they don't integrate
with the rest of your system supervision.  Prefer systemd on Linux.  PM2 is
reasonable on platforms without systemd, or when you're deploying to a
shared host where you don't control PID 1.

[PM2]: https://pm2.keymetrics.io/

### Reverse proxy

Run your Fedify process on a loopback port (for example, `127.0.0.1:3000`)
and put a reverse proxy in front of it.  The proxy handles TLS termination,
HTTP/2 (and increasingly HTTP/3), static asset caching, and—importantly for
ActivityPub—shielding your upstream from direct traffic so that the
[canonical origin](#canonical-origin) guarantee holds.

#### Nginx

~~~~ nginx
server {
  listen 443 ssl http2;
  listen [::]:443 ssl http2;
  server_name example.com;

  ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

  # Fedify emits activity payloads that can exceed nginx's 1 MiB default,
  # especially collections with many inline items.
  client_max_body_size 10m;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;

    # Pass the original Host so Fedify (or x-forwarded-fetch) can reconstruct
    # the public URL.  If you set `origin` explicitly, these are used only
    # for logging, but they should still be correct.
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-Host  $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Real-IP         $remote_addr;

    # Inbox deliveries from slow remote servers and long-running queue
    # operations can exceed nginx's 60s default.
    proxy_read_timeout  120s;
    proxy_send_timeout  120s;
  }
}

# Redirect plain HTTP to HTTPS; ActivityPub assumes HTTPS throughout.
server {
  listen 80;
  listen [::]:80;
  server_name example.com;
  return 301 https://$host$request_uri;
}
~~~~

#### Caddy

Caddy's defaults suit Fedify well: automatic HTTPS from Let's Encrypt,
HTTP/2 and HTTP/3 on by default, and forwarded headers set correctly out
of the box.  A full configuration fits on one line:

~~~~ caddy
example.com {
  reverse_proxy 127.0.0.1:3000
}
~~~~

Caddy sends `X-Forwarded-Host`, `X-Forwarded-Proto`, and `X-Forwarded-For`
automatically, which means [x-forwarded-fetch] works without extra
configuration.  For most new Fedify deployments where you don't already
have an nginx footprint to fit into, Caddy is the path of least resistance.

> [!TIP]
> Whichever proxy you use, make sure it forwards `Accept` and
> `Content-Type` verbatim and does not rewrite or strip them.  ActivityPub
> content negotiation depends on these headers matching `application/ld+json`
> or `application/activity+json` exactly.  A surprising number of default
> proxy rules on CDNs rewrite or drop them and silently break federation.
