---
name: fedify
description: >-
  Use this skill whenever writing JavaScript or TypeScript code that uses
  Fedify to build an ActivityPub server, handle federation activities,
  implement fediverse features, or integrate Fedify with a web framework
  such as Hono, Express, Next.js, Nuxt, Fastify, Koa, NestJS, Astro,
  SvelteKit, Fresh, h3, Elysia, or Cloudflare Workers. Covers the
  `Federation` builder pattern, actor/inbox/outbox/collection dispatchers,
  inbox listeners, vocabulary objects from `@fedify/vocab`, key pair
  management, HTTP Signatures, Object Integrity Proofs, the `KvStore` and
  `MessageQueue` interfaces, database adapter packages, structured logging
  with LogTape, OpenTelemetry tracing, the `fedify` CLI toolchain, and
  common mistakes. Also apply when the user mentions ActivityPub,
  federation, fediverse, WebFinger, NodeInfo, FEPs, or Mastodon
  interoperability, even if they do not name Fedify explicitly.
---

Fedify skill
============

Fedify is a TypeScript library for ActivityPub server applications.  It
works across Deno, Node.js, and Bun.  The library takes care of the fiddly
parts of the fediverse (HTTP Signatures, Object Integrity Proofs,
WebFinger, NodeInfo, JSON-LD, delivery queues) so application code can
stay focused on dispatchers and activity handlers.

Always link into the full documentation at <https://fedify.dev/>
instead of guessing.  Every docs page is also served as raw Markdown
by appending `.md` to its path, so
<https://fedify.dev/manual/federation.md> returns `text/markdown`.
This skill uses the `.md` form in every fedify.dev link below so you
can read the source directly without HTML rendering; when you present
a link *to the user*, strip the `.md` suffix so browsers render the
HTML page (so `https://fedify.dev/manual/federation.md` becomes
`https://fedify.dev/manual/federation`).  The index at
<https://fedify.dev/llms.txt> and the full bundle at
<https://fedify.dev/llms-full.txt> are authoritative; this skill only
points the way.  Do not invent APIs; verify names against those docs
or against the installed `@fedify/fedify` types.


Builder pattern
---------------

Two entry points reach a `Federation<TContextData>` object:

 -  `createFederationBuilder<TContextData>()` returns a
    `FederationBuilder<TContextData>`.  Register dispatchers and
    listeners on it, then `await builder.build(options)` to obtain the
    `Federation<TContextData>`.  Prefer this in larger apps, especially
    when you need to split configuration across files or avoid circular
    imports.  In serverless runtimes such as Cloudflare Workers,
    bindings are only available per-request, so the `Federation` must be
    constructed inside the request handler; the builder pattern is the
    documented approach there because dispatcher registration can happen
    at module load time and only the asynchronous `.build(options)` call
    runs per request.
 -  `createFederation<TContextData>(options)` returns a
    `Federation<TContextData>` directly.  Appropriate when everything
    fits in one module.

`.build()` is asynchronous; always `await` it.  See
<https://fedify.dev/manual/federation.md>.

~~~~ typescript
import { createFederationBuilder, MemoryKvStore } from "@fedify/fedify";

const builder = createFederationBuilder<AppState>();
// ...register dispatchers on builder...
export const federation = await builder.build({
  kv: new MemoryKvStore(),  // development only
});
~~~~

> [!IMPORTANT]
> Production deployments *must* provide a real `queue` implementation.
> Without one, outgoing activities are sent synchronously and delivery
> becomes unreliable under load.  See
> <https://fedify.dev/manual/federation.md>.

> [!WARNING]
> Never set `allowPrivateAddress: true` outside tests.  It disables the
> SSRF guard that blocks Fedify from fetching private or loopback
> addresses.  See <https://fedify.dev/manual/federation.md> and
> <https://fedify.dev/manual/deploy.md>.


Dispatchers
-----------

Every route Fedify serves is driven by a dispatcher callback registered on
the builder (or `Federation` object).  Do not hand-roll these routes in
the web framework; the dispatcher signatures encode the library's URI
template guarantees.

 -  `setActorDispatcher(path, dispatcher)`: returns an
    `ActorCallbackSetters` chain that also carries
    `setKeyPairsDispatcher()`.
 -  `setObjectDispatcher(type, path, dispatcher)`: for individual
    `Object` types such as `Note` or `Article`.
 -  `setInboxDispatcher(path, dispatcher)`: the inbox *collection*
    endpoint.  The inbox *listener* is a different API (see below).
 -  `setOutboxDispatcher(path, dispatcher)`.
 -  `setFollowingDispatcher(path, dispatcher)` /
    `setFollowersDispatcher(path, dispatcher)` /
    `setLikedDispatcher(path, dispatcher)` /
    `setFeaturedDispatcher(path, dispatcher)` /
    `setFeaturedTagsDispatcher(path, dispatcher)`.
 -  `setCollectionDispatcher()` and `setOrderedCollectionDispatcher()`
    for custom collections.
 -  `setNodeInfoDispatcher(path, dispatcher)` and
    `setWebFingerLinksDispatcher(dispatcher)` for protocol endpoints.

Paths use URI templates.  If an identifier can contain URI characters,
switch the template variable from `{identifier}` to `{+identifier}` to
avoid double-encoding.  See <https://fedify.dev/manual/uri-template.md>.

> [!WARNING]
> Simple expansion (`{identifier}`) percent-encodes reserved characters a
> second time.  If actors or objects are keyed by URIs, use reserved
> expansion (`{+identifier}`).

See <https://fedify.dev/manual/actor.md>,
<https://fedify.dev/manual/object.md>, and
<https://fedify.dev/manual/collections.md>.


Inbox listeners
---------------

`setInboxListeners(inboxPath, sharedInboxPath?)` returns an
`InboxListenerSetters` object with:

 -  `.on(ActivityType, handler)`: chainable, keyed by the *class*
    (`Follow`, `Create`, `Undo`, etc.).
 -  `.onError(handler)`.
 -  `.onUnverifiedActivity(handler)`.
 -  `.setSharedKeyDispatcher(dispatcher)`.
 -  `.withIdempotency(strategy)`.

> [!WARNING]
> Activities of a type that is not registered via `.on()` are answered
> with HTTP 202 and logged at error level as an unsupported activity,
> but never reach a listener.  To catch everything, register a listener
> for the base `Activity` class.

See <https://fedify.dev/manual/inbox.md>.


Context and `TContextData`
--------------------------

`Context<TContextData>` is the per-operation handle Fedify passes to
dispatchers and listeners.  The `TContextData` generic carries
application state (database handles, request id, auth session).  Treat it
as the single place to inject dependencies; do not reach for module-level
singletons inside handlers.

`RequestContext<TContextData>` extends `Context<TContextData>` with
request-scoped helpers.

Use `ctx.get…Uri()` helpers (for example `ctx.getActorUri(identifier)`)
to build canonical URIs instead of string-concatenating paths.

> [!CAUTION]
> The `crossOrigin: "trust"` option on context methods and on vocabulary
> dereferencing disables the same-origin check.  Only use it when the
> remote document is known to be trustworthy; it was the source of
> prior interop bugs.

See <https://fedify.dev/manual/context.md> and
<https://fedify.dev/manual/context-advanced.md>.


Framework integrations
----------------------

Mount Fedify through the dedicated integration package for the target
framework.  Do not translate requests manually; the integration handles
content negotiation, signature verification, and response streaming.

| Framework          | Package              |
| ------------------ | -------------------- |
| Astro              | *@fedify/astro*      |
| Cloudflare Workers | *@fedify/cfworkers*  |
| Elysia             | *@fedify/elysia*     |
| Express            | *@fedify/express*    |
| Fastify            | *@fedify/fastify*    |
| Fresh              | *@fedify/fresh*      |
| h3                 | *@fedify/h3*         |
| Hono               | *@fedify/hono*       |
| Koa                | *@fedify/koa*        |
| NestJS             | *@fedify/nestjs*     |
| Next.js            | *@fedify/next*       |
| Nuxt               | *@fedify/nuxt*       |
| SolidStart         | *@fedify/solidstart* |
| SvelteKit          | *@fedify/sveltekit*  |

Two more packages are frequently useful: *@fedify/debugger* for a local
ActivityPub dashboard, and *@fedify/relay* for relay implementations.

See <https://fedify.dev/manual/integration.md>.


Built-in protocol endpoints
---------------------------

Fedify serves these endpoints automatically as soon as the federation
handler is mounted; do not reimplement them.

 -  `/.well-known/webfinger` (WebFinger).  Customize link output with
    `setWebFingerLinksDispatcher()`.  See
    <https://fedify.dev/manual/webfinger.md>.
 -  `/.well-known/nodeinfo` and the versioned NodeInfo document.
    Customize with `setNodeInfoDispatcher()`.  See
    <https://fedify.dev/manual/nodeinfo.md>.


Outgoing activities
-------------------

`ctx.sendActivity(sender, recipients, activity, options?)` is the single
entry point for outbound delivery.  Two overloads:

 -  Explicit recipients: pass a single `Recipient` or an array.  The
    `sender` may be a `SenderKeyPair`, a `SenderKeyPair[]`, or
    `{ identifier }` / `{ username }`.
 -  Fan-out: pass the literal `"followers"` to deliver to the sender's
    `Followers` collection.  In this overload the `sender` must be
    `{ identifier }` or `{ username }`; a raw `SenderKeyPair` or
    `SenderKeyPair[]` is rejected because Fedify needs the actor
    identifier to resolve the followers collection.

Always route outbound activities through the queue in production; this is
the same `queue` provided to `createFederation()` or `.build()`.  Without
a queue the call blocks until every recipient responds and failed
deliveries have no retry.

> [!CAUTION]
> Do not derive an activity's `id` from `(actor, object)`.  The same
> actor can send the same activity shape to the same object more than
> once (for example `Follow` → `Undo(Follow)` → `Follow` again), and
> those must be distinct activities.  Use a fresh UUID or counter in the
> fragment.

See <https://fedify.dev/manual/send.md>.


Vocabulary imports
------------------

Import ActivityStreams and ActivityPub vocabulary types from
`@fedify/vocab`.  The historical path `@fedify/fedify/vocab` is a
deprecated shim kept for backwards compatibility; new code should not use
it.  Likewise, `@fedify/vocab-runtime` replaces the old
`@fedify/fedify/runtime` path, and `@fedify/webfinger` replaces the old
in-tree *src/webfinger*.

> [!CAUTION]
> Several vocabulary classes collide with JavaScript globals (notably
> `Object`).  When importing, either use a namespace import
> (`import * as vocab from "@fedify/vocab"`) or alias the individual
> class.

`fromJsonLd()` and `toJsonLd()` are asynchronous; always `await` them.

> [!WARNING]
> `crossOrigin: "trust"` on vocabulary deserialization trusts embedded
> objects without re-fetching.  Treat it as you would
> `dangerouslySetInnerHTML`.

See <https://fedify.dev/manual/vocab.md>.


Key pair management
-------------------

`setActorDispatcher(...).setKeyPairsDispatcher(dispatcher)` supplies the
actor's key pairs.  Return *two* keys per actor:

 -  An RSA-PKCS#1-v1.5 key for HTTP Signatures (Mastodon interop).
 -  An Ed25519 key for FEP-8b32 Object Integrity Proofs.

Fedify signs outbound activities with whatever keys are available; for
interop with the widest set of peers, provide both.

> [!WARNING]
> Private keys must live in secret storage.  They are not configuration;
> do not check them into repositories, embed them in container images,
> or expose them via admin endpoints.

See <https://fedify.dev/manual/actor.md>.


Persistent storage
------------------

Fedify defines two storage interfaces: `KvStore` (key/value cache and
idempotence) and `MessageQueue` (delivery plus inbox processing), both
re-exported from `@fedify/fedify`.  Use the built-in `MemoryKvStore` only
in development or tests.

| Package             | `KvStore` | `MessageQueue` |
| ------------------- | --------- | -------------- |
| *@fedify/sqlite*    | yes       | yes            |
| *@fedify/postgres*  | yes       | yes            |
| *@fedify/mysql*     | yes       | yes            |
| *@fedify/redis*     | yes       | yes            |
| *@fedify/amqp*      | no        | yes            |
| *@fedify/denokv*    | yes       | yes            |
| *@fedify/cfworkers* | yes       | yes            |

> [!WARNING]
> `PostgresMessageQueue` and similar implementations require connection
> pooling sized for parallel consumers; a single shared connection will
> deadlock under `ParallelMessageQueue`.  See
> <https://fedify.dev/manual/mq.md>.

> [!WARNING]
> Do not load-balance worker nodes that drain the queue.  Each worker
> should take traffic independently; putting them behind a load balancer
> breaks idempotency tracking.  See <https://fedify.dev/manual/deploy.md>.

See <https://fedify.dev/manual/kv.md> and <https://fedify.dev/manual/mq.md>.


Observability
-------------

### LogTape

Fedify emits structured logs via [LogTape] under the following
categories.  Configure LogTape once at application start (if this
project has a separate LogTape skill installed, defer to it for the
generic setup):

 -  `fedify.compat.transformers`
 -  `fedify.federation`, `fedify.federation.actor`,
    `fedify.federation.collection`, `fedify.federation.fanout`,
    `fedify.federation.http`, `fedify.federation.inbox`,
    `fedify.federation.outbox`, `fedify.federation.queue`
 -  `fedify.nodeinfo.client`
 -  `fedify.otel.exporter`
 -  `fedify.sig.http`, `fedify.sig.key`, `fedify.sig.ld`,
    `fedify.sig.proof`
 -  `fedify.utils.docloader`, `fedify.utils.kv-cache`
 -  `fedify.webfinger.server`

> [!CAUTION]
> Since LogTape 0.7.0, implicit contexts require explicit configuration.
> See <https://fedify.dev/manual/log.md>.

[LogTape]: https://logtape.org/

### OpenTelemetry

Pass a `tracerProvider` in `FederationOptions` to have Fedify instrument
its internals.  For trace persistence, `@fedify/fedify/otel` exports
`FedifySpanExporter`, which writes traces to a `KvStore` so the
*@fedify/debugger* dashboard can render them.

> [!CAUTION]
> Initialize the OpenTelemetry SDK *before* importing Fedify.  Later
> registration leaves earlier spans untraced.

See <https://fedify.dev/manual/log.md> and
<https://fedify.dev/manual/opentelemetry.md>.


Looking up FEPs
---------------

When the user references a Fediverse Enhancement Proposal (for example
`FEP-8fcf` or `FEP-1b12`), clone the proposals repository locally and
read the relevant file; Codeberg blocks web scraping and `WebFetch`-style
requests fail:

~~~~ bash
git clone https://codeberg.org/fediverse/fep.git
~~~~

Files are under *fep/* keyed by the four-hex-digit identifier (for
example *fep/8fcf/fep-8fcf.md*).  If the project is configured with the
[FEP MCP server], prefer that instead.

[FEP MCP server]: https://github.com/dahlia/fep-mcp


CLI helpers
-----------

The `fedify` CLI (distributed as *@fedify/cli*) covers bootstrapping and
debugging:

 -  `fedify init`: scaffold a new project (pick web framework, package
    manager, KV store, and message queue).
 -  `fedify lookup`: resolve a handle, URL, or WebFinger identifier and
    print the dereferenced document.
 -  `fedify inbox`: spin up a temporary inbox with a tunnel to inspect
    incoming activities from real peers.
 -  `fedify webfinger`, `fedify nodeinfo`, `fedify tunnel`,
    `fedify relay`.

> [!WARNING]
> `fedify inbox` and `fedify tunnel` are development tools.  They open a
> public tunnel to your local process; do not run them against
> production data.

See <https://fedify.dev/cli.md>.


Common mistakes to avoid
------------------------

 -  Forgetting to `await builder.build(...)` or `await ctx.sendActivity(...)`.
    Both are asynchronous.
 -  Hand-rolling `/.well-known/webfinger` or `/.well-known/nodeinfo`
    routes; Fedify already serves them.
 -  Importing from the deprecated shims `@fedify/fedify/vocab` or
    `@fedify/fedify/runtime`, or from the old in-tree *src/webfinger*
    path, instead of the dedicated packages `@fedify/vocab`,
    `@fedify/vocab-runtime`, and `@fedify/webfinger`.
 -  Omitting the `queue` option in production; outgoing delivery becomes
    synchronous and unreliable.
 -  Running with `MemoryKvStore` in production; it evaporates on every
    restart.
 -  Running behind a reverse proxy, a tunnel (`fedify tunnel`, ngrok,
    Cloudflare Tunnel, Tailscale Funnel), or a load balancer without
    propagating the original origin.  Fedify reads `request.url`, so
    without `X-Forwarded-*` handling it will mint actor IDs and activity
    URLs using the internal origin (for example `http://localhost:3000`)
    instead of the public `https://…` address that remote peers
    dereference.  Fix one of two ways: pin
    `FederationOptions.origin` to the canonical URL, or pipe requests
    through [x-forwarded-fetch] before they reach Fedify (gated on a
    `BEHIND_PROXY` flag, since `X-Forwarded-Host` is spoofable from the
    open internet).  See <https://fedify.dev/manual/deploy.md>.
 -  Enabling `allowPrivateAddress: true` outside tests; that disables the
    SSRF guard.
 -  Using `crossOrigin: "trust"` without verifying the remote is
    actually trusted.
 -  Registering inbox handlers only for specific activity types and
    expecting delivery-level error handling; unregistered types are
    answered with HTTP 202 and logged at error level as unsupported,
    but never reach a listener.  Add a catch-all on `Activity` if you
    need to observe them.
 -  Wiring Fedify into a web framework by writing custom routes instead
    of importing the matching `@fedify/<framework>` package.
 -  Load-balancing queue worker nodes; each worker must take traffic
    independently.
 -  Using simple URI-template expansion (`{identifier}`) when identifiers
    contain reserved URI characters; switch to `{+identifier}`.
 -  Deriving an activity's `id` from `(actor, object)`; the same pair
    can legitimately produce multiple activities of the same shape.
 -  Returning `Tombstone` from an actor dispatcher without checking
    `RequestContext.getActor({ tombstone: "passthrough" })` semantics;
    see <https://fedify.dev/manual/actor.md>.
 -  Committing private keys, embedding them in bundles, or exposing them
    through admin endpoints.

[x-forwarded-fetch]: https://github.com/dahlia/x-forwarded-fetch
