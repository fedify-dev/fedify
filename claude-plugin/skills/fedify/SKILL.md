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
works across Node.js, Bun, and Deno.  The library takes care of the fiddly
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

Do not choose *@fedify/fresh* for new projects: Fresh is not recommended for
new projects, and the integration is tentatively planned for removal in
Fedify 3.0.0.  It remains supported for existing Fresh applications throughout
the 2.x series.

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

### Observing outbound delivery

Register callbacks with `federation.setOutboundObservers()` or the builder's
matching method.  Registration replaces the whole set; `{}` clears it.  Active
sends keep the callbacks selected when they began.  Observers use the existing
context and work without OpenTelemetry.

Choose callbacks by the question you need to answer:

| Callback         | Reports                                                                    |
| ---------------- | -------------------------------------------------------------------------- |
| `onBroadcast`    | One send or forward invocation, including preparation and its result.      |
| `onDelivery`     | Each destination's plan, handoff, or preparation failure.                  |
| `onAttempt`      | The outcome of one concrete send, including each retry or gateway attempt. |
| `onHttpExchange` | Each actual HTTP request and its response or fetch error.                  |
| `onWorker`       | The local result and scheduling actions of a fanout or outbox worker.      |

`onBroadcast` and `onDelivery` also cover automatic portable replication.
Broadcasts have a `broadcastId`; destinations have a `deliveryId`.  An
`onDelivery` event can refer to an unknown broadcast when it comes from legacy
fanout work.  These IDs group reports; they do not prove remote receipt.
The `event.activity` reference is a snapshot of known `id` and `type` IRI
strings; it may be empty on `started` and can gain facts later.

For broadcasts, narrow `event.stage` before reading `event.result.type`.
For deliveries, narrow `event.stage` and, for handoffs, `event.result.type`.
Attempt reports have a fresh `attemptId` and an `outcome`; their
`httpExchangeCount` counts actual fetches, including redirects and signature
challenges.  A failure before the first fetch has a count of zero.  Worker
reports distinguish normal local completion from an escaping error.  Their
`actions` record enqueues, retries, deferrals, direct handoffs, abandonment,
and failed drops.  A completed worker does not imply remote success or queue
acknowledgment.

Header capture is off by default.  Set `requestHeaders` or `responseHeaders`
with an allowlist and byte limit to add redacted header snapshots to exchange
reports.  `responseBodyCapture` separately invokes `onBody` with a bounded
stream and deadline; read it incrementally and honor its cancellation signal.
Use `senderPayload: true` only when the attempt report needs a privacy-filtered
projection of the outgoing activity.  These options do not change the bytes
sent or signed.  Treat all captured evidence as sensitive application data.

Callbacks are awaited, and callback or logging errors do not replace delivery
results.  A callback that never settles can still delay the send.  If you
record events in the background, handle rejection, shutdown, and persistence
in the application.

Use the `dispatchId` send or forward option to carry an application correlation
ID through queues.  Event `provenance` preserves known source facts; `local`
describes the current execution.  Optional `trace` contains the operation's
own span IDs when tracing is enabled.  Older queue messages can lack these
facts.  Consumers warn and omit malformed queued provenance so delivery can
continue.  Invalid `dispatchId` values on new sends raise an error before
preparation; the limit is 1,024 UTF-8 bytes.  Reusing an ID does not
deduplicate sends.

For typed examples, report variants, and capture limits, see the
[sending manual].

[sending manual]: https://fedify.dev/manual/send.md


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

In Fedify 2.5.0 and later, `Object` subclasses support FEP-171b history
references through `contextHistory` or `contextHistories` constructor options
(`URL` or `Collection` values, including ordered collections and pages). Read
`contextHistoryId` and `contextHistoryIds` without fetching; use
`getContextHistory()` and `getContextHistories()` to resolve the first or all
history collections. Output uses an inline context mapping, and the published
FEP-171b context is preloaded for input. In `@fedify/backfill`, opt in with
`contextSource: "history-first"` to read the seed's first history reference.
Omitting the option keeps the existing `context` source. Absent or unavailable
history (`null`, an ordinary loader error, or a non-collection result) falls
back to the first `context` ID, using the remaining request budget. Once a
history collection is resolved, it stays selected even if empty or no
items can be yielded. Later history references are not tried, and sources are
not merged. Portable history references are passed to the configured backfill
loader for resolution and verification.
Existing strategies control post extraction; later explicitly configured
strategies can still run. Set `contextDiscovery: "ancestors"` to search
`inReplyTo` ancestors when the seed has no usable collection, bounded by
`maxDepth`. The nearest usable collection wins, with reply-target property
order breaking ties; a valid empty collection stays selected. Source selection
applies to each ancestor. Discovery shares traversal limits, caching,
cancellation, and ID deduplication with configured strategies. Per-object
loader and verifier defaults remain effective across strategy orders, without
hydrating the seed or loaded ancestors. Collection
items retain origin `"collection"` and depth 0; ancestors are yielded only
with `"reply-tree"`. Without this option, context strategies make no ancestor
requests. These options do not unwrap
`Add` activities or replay updates and deletions. Histories containing only
`Add(Create(...))` activities yield nothing and do not trigger `context`
fallback.

Since Fedify 2.5.0, pass `dereference: false` to vocabulary accessors to read
embedded or cached objects without fetching references. Singular accessors
return `null` when fetching is required; plural accessors skip those values.
Origin and portable-object trust checks still apply. The default is `true`.

`clone()` is shallow: it copies property arrays but shares nested vocabulary
objects and URLs.  In Fedify 2.5.0 and later, use synchronous `deepClone()` to
resolve nested properties without hydrating the source's objects.  Replacement
values are copied too.  Each copied node keeps its own default loaders and
verifier; second-argument options override only the root.  The copy drops cached
JSON-LD and retained signed representations, so retain the received document
when its exact representation matters and sign copies again when needed.
Keep property arrays stable during copying, including inside custom `clone()`
overrides: `deepClone()` snapshots the existing indices of large sparse arrays.
Entries added during copying are not visited, so their nested objects may
remain shared.  Copying preserves array length and holes.

To read a property that has no typed accessor, such as an application's
extension, use `getRawPropertyValues(object, propertyIri)` or
`getRawPropertyValue()` from `@fedify/vocab` (Fedify 2.5.0 and later) instead
of digging through `toJsonLd()` output.  Pass the full property IRI, never a
compact IRI like `as:content` or a term; prefixes are not expanded.  The
results are untyped expanded JSON-LD values, unverified like any received
data, so validate them before use.  For properties Fedify does support, the
functions return the current typed values encoded back, not the received
document.

To publish an extension, use asynchronous
`withRawProperty(object, propertyIri, values)` or
`withRawProperties(object, entries)` from `@fedify/vocab` (Fedify 2.5.0 and
later).  They return a fresh shallow copy of the same concrete class.  Pass
arrays of expanded `RawPropertyValue` objects; `[]`, `null`, and an explicitly
supplied `undefined` remove a property.  Batch entries can be a record or an
iterable of `[IRI, values]` pairs.  Duplicate destinations, including a typed
property's canonical IRI and alias, reject the batch.  Known IRIs decode into
typed fields and reset their trust; unsupported IRIs are retained and published
only when explicitly written.  Written extensions survive nesting and cloning;
unrelated received extensions are not newly forwarded.  Raw reads of a typed
parent property include its children's explicitly written extensions.

Writer copies drop received JSON-LD and retained signed representations.
Proof values are not automatically removed: clear them with
`clone({ proofs: [] })` before updating and re-signing an object.  Write raw
properties before calling `signObject()`.

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
| *@fedify/pglite*    | yes       | no             |
| *@fedify/postgres*  | yes       | yes            |
| *@fedify/mysql*     | yes       | yes            |
| *@fedify/redis*     | yes       | yes            |
| *@fedify/amqp*      | no        | yes            |
| *@fedify/cfworkers* | yes       | yes            |

Do not choose *@fedify/denokv* for new projects: it is deprecated since
Fedify 2.5.0 and will be removed in Fedify 3.0.0.  It remains supported for
existing Deno applications throughout the 2.x series.

On Cloudflare Workers, use `WorkersD1KvStore` (backed by D1) rather than
`WorkersKvStore` (backed by Workers KV).  Fedify's key–value workload is
balanced between reads and writes and needs strong consistency, and only
`WorkersD1KvStore` implements `AtomicKvStore`.  Pass the `D1Database` binding
for fresh primary reads; caller-owned sessions can serve stale `getMany()`
snapshots even after their first `first-primary` query.  CAS always uses a
write transaction with a guard row, including absence-only CAS.  Create both
the entry table and `<tableName>_atomic` guard table plus the expiry index
with a D1 migration before using `initialized: true`.  The entry table needs
a single-column `key` primary index with `BINARY` collation.  Follow the
complete schema and codec/TTL/batch limits in the
[KV manual][atomic support matrix]; a table name ending in `_atomic` is
reserved.  Single and multi-key writes share the same protocol; oversized calls
reject instead of splitting.

For application transitions across several keys, require `AtomicKvStore`
from `@fedify/fedify` and narrow an existing `KvStore` with
`isAtomicKvStore()`.  All five methods (`cas()`, `getMany()`, `setMany()`,
`deleteMany()`, `casMany()`) are required on `AtomicKvStore` and optional on
ordinary `KvStore`.  The guard checks method presence; it does not certify
atomicity or durability.  `getMany()` returns an input-ordered snapshot;
`casMany()` checks every expectation before committing all changes.  On
`false`, reread and re-evaluate application eligibility before retrying.

`MysqlKvStore` implements `AtomicKvStore` on an InnoDB table in one primary
database.  It supports up to 1,000 entries per call and serialized keys up to
768 Unicode code points.  Use a normal mysql2 pool with `autocommit` enabled,
default object/type decoding, and one fixed-offset or UTC session time zone
across clients.  Initialization validates the schema even with
`initialized: true`; do not use caller-owned pool transactions, replica reads,
or change the schema during operations.  Values round-trip through JSON and
CAS compares decoded structures; `set(undefined)` rejects and omitted TTLs
clear expiry.  TTLs are truncated to safe integer microseconds.  Deadlocks and
MariaDB snapshot conflicts retry with fresh comparisons up to five attempts;
backend errors reject, and lost commit responses can have unknown outcomes.
See *packages/mysql/README.md* for the full schema, codec and server limits.

`expectedValue: undefined` means absence; `newValue: undefined` means deletion
in CAS. Atomic stores reject `set(key, undefined)` and `setMany()` entries
whose value is `undefined`.  They also reject TTLs on deletions and duplicate
mutation keys before writing.  Missing or expired values are `undefined`;
stored `null` remains `null`.  Per-entry TTL, equality, supported values,
limits, and atomic key scope follow the adapter's documented contract.  Never
emulate batches with separate calls, `Promise.all()`, or a process-local mutex
for a shared backend.  Separate calls do not form a transaction; uncertain
commit results need receipts or version checks, and ABA detection needs a
non-reused version.

`MemoryKvStore`, `PostgresKvStore`, `SqliteKvStore`, `PgliteKvStore`,
`MysqlKvStore`, and `WorkersD1KvStore` implement the atomic interface in their documented scopes.
SQLite covers one configured table/database on a writable, normally locking
connection.  Nonempty batches and ordinary mutations reject caller-owned
transactions and use one transaction; snapshots and mismatching CAS can reject
busy, including under rollback-journal reader contention.  Configure busy
timeout on the connection; the KV store has no retry policy.  Use decoded JSON
expectations, structural comparison, and the documented millisecond TTL
precision and resource limits.  `SqliteMessageQueue` defaults to WAL on shared
files; concurrent WAL use needs a patched SQLite engine (Bun 1.2.22 SQLite
3.50.4 is affected by the WAL-reset bug).  See the adapter documentation.

For PGlite, share one normal owner and table across wrappers, require standard
JSONB/text-array codecs, and keep raw/manual transaction control and
caller-owned transaction callbacks outside store calls.  CAS ignores object
member order and preserves array order.  Keys reject malformed Unicode and
NUL; negative/overflowing TTLs and deletion TTLs reject.  Calendar expiry uses
the session time zone and one cutoff per call.  Large batches block the owner;
engine insertion failures roll back, while mismatch does not prove proposed
writes would fit.  Do not infer crash durability, browser persistence, or
worker-proxy support.  Read the PGlite package README's synchronization policy.

The Redis atomic extension is tracked separately in issue #1365; Deno KV and
Netlify Blobs have no atomic adapter child issue.  `WorkersKvStore` lacks CAS.
D1 operations cover one configured table in one database, with JSON
serialization and millisecond TTLs.  Check the [atomic support matrix] and
installed declarations before selecting a production adapter.

`MemoryKvStore` is development-only and retains references, including
references to the same object stored under several keys.  Keep stored and
returned data immutable; its snapshots do not clone or freeze values.  Inputs
must be passive data, without getters, proxies, or other behavior that reenters
the store.  Production codecs can support different values and comparison
rules. Cache cleanup examples apply only to cache prefixes; authoritative state
such as budgets and replay cutoffs needs its own retention policy.

Mutating single-key PostgreSQL `cas()` takes a table write lock and rolls back
trigger-skipped matching mutations instead of returning `false`.  It supports
reserved clients using a per-call transaction or a savepoint in an existing
manual transaction.  Caller-owned connections require exclusive sequential use;
CAS locks remain until outer commit even on mismatch.

For PostgreSQL atomic operations, use one ordinary table or declarative
partition and the default JSON codec (`jsonb` equality ignores object member
order).  Nonempty `casMany()` and multi-key `deleteMany()` require a pool or
READ COMMITTED transaction-scoped Postgres.js client; reserved clients reject
those scopes.  Caller transactions require exclusive sequential use during
each atomic call, across other wrappers and raw SQL too.  Nested savepoints
do not isolate concurrent calls on one outer transaction.  Successful caller
batches are provisional and retain locks until outer commit.  Table-wide write
locks protect absent keys but serialize writers and can interrupt autovacuum;
lock errors reject without automatic retry.  After lock-upgrade deadlock,
roll back the outer transaction before retrying.  Active row-level security,
ordinary inheritance and irreversible JSON/value transforms are unsupported for
batches.  TTLs use server time and PostgreSQL calendar intervals at microsecond
precision. Backend storage constraints may fail an attempted write; a mismatch
performs no insertion.  Atomicity does not override unlogged/WAL/replica
durability. Consult the [PostgreSQL atomic scope] before choosing a client or
codec.

For `PostgresKvStore`, existing populated tables and externally managed DDL
(`initialized: true`) need the [expiry expression index] to accelerate cleanup.
Run concurrent index creation outside a transaction, followed by `ANALYZE`.
The migration can precede an application upgrade; old writers maintain the
index too.  Keep the original TTL columns and calendar semantics.

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

[atomic support matrix]: https://fedify.dev/manual/kv.md#current-support
[PostgreSQL atomic scope]: https://fedify.dev/manual/kv#postgresql-atomic-operations
[expiry expression index]: https://fedify.dev/manual/kv.md#postgresql-expiry-index


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

On Cloudflare Workers, use `SimpleSpanProcessor` and configure the exporter's
`waitUntil` option (since 2.5.0) with a request-aware callback, or create the
exporter per request with `ctx.waitUntil.bind(ctx)`.  A shared exporter must
not retain one request's execution context.  In a `finally` block around
`await federation.fetch()`, pass `tracerProvider.forceFlush()` to
`ctx.waitUntil()` so the flush is scheduled on both success and failure.
With `SimpleSpanProcessor`, this also covers pending asynchronous resource
attributes.  In `@opentelemetry/sdk-trace-base` 2.7.1, a batch already waiting
for resource attributes can be missed by a later provider flush, so do not rely
on that flush with `BatchSpanProcessor`.  Batch timers alone do not keep an
invocation alive.  The exporter's `forceFlush()` and `shutdown()` wait for
export attempts already started; storage failures are logged and reported
through the export callback.

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
debugging. For command examples, output interpretation, and federation
diagnostics, use the separate `fedify-cli` skill, distributed through the
Claude Code plugin and the `@fedify/cli` npm package. The CLI also works with
ActivityPub servers built without Fedify.

The CLI includes:

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
