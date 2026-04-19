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
something with Fedify locally and are about to deploy it for the first time—and
secondarily for readers who deploy web applications routinely but have not
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
    will need an HTTP adapter such as [@hono/node-server] or [srvx].

Deno
:   A strong choice if you prefer TypeScript-first tooling, a built-in HTTP
    server (`Deno.serve()`), permission-based sandboxing, and native
    OpenTelemetry support enabled with `OTEL_DENO=1` (stable since Deno 2.4).
    If you are already comfortable with Deno, there is no reason to switch to
    Node.js for production.

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
[srvx]: https://srvx.h3.dev/
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
| MySQL/MariaDB          | `MysqlKvStore`    | `MysqlMessageQueue`    | You already run MySQL or MariaDB      |
| SQLite                 | `SqliteKvStore`   | `SqliteMessageQueue`   | Single-node/embedded deployments      |
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

Actor key pairs must be generated *once* per actor and stored durably—
typically in the same row as the actor record itself.  Do not regenerate them
on startup or during deploys.  Other fediverse servers cache your public keys
(often for hours or days), and a key rotation they don't know about will
cause every incoming signature verification to fail against the cached key
and every outgoing activity you sign with the new key to be rejected.  The
symptoms—silent federation breakage with no clear error—are among the most
frustrating to diagnose after the fact.

Keep two distinct categories of secret separate:

 -  *Instance-wide secrets* (session secret, instance actor private key,
    database credentials) live in environment variables or a secret manager.
    See [*Secret and key management*](#secret-and-key-management).
 -  *Per-actor key pairs* live in the database, one pair per actor, created
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
server.  [@hono/node-server] is the most common choice; [srvx] is a
universal alternative that also works unchanged on Deno and Bun:

::: code-group

~~~~ typescript twoslash [@hono/node-server]
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
  hostname: "127.0.0.1",
  port: 3000,
});
~~~~

~~~~ typescript twoslash [srvx]
import { type KvStore } from "@fedify/fedify";
// ---cut-before---
import { serve } from "srvx";
import { createFederation } from "@fedify/fedify";

const federation = createFederation<void>({
  // ---cut-start---
  kv: null as unknown as KvStore,
  // ---cut-end---
  // Configuration...
});

serve({
  fetch: (request) => federation.fetch(request, { contextData: undefined }),
  hostname: "127.0.0.1",
  port: 3000,
});
~~~~

:::

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
deno serve --host 127.0.0.1 index.ts
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
service units (or a templated *fedify@.service* instantiated twice) rather
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


Container deployments
---------------------

Running Fedify in a container does not change the application's architecture,
but it changes how you supervise, scale, and secure it.  This section covers
the container-specific pieces that matter for a Fedify app: the shape of a
minimal *Dockerfile* for each runtime, a Compose file that wires up the
application, a worker, and the backing services it typically needs, and some
notes on Kubernetes and managed container platforms.

### Dockerfile

A minimal Node.js *Dockerfile* follows the familiar pattern: install
dependencies, copy the source, expose the port, run the server.  Keep the
runtime image small (the `-alpine` or `-slim` variants are usually fine),
run as a non-root user, and depend on process supervision from the
orchestrator (Compose `restart:`, Kubernetes `restartPolicy`, etc.) rather
than baking in a process manager.

~~~~ dockerfile [Node.js]
FROM node:24-alpine

# Install runtime OS packages your app needs (e.g., ffmpeg for media).
RUN apk add --no-cache pnpm

WORKDIR /app
COPY pnpm-lock.yaml package.json ./
RUN pnpm install --frozen-lockfile --prod

COPY . .

# Run as an unprivileged user.  The stock `node` user UID 1000 exists in
# the official node images.
USER node

EXPOSE 3000
CMD ["pnpm", "run", "start"]
~~~~

For Deno, use an official Deno image and lean on `deno task` for the
command surface.  Deno's permissions flags belong in the `start` task in
*deno.json*, not in the *Dockerfile*, so that they are version-controlled
with the code:

~~~~ dockerfile [Deno]
FROM denoland/deno:2

WORKDIR /app
COPY deno.json deno.lock ./
RUN deno install

COPY . .
RUN deno task build

USER deno
EXPOSE 8000
CMD ["deno", "task", "start"]
~~~~

> [!TIP]
> If you build multi-arch images (linux/amd64 and linux/arm64 are the common
> pair for fediverse servers, since many operators run on ARM VPSes for
> cost), use `docker buildx` with `--platform=linux/amd64,linux/arm64`.
> Avoid base images that only ship amd64.

### Docker Compose/Podman Compose

A single *compose.yaml* is usually enough to describe a Fedify deployment:
the app itself, optionally a separate worker process from the same image,
and the KV/MQ backend (Postgres or Redis).  [Podman Compose] understands
the same file format, so the example below works unchanged under both
Docker and Podman.

~~~~ yaml [compose.yaml]
services:
  web:
    image: ghcr.io/example/my-fedify-app:latest
    environment:
      NODE_TYPE: web
      DATABASE_URL: postgres://fedify:${DB_PASSWORD}@postgres:5432/fedify
      REDIS_URL: redis://redis:6379/0
      BEHIND_PROXY: "true"
      FEDIFY_ORIGIN: https://example.com
      SECRET_KEY: ${SECRET_KEY}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
    ports:
      - "127.0.0.1:3000:3000"
    restart: unless-stopped

  worker:
    image: ghcr.io/example/my-fedify-app:latest
    environment:
      NODE_TYPE: worker
      DATABASE_URL: postgres://fedify:${DB_PASSWORD}@postgres:5432/fedify
      REDIS_URL: redis://redis:6379/0
      SECRET_KEY: ${SECRET_KEY}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
    restart: unless-stopped

  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: fedify
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: fedify
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "fedify"]
      interval: 10s
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
~~~~

The `web` and `worker` services run the same image with different
`NODE_TYPE` environment variables so that your application code can decide
whether to bind an HTTP port or only start the message queue processor.
See [*Separating web and worker
nodes*](#separating-web-and-worker-nodes) for the code pattern this
mirrors.  If you do not need that separation yet, drop the `worker` service
and keep a single combined process.

Bind the application port to `127.0.0.1` rather than `0.0.0.0`, and run
your [reverse proxy](#reverse-proxy) on the host; this keeps the Fedify
process unreachable from the public internet, which is the invariant that
the [canonical origin](#canonical-origin) guarantee depends on.

[Podman Compose]: https://github.com/containers/podman-compose

### Kubernetes

For deployments large enough to justify Kubernetes, the same pattern
applies—just spread across more objects.  The essentials:

 -  Two `Deployment`s: one for web pods (multiple replicas, behind a
    `Service` and `Ingress`) and one for worker pods (replicas tuned to
    queue depth, no `Service`).
 -  `ConfigMap` for non-sensitive environment variables and a
    `Secret` for instance-wide credentials.  Per-actor key pairs belong
    in the application database, not in a `Secret`.
 -  `Ingress` terminating TLS with cert-manager.  Most Fedify apps don't
    need anything exotic here; a default nginx-ingress with
    `proxy-body-size: 10m` is a reasonable starting point.
 -  `HorizontalPodAutoscaler` on the worker `Deployment` targeting queue
    depth (via a custom metric from your MQ backend) or CPU.  Web pods
    usually scale on CPU or request count.
 -  `StatefulSet` + `PVC` for PostgreSQL if you self-host it, or an
    external managed database; Fedify is indifferent as long as the
    connection string works.

This document does not attempt to replace the upstream Kubernetes
documentation—the mechanics of `Deployment`s, `Service`s, and `Ingress` are the
same as for any other HTTP service.  The Fedify-specific pieces are the
ones covered throughout this guide: origin pinning, forwarded headers,
worker separation, persistent KV/MQ, and actor key persistence.

### Managed container platforms

Platform-as-a-service container hosts are the fastest way to get a Fedify
app into production if you don't want to operate the underlying
infrastructure yourself.  Rather than duplicate each vendor's
documentation, this section lists which Fedify constraints to watch for.
Follow the links for setup details.

[Fly.io]
:   Works well with Fedify.  You can run web and worker processes as
    separate [processes] in one *fly.toml* and scale them independently.
    Enable HTTP/2 in `[[services]]` and make sure the forwarded-headers
    behavior matches what [x-forwarded-fetch] expects.

[AWS ECS]/[AWS EKS]
:   Standard container-orchestration on AWS.  If you use ALB as the
    ingress, its request/response byte limits and header handling behave
    like nginx with generous defaults; the [*Reverse proxy*](#reverse-proxy)
    `Accept`/`Content-Type` tip still applies.

[Google Cloud Run]
:   Runs a single container per service with no persistent disk and
    request-scoped execution.  Worker separation using a long-running
    queue consumer does not fit Cloud Run's execution model well; if you
    need that separation, prefer a platform that supports long-running
    processes (Fly.io, Kubernetes) or move the queue backend to one with
    a native push consumer.

[Render]/[Railway]
:   Both treat Fedify apps as ordinary Node.js or Deno services and work
    well for small-to-medium deployments.  Define a separate “background
    worker” service for the queue processor.

[Fly.io]: https://fly.io/docs/
[processes]: https://fly.io/docs/reference/configuration/#the-processes-section
[AWS ECS]: https://docs.aws.amazon.com/ecs/
[AWS EKS]: https://docs.aws.amazon.com/eks/
[Google Cloud Run]: https://cloud.google.com/run/docs
[Render]: https://render.com/docs
[Railway]: https://docs.railway.com/


Separating web and worker nodes
-------------------------------

By default, a Fedify process both accepts HTTP requests and runs the
message-queue consumer that delivers outgoing activities and dispatches
incoming ones.  For low-traffic servers this works fine.  For anything busy
enough to care about tail latency—or for any server where a queue backlog
during a federation spike would hurt web responsiveness—split these roles
into separate processes:

 -  *Web nodes* serve HTTP, enqueue outgoing activities, and accept
    incoming ones.  They do not consume the queue.
 -  *Worker nodes* consume the queue and process delivery.  They do not
    serve HTTP and should not be exposed through your load balancer.

This is a Fedify-level concern implemented with two options:
`~FederationOptions.manuallyStartQueue: true` tells Fedify not to start the
queue consumer automatically, and `Federation.startQueue()` starts it only
on nodes that should consume.

~~~~ typescript twoslash
import type { KvStore } from "@fedify/fedify";
// ---cut-before---
import { createFederation } from "@fedify/fedify";
import { RedisMessageQueue } from "@fedify/redis";
import Redis from "ioredis";
import process from "node:process";

const federation = createFederation<void>({
  queue: new RedisMessageQueue(() => new Redis()),
  manuallyStartQueue: true,
  // ---cut-start---
  kv: null as unknown as KvStore,
  // ---cut-end---
  // Other options...
});

if (process.env.NODE_TYPE === "worker") {
  const controller = new AbortController();
  process.on("SIGINT", () => controller.abort());
  process.on("SIGTERM", () => controller.abort());
  await federation.startQueue(undefined, { signal: controller.signal });
}
~~~~

The [*Separating message processing from the main
process*](./mq.md#separating-message-processing-from-the-main-process)
section has the complete reference, including the Deno variant and the
table describing which role enqueues versus processes.

The deployment-side pieces are:

Compose
:   Two services referencing the same image with different `NODE_TYPE`
    environment variables, as in the Compose example
    [above](#docker-compose-podman-compose).

systemd
:   Either two separate units (*fedify-web.service* and
    *fedify-worker.service*, each with its own `EnvironmentFile=`), or a
    single templated *fedify@.service* unit instantiated twice
    (`systemctl start fedify@web.service fedify@worker.service`).

Kubernetes
:   Two `Deployment`s.  Only the web `Deployment` gets a `Service` and `Ingress`.
    Scale workers on queue depth (via a custom metric adapter reading from
    your MQ backend) rather than CPU—a queue that's falling behind is not
    necessarily CPU-bound.

> [!WARNING]
> Do not place worker nodes behind a load balancer or expose them on a
> public address.  They do not accept HTTP requests (or rather, they accept
> them but don't enqueue properly), and exposing them weakens the invariant
> that every Fedify HTTP response is signed by a node that has the full
> web configuration.

### Avoid `immediate: true` in production

`Context.sendActivity()` accepts an `immediate: true` option that bypasses
the message queue and attempts delivery synchronously as part of the
current request.  It has a specific purpose—delivery in environments
where no queue is configured, or in tests—but it is actively dangerous in
production:

 -  Remote servers that are slow to respond will block your request.
 -  There is no retry on failure; a single transient network error silently
    loses the activity.
 -  It ties delivery success to request lifetime, which breaks the
    invariant that `sendActivity()` is fire-and-forget from the caller's
    point of view.

Before launch, search your codebase for `immediate: true` and remove every
occurrence that isn't in a test fixture.

### Parallel processing and connection pools

If you wrap your queue in `ParallelMessageQueue(queue, N)` to consume
messages concurrently on a single worker process, make sure the database
connection pool behind your KV store and MQ can accommodate at least `N`
plus a few extra connections.  A pool that's too small won't cause errors
you'll notice immediately—it causes jobs to stall waiting on connections,
which looks like a slow queue rather than a misconfiguration.

See [*Parallel message processing*](./mq.md#parallel-message-processing)
for the full context, which includes specific notes about
`PostgresMessageQueue` and shared pools.


Serverless and edge deployments
-------------------------------

Fedify runs on two classes of platform that don't fit the long-running
process model: Cloudflare Workers and Deno Deploy.  Both can host a
Fedify application with zero self-managed infrastructure, at a cost that
scales down to near-zero for low-traffic servers.  The trade-off is that
each platform imposes architectural constraints that shape how the code is
organized—so unlike the traditional- and container-based sections above,
the choice here affects your *application code*, not just the deployment
configuration.

### Cloudflare Workers

*Cloudflare Workers support is available in Fedify 1.6.0 and later.*

[Cloudflare Workers] is an edge runtime with per-request execution limits
and no mutable global state between invocations.  Platform services—KV,
Queues, R2, D1—are exposed through the `env` parameter of the request
handler rather than as ambient imports.  Fedify accommodates this through
the [builder pattern](./federation.md#builder-pattern-for-structuring) and
the [`@fedify/cfworkers`] package, which provides `WorkersKvStore` and
`WorkersMessageQueue`.

#### Node.js compatibility

Fedify depends on Node.js APIs for cryptography and DNS, so Workers need
the Node.js compatibility flag.  In your *wrangler.jsonc*:

~~~~ jsonc
"compatibility_date": "2025-05-31",
"compatibility_flags": ["nodejs_compat"],
~~~~

See the [Node.js compatibility] documentation for details.

#### Builder pattern

Because `env` (the handle to KV, Queues, and other bindings) is only
available inside the request handler, you cannot instantiate `Federation`
at module load time.  Use `createFederationBuilder()` to define your
dispatchers and build the `Federation` object per request:

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

builder.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
  // Actor logic...
  // ---cut-start---
  return new Person({});
  // ---cut-end---
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const federation = await builder.build({
      kv: new WorkersKvStore(env.KV_NAMESPACE),
      queue: new WorkersMessageQueue(env.QUEUE),
    });
    return federation.fetch(request, { contextData: env });
  },
};
~~~~

#### Manual queue processing

Cloudflare Queues deliver messages by invoking your Worker's `queue()`
export rather than via a polling API, so `WorkersMessageQueue` cannot
implement `~MessageQueue.listen()` the traditional way.  Wire the handler
manually:

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederationBuilder, type Message } from "@fedify/fedify";
import { WorkersKvStore, WorkersMessageQueue } from "@fedify/cfworkers";

type Env = {
  KV_NAMESPACE: KVNamespace<string>;
  QUEUE: Queue;
};

const builder = createFederationBuilder<Env>();
// ---cut-before---
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
          env,
          message.body as unknown as Message,
        );
        message.ack();
      } catch {
        message.retry();
      }
    }
  },
};
~~~~

If you use ordering keys, instantiate `WorkersMessageQueue` with an
`orderingKv` namespace and call `WorkersMessageQueue.processMessage()`
before `Federation.processQueuedTask()`.  See the
[*`WorkersMessageQueue`*](./mq.md#workersmessagequeue-cloudflare-workers-only)
section for a complete example.

#### Native retry

Cloudflare Queues provide native retry with exponential backoff and
dead-letter queue support, which Fedify recognizes through
[`MessageQueue.nativeRetrial`].  When native retry is available, Fedify
skips its own retry logic and relies on the backend.  Configure
`max_retries` and a `dead_letter_queue` in your Queue definition in
*wrangler.jsonc* rather than in application code.

#### Secrets and WAF

Store secrets with `wrangler secret put` rather than committing them to
*wrangler.jsonc*'s `vars` section.  The `vars` section is visible in the
dashboard and to anyone with read access to the Worker; `secrets` are
encrypted.

Cloudflare's default WAF Bot Protection and “Managed Challenge” rules
sometimes treat fediverse user agents or the `application/activity+json`
content type as suspicious and challenge them, which breaks federation
silently (remote servers don't solve CAPTCHAs).  If your Worker sits
behind a Cloudflare WAF, add a skip rule for requests whose `Accept` or
`Content-Type` contains `application/activity+json` or
`application/ld+json`, and whitelist known-good fediverse user agents.

#### Example deployment

For a complete working example, see the [Cloudflare Workers example] in
the Fedify repository, which demonstrates a minimal ActivityPub server
deployed to Workers.

[Cloudflare Workers]: https://workers.cloudflare.com/
[Node.js compatibility]: https://developers.cloudflare.com/workers/runtime-apis/nodejs/
[`MessageQueue.nativeRetrial`]: ./mq.md#native-retry-mechanisms
[Cloudflare Workers example]: https://github.com/fedify-dev/fedify/tree/main/examples/cloudflare-workers

### Deno Deploy

[Deno Deploy] is a serverless platform for Deno applications with global
distribution and built-in persistence through Deno KV.  At the time of
writing, Deno Deploy offers two products:

 -  *Deno Deploy Early Access (EA)* is the current generation and the
    one you should target for new deployments.  It runs on Deno 2 with
    improved cold-start behavior, native HTTP/3, and first-class
    OpenTelemetry support.
 -  *Deno Deploy Classic* is the previous generation.  It is now
    deprecated and scheduled to shut down on July 20, 2026; existing
    applications must migrate to Deno Deploy EA before that date.

Fedify targets Deno Deploy (both EA and Classic) through the
[`@fedify/denokv`] package, which exposes `DenoKvStore` and
`DenoKvMessageQueue`.  Deno Deploy EA's Deno KV is automatically
available—no configuration required, no separate database to provision:

~~~~ typescript
import { createFederation } from "@fedify/fedify";
import { DenoKvStore, DenoKvMessageQueue } from "@fedify/denokv";

const kv = await Deno.openKv();

const federation = createFederation<void>({
  kv: new DenoKvStore(kv),
  queue: new DenoKvMessageQueue(kv),
  // Other configuration...
});

Deno.serve((request) => federation.fetch(request, { contextData: undefined }));
~~~~

`DenoKvMessageQueue` exposes native retry via
[`MessageQueue.nativeRetrial`], so Fedify delegates retry semantics to
Deno KV's built-in exponential-backoff mechanism.

[Deno Deploy]: https://deno.com/deploy
[`@fedify/denokv`]: https://jsr.io/@fedify/denokv


Security
--------

Fedify servers face a different threat model than most web applications.
Content arrives from strangers' servers, often as HTML, usually signed but
not always usefully so.  URLs point at resources you must then fetch from
the public internet.  Every user is potentially the target of an attacker
on some other instance halfway around the world.  Three concerns matter
far more in this setting than the generic web-security checklist suggests:
cross-site scripting through federated HTML, server-side request forgery
through follow-on fetches, and the safekeeping of the cryptographic
material that identifies your instance and its actors.

### Cross-site scripting (XSS)

ActivityPub carries post content as HTML in fields like `content`,
`summary`, and `name`.  Remote servers can and do put arbitrary markup in
these fields—including, if they are malicious or compromised, `<script>`
tags, `javascript:` URLs, `onerror` handlers, CSS expressions, and
everything else in the usual XSS playbook.  Fedify does not sanitize this
content for you, because what is safe depends on how and where you render
it (rich timeline? plain text notification? microformats-annotated HTML?),
so the obligation falls on your application.

Always pass federated HTML through an allowlist-based sanitizer before
rendering.  Never try to write your own regex-based sanitizer for this—
HTML is not a regular language, and the failure modes of naive sanitizers
are exactly the mutation XSS vectors attackers exploit in practice.

::: code-group

~~~~ typescript [Node.js]
import sanitize from "sanitize-html";

const safeHtml = sanitize(post.content, {
  allowedTags: [
    "a", "br", "p", "span", "strong", "em", "del", "blockquote",
    "code", "pre", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6",
  ],
  allowedAttributes: {
    a: ["href", "rel", "class"],
    span: ["class"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: {
    // Force rel="nofollow noopener ugc" on every link.
    a: sanitize.simpleTransform("a", {
      rel: "nofollow noopener ugc",
      target: "_blank",
    }),
  },
});
~~~~

~~~~ typescript [Deno]
import { FilterXSS } from "xss";

const filter = new FilterXSS({
  whiteList: {
    a: ["href", "rel", "class"],
    span: ["class"],
    strong: [],
    em: [],
    del: [],
    p: [],
    br: [],
    blockquote: [],
    code: ["class"],
    pre: [],
    ul: [],
    ol: [],
    li: [],
    h1: [],
    h2: [],
    h3: [],
    h4: [],
    h5: [],
    h6: [],
  },
  stripIgnoreTagBody: ["script", "style"],
});

const safeHtml = filter.process(post.content);
~~~~

:::

A [strong Content-Security-Policy] header on your frontend provides
defense in depth—a missed sanitization bug becomes a rendering bug rather
than a compromise.  At minimum, forbid inline scripts
(`script-src 'self'`) and inline event handlers.

> [!CAUTION]
> Do not skip sanitization on “trusted” instances.  The ActivityPub trust
> boundary is the HTTP signature on incoming activities, which only
> proves the activity came from a given actor; it says nothing about
> whether that actor's server is honest or whether the account has been
> hijacked.  Sanitize every post, every summary, every actor bio, from
> every server, always.

[strong Content-Security-Policy]: https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP

### Server-side request forgery (SSRF)

ActivityPub forces your server to fetch URLs supplied by untrusted
parties: when resolving remote actors, loading linked objects, dereferencing
collections, verifying signatures against the signer's public-key
document.  Without defenses, an attacker can supply URLs that resolve to
your cloud metadata service, internal admin endpoints, or RFC 1918
addresses, and your server will obediently make those requests on their
behalf and return (or expose in error messages) the responses.

Fedify's built-in document loaders defend against this by default:

 -  `lookupObject()`, `~Context.getDocumentLoader()`, and
    `~Context.getAuthenticatedDocumentLoader()` reject URLs that resolve to
    loopback, link-local, private (RFC 1918), or ULA/IPv6-link-local
    addresses, and they refuse the `localhost` hostname outright.  DNS is
    resolved once and the resolved IP is checked, which defeats
    DNS-rebinding attacks.
 -  The protection is implemented in
    [`validatePublicUrl()`], which you can call directly from application
    code if you need the same checks for your own fetches.

There is an escape hatch—`allowPrivateAddress: true` on
`createFederation()`—that disables the check.  It exists to make tests
runnable against localhost.

> [!CAUTION]
> Never set `allowPrivateAddress: true` in a production configuration.
> It disables every SSRF defense Fedify provides.  Gate it behind an
> environment variable that is set only in test environments, or omit it
> entirely from your production code path.

*Fedify's protection does not extend to fetches you make yourself.*
Any time your application code calls `fetch()` (or any HTTP client) with
a URL that originated from a remote server, you are on the hook for SSRF
defense.  The common cases where this happens in Fedify apps:

 -  Downloading remote actors' avatar or header images to your own storage
    (to avoid hotlinking or to support media proxying).
 -  Fetching attachment media (`icon`, `image`, `document.url`) for
    thumbnailing or content-type detection.
 -  Resolving link previews or OEmbed endpoints discovered in post content.
 -  Sending outbound webhooks to user-configured URLs.

For these, either wrap the fetch with a library like [ssrfcheck] or call
`validatePublicUrl()` yourself before the fetch:

~~~~ typescript
import { validatePublicUrl } from "@fedify/vocab-runtime";

async function fetchRemoteImage(url: URL): Promise<Response> {
  await validatePublicUrl(url.href);  // throws if the URL is unsafe
  return fetch(url, { redirect: "manual" });
}
~~~~

Also disable following redirects by default, or constrain them: an
attacker's URL might be public on its face but redirect to an internal
address.  `fetch()` in the platform runtimes follows redirects automatically;
either set `redirect: "manual"` and validate each hop, or cap the total
number of hops with a wrapper library.

[`validatePublicUrl()`]: https://jsr.io/@fedify/vocab-runtime/doc/~/validatePublicUrl
[ssrfcheck]: https://www.npmjs.com/package/ssrfcheck

### Secret and key management

Fedify deployments have two distinct categories of cryptographic material
to protect, and conflating them is a common cause of preventable
incidents:

Instance-wide secrets
:   Session signing keys, OAuth client secrets, database passwords, S3
    credentials, API tokens.  These belong in environment variables or a
    secret manager, never in source control.  For systemd, use
    `EnvironmentFile=/etc/fedify/env` with `chmod 600`.  For Docker, use
    [Docker secrets] or supply them through the orchestrator's env facility
    without committing them to *compose.yaml*.  For Kubernetes, use
    `Secret` resources (and consider [External Secrets] to sync from a
    backing store like Vault or AWS Secrets Manager).  For Cloudflare
    Workers, use `wrangler secret put`—never `vars` in
    *wrangler.jsonc*.

Per-actor key pairs
:   Generated once per actor at registration time and stored in your
    database, one pair per row.  Back them up together with the rest of
    your application data.  Do not encrypt them with a secret you will
    forget to rotate to a new KMS when you migrate; losing these keys
    means losing the ability to sign outgoing activities for those actors,
    which for other fediverse servers looks indistinguishable from
    identity theft.

Two practical rules that are easy to forget:

 -  Do not commit a *.env* file to the repository, even for development.
    Development secrets leak into production habits.  Use *.env.sample*
    with dummy values and list *.env* in your *.gitignore*.
 -  On deployment, the *.env* file (if you use one) should live on the
    server only long enough to be read into the process environment.  The
    most common mistake is making it world-readable or leaving it in a
    web-accessible directory.

[Docker secrets]: https://docs.docker.com/engine/swarm/secrets/
[External Secrets]: https://external-secrets.io/

### Other practices worth enforcing

Require HTTPS everywhere
:   ActivityPub assumes HTTPS.  Most fediverse servers refuse to federate
    over HTTP, and those that accept it will reject the signatures on your
    activities.  Redirect port 80 to 443 at the proxy and make sure your
    `Federation.origin` starts with `https://`.

Keep signature verification on
:   `~FederationOptions.skipSignatureVerification` exists only for
    controlled testing.  A server with signature verification disabled
    will accept forged activities from any source, and there is no
    recovery from the resulting trust-cache pollution short of wiping
    state and refederating.

Block abusive instances early
:   Apply domain-level blocklists at the inbox listener so that incoming
    activities from known-abusive instances are rejected before you spend
    time parsing them.  The fediverse maintains several community blocklists
    ([oliphant/blocklists] is one starting point); curate your own rather
    than importing them wholesale.

Keep the system clock in sync
:   HTTP signatures are valid only within `~FederationOptions.signatureTimeWindow`
    (one hour by default).  Run NTP on every web and worker node.  Clock
    drift is the second-most-common “it worked in staging” production
    issue after reverse-proxy misconfiguration.

[oliphant/blocklists]: https://codeberg.org/oliphant/blocklists


Observability in production
---------------------------

Federation failures are often silent.  An outbox that falls behind, a remote
server that starts rejecting your signatures, a queue consumer that
crashes—none of these necessarily produce an alert from basic HTTP
monitoring, and the resulting trust-cache divergence between your server and
its peers is hard to diagnose after the fact.  The best defense is the
observability you set up before launch.

The details of Fedify's logging and tracing APIs belong in their own
chapters; this section covers only what's different about using them in
production.

### Structured logging

Fedify uses [LogTape] for logging.  See the [*Logging* chapter](./log.md)
for the full API, including how to configure per-category log levels for
Fedify, your application, and dependencies.  For production specifically:

 -  Emit structured logs (JSON Lines or similar) rather than free-form
    text.  It takes the same amount of effort at write time and makes log
    aggregation, filtering, and alerting dramatically easier later.
 -  Send logs to stderr only.  stdout is conventionally reserved for
    application output that a shell pipeline might consume, and in
    practice mixing the two produces unreadable logs when the orchestrator
    captures both streams.  systemd's `StandardOutput=journal`/
    `StandardError=journal` and Docker's default both handle this
    correctly if you keep the streams separate.
 -  Default the log level to `info` or `warn`.  `debug` generates enough
    output from Fedify and its dependencies to fill a disk on a busy
    server; enable it per-category when investigating.
 -  Redact sensitive fields before they reach disk.  Actor private keys,
    session tokens, authorization headers, and user email addresses should
    never appear in logs.  LogTape's filter API is the place to attach this
    transformation; do it once at the sink boundary rather than sprinkling
    it through call sites.

[LogTape]: https://logtape.org/

### Distributed tracing

Fedify is instrumented for [OpenTelemetry] out of the box.  See the
[*OpenTelemetry* chapter](./opentelemetry.md) for the setup details,
including the auto-instrumentation packages that capture ActivityPub
operations across your infrastructure.  For production:

 -  Export traces via OTLP to whichever backend your organization uses
    (Jaeger, Tempo, Honeycomb, Datadog, Grafana Cloud—all speak OTLP).
    Configure the exporter through standard `OTEL_EXPORTER_OTLP_ENDPOINT`
    environment variables rather than hardcoding URLs.
 -  Sample aggressively in production.  A 100% sampling rate is fine in
    staging and prohibitively expensive under real traffic; 1–10%
    head-based sampling with tail-based error sampling is a common
    compromise.
 -  On Deno 2.4 and later, set `OTEL_DENO=1` to enable the built-in
    OpenTelemetry integration.
 -  On Cloudflare Workers, use Workers Observability (enable
    `observability.enabled: true` in *wrangler.jsonc*) or a Workers-native
    tracing integration; OTLP export from inside a Worker is possible but
    not the default path.

[OpenTelemetry]: https://opentelemetry.io/

### Error reporting

For error aggregation, the pattern most Fedify applications use is a
LogTape sink that forwards error-level records to [Sentry] via
[`@logtape/sentry`].  This way you keep a single logging surface (LogTape)
while picking up Sentry's grouping, release tracking, and issue assignment
without a second instrumentation library.

[Sentry]: https://sentry.io/
[`@logtape/sentry`]: https://jsr.io/@logtape/sentry

### What to actually monitor

The four metrics that correlate most directly with federation health:

Queue depth
:   How many outgoing activities are waiting in the queue.  A steadily
    growing queue is the earliest sign that your worker nodes can't keep
    up with traffic.  Depth that never drains to zero during low-traffic
    periods means you are permanently falling behind.

Inbox processing latency
:   The time between accepting an inbox request and finishing the side
    effects it triggers.  Spikes typically correlate with either a queue
    backlog or a slow external dependency (database, remote signature
    fetch).

Outbox delivery success rate
:   The fraction of outgoing activities that receive a 2xx response from
    the target inbox.  A drop from 95%+ to 80% probably means specific
    instances are blocking or rate-limiting you; a drop across the board
    means an outage at your end.

Remote `410`/`404` rate
:   The rate at which inbox deliveries hit `410 Gone` or `404 Not Found`
    responses.  Some baseline is normal (actors get deleted), but sudden
    spikes often mean a large remote instance shut down or changed paths;
    `permanentFailureStatusCodes` means Fedify will stop retrying these,
    but you may want to prune orphan follower records yourself.

Any competent metrics backend will also want the usual process-level
signals: CPU, RSS, event-loop lag, GC pauses, connection pool utilization
for your KV/MQ backend.  None of these are Fedify-specific, but all of
them should be in place before you take real traffic.


ActivityPub-specific operational concerns
-----------------------------------------

Generic deployment guides tell you how to keep a web service running.  The
items in this section are specific to ActivityPub and the fediverse, and
they are the ones that surprise first-time operators because nothing else
on the modern web behaves this way.  None of them are optional for a
server that expects to stay federated over the long term.

### Domain name permanence

*A Fedify server's domain name is effectively permanent.*  Once actors on
your server have federated out—been followed, been mentioned, had their
posts cached or boosted—remote servers store their URIs, which include
your domain, in their local databases.  Those stored URIs don't renegotiate
when your domain changes.  If you move to a new domain:

 -  Every follow relationship for every actor breaks.  Remote servers
    continue to POST to the old domain's inbox URL and either fail or
    deliver to a different server entirely.
 -  Thread continuity breaks.  Replies to your existing posts, if they
    reference your posts by URI, become orphaned.
 -  Actor identity breaks.  An actor at `@alice@new.example` is,
    federation-wise, a different actor from `@alice@old.example`; followers
    do not carry over.

ActivityPub defines a [`Move`] activity that partially mitigates this by
asking followers to migrate, but:

 -  Not every fediverse server implements `Move`.
 -  `Move` transfers the follower graph but not the actor's history, posts,
    interactions, or mutual relationships.
 -  Remote servers that have cached your old actor under a blocklist will
    not automatically apply the block to the new one.

Pick your final domain before you federate.  If you are not sure your
current domain will survive, deploy first to a subdomain you control
(`ap.example.com` rather than `example.com`) so that moving the marketing
site later doesn't require migrating the fediverse presence.

If you use the WebFinger/web-origin split (`~FederationOrigin.handleHost`
vs `~FederationOrigin.webOrigin`), the `webOrigin` is the permanent one—
that's the domain that appears in actor URIs.  `handleHost` can be moved
later with a WebFinger redirect, though this is rarely worth the
complexity.

[`Move`]: https://www.w3.org/TR/activitystreams-vocabulary/#dfn-move

### Graceful shutdown and service retirement

Turning off a Fedify server is not the same as turning off a web
application.  A cold shutdown leaves every follower, on every remote
instance, still trying to deliver activities to your inbox—with your
signatures still cached as valid, with your actor URIs still in their
follower lists.  Even well-behaved instances will keep retrying for days
before giving up, and the traffic will follow your DNS until your
certificate expires.

The right procedure is:

1.  *Freeze writes first.* Stop accepting new registrations, new posts,
    and new follow requests.  Your users should see an announcement
    explaining the shutdown and, if relevant, pointers to migration
    tools (`Move`, account exports).

2.  *Broadcast `Delete` activities for every local actor* to its
    followers and to the inboxes of servers that have interacted with
    that actor.  Use `Context.sendActivity()` and pass `orderingKey` so
    that the `Delete` can't overtake earlier Creates/Updates for the
    same actor still in the outbound queue.  Remote servers that process
    the `Delete` will remove the actor from their local cache and stop
    delivering.

3.  *Replace actor dispatchers with `Tombstone` responses.* Change your
    actor dispatcher to return a `Tombstone` instead of the live actor
    object.  Fedify will respond to actor fetches with HTTP `410 Gone` and
    a Tombstone body.  Set `formerType` on the `Tombstone` to the original
    ActivityStreams type (`Person`, `Service`, etc.) so that remote servers
    can preserve the type information in their own logs.  See
    [*Actor dispatcher*](./actor.md) for the Tombstone-returning pattern.

    ~~~~ typescript twoslash
    import type { Federation } from "@fedify/fedify";
    import { Person, Tombstone } from "@fedify/vocab";
    const federation = null as unknown as Federation<void>;
    const deletedAt = Temporal.Instant.from("2026-04-19T00:00:00Z");
    // ---cut-before---
    federation.setActorDispatcher(
      "/users/{identifier}",
      (ctx, identifier) =>
        new Tombstone({
          id: ctx.getActorUri(identifier),
          formerType: Person,
          deleted: deletedAt,
        }),
    );
    ~~~~

4.  *Keep the `410 Gone` response online for weeks or months*, not hours.
    Remote servers' caches expire on different schedules, and some will
    keep retrying for a long time.  Fedify's default
    `~FederationOptions.permanentFailureStatusCodes` includes `410`, so
    well-behaved remote servers will stop trying once they receive it—
    but only if they actually reach your server to receive it.  Serving
    `410` from a cheap static host for a year after shutdown is inexpensive
    and dramatically reduces the long-term federation noise your domain
    generates.

5.  *Only then* take down DNS, release the domain, or retire the
    infrastructure.

Skipping any of these steps is not a catastrophe—the fediverse is
resilient to servers disappearing ungracefully—but it is discourteous,
and the ghost traffic it generates is a problem for everyone else's
operators more than for yours.

### Handling inbound failures

Federation happens with no central coordination, and your peers will
sometimes misbehave.  A few patterns are worth configuring before you hit
them in production:

Permanent failures vs. transient failures
:   `~FederationOptions.permanentFailureStatusCodes` controls which HTTP
    status codes from remote inboxes mean “don't retry.”  The defaults
    (`404`, `410`) cover actor-gone cases; you may want to add others (for
    example, codes specific to instances that return `403` for blocks) if
    you observe a lot of useless retries against instances that have
    started refusing you.

Signature time windows and clock drift
:   HTTP signatures are rejected if the signing time is outside
    `~FederationOptions.signatureTimeWindow` (one hour by default).  On
    a fleet with unsynchronized clocks, this produces verification
    failures that are hard to reproduce because they correlate with which
    node handled the request.  Run NTP on every node (including workers)
    and alert on clock drift.

DNS rebinding during application fetches
:   Fedify's built-in document loaders lock a URL to its initially
    resolved IP before fetching, which defeats DNS-rebinding attacks on
    actor lookups and document fetching.  Application code that calls
    `fetch()` directly on a URL derived from a remote actor (for example,
    to download an avatar) does not get this protection; see the
    [SSRF section](#server-side-request-forgery-ssrf) for the
    `validatePublicUrl()` pattern.

Abusive remotes
:   Rate-limit inbox requests per remote server, not just per-IP.  A
    single poorly-behaved instance can flood your inbox with retries
    during its own outage, and per-IP limits won't distinguish that from
    a flood of independent users.


Pre-launch checklist
--------------------

A condensed pass through everything above.  If you can tick all of these
before taking real traffic, you have covered the pitfalls this guide was
written to warn you about.

### Configuration

 -  [ ] `~FederationOptions.origin` is pinned, or [x-forwarded-fetch] is
    wired up behind a trusted reverse proxy and gated on `BEHIND_PROXY`.
 -  [ ] `MemoryKvStore` and `InProcessMessageQueue` are not used outside
    of tests; a persistent KV and MQ backend is configured.
 -  [ ] Actor key pairs are generated once per actor at registration time
    and stored in the database—not regenerated on each restart.
 -  [ ] `allowPrivateAddress` is unset (or explicitly `false`) in
    production.
 -  [ ] `skipSignatureVerification` is unset (or explicitly `false`) in
    production.

### Scaling

 -  [ ] Web and worker roles are split with `manuallyStartQueue: true` and
    `Federation.startQueue()`; workers are not reachable through the load
    balancer.
 -  [ ] No `sendActivity()` call sites use `immediate: true` outside of
    tests.
 -  [ ] `ParallelMessageQueue` parallelism, if used, is matched by a
    database connection pool sized for `N + headroom`.

### Runtime and infrastructure

 -  [ ] The process runs under a supervisor (systemd, Compose,
    Kubernetes, or platform-equivalent) that restarts on crash and
    respects SIGTERM for graceful shutdown.
 -  [ ] A reverse proxy terminates TLS, forwards `Host`,
    `X-Forwarded-Host`, and `X-Forwarded-Proto`, and preserves the
    `Accept` and `Content-Type` headers verbatim.
 -  [ ] Port 80 redirects to 443; no part of the federation surface is
    reachable over plain HTTP.
 -  [ ] NTP is running on every node; clock drift is monitored.

### Security

 -  [ ] All federated HTML (post content, summaries, actor bios, display
    names) is sanitized through an allowlist-based library before
    rendering to browsers.
 -  [ ] A Content-Security-Policy header is set and forbids inline
    scripts and inline event handlers.
 -  [ ] Application-code fetches of remote-supplied URLs (avatars,
    attachments, link previews, webhooks) are guarded with
    `validatePublicUrl()` or an equivalent SSRF defense, and redirects
    are either disabled or validated per hop.
 -  [ ] Secrets are managed via the environment or a secret manager, not
    committed to source; actor private keys live in the database, backed
    up alongside the rest of the application data.

### Observability

 -  [ ] Structured logs are emitted to stderr at `info` or `warn` level
    by default; sensitive fields are redacted at the sink.
 -  [ ] OpenTelemetry exports traces to your backend of choice with a
    realistic sampling rate.
 -  [ ] Error aggregation (Sentry or equivalent) is wired up through a
    LogTape sink.
 -  [ ] Queue depth, inbox processing latency, outbox delivery success
    rate, and remote `410`/`404` rate are all tracked and alert on sustained
    anomalies.

### ActivityPub

 -  [ ] The domain is the one you intend to keep forever, and the
    WebFinger/web-origin split (if any) has the permanent host as
    `webOrigin`.
 -  [ ] A service-retirement runbook exists (freeze writes, broadcast
    `Delete`, serve `Tombstone` and `410 Gone` for an extended period)
    before it is ever needed.
