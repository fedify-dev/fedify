---
description: >-
  The Federation object is the main entry point of the Fedify library.
  This section explains the key features of the Federation object.
---

Federation
==========

The `Federation` object is the main entry point of the Fedify library.
It provides a set of methods to configure and run the federated server.
The key features of the `Federation` object are as follows:

 -  Registering an [actor dispatcher](./actor.md)
 -  Registering [inbox listeners](./inbox.md)
 -  Registering [collections](./collections.md)
 -  Registering [object dispatchers](./object.md)
 -  Creating a `Context` object
 -  Maintaining a queue of [outgoing activities](./send.md)
 -  Registering a [NodeInfo dispatcher](./nodeinfo.md)

You can create a `Federation` object by calling `createFederation()` function
with a configuration object:

~~~~ typescript twoslash
import { createFederation, MemoryKvStore } from "@fedify/fedify";

const federation = createFederation<void>({
  kv: new MemoryKvStore(),
  // Omitted for brevity; see the following sections for details.
});
~~~~


Constructor parameters
----------------------

The `createFederation()` function takes an object with the following
properties.  Some of them are required:

### `kv`

*Required.*  The `~FederationOptions.kv` property is a `KvStore` instance
that the `Federation` object uses to store several kinds of cache data and
to maintain the queue of outgoing activities.

`KvStore` is an abstract interface that represents a key–value store.
For now, Fedify provides two built-in implementations of `KvStore`, which are
`MemoryKvStore` and `DenoKvStore` classes.  The `MemoryKvStore` class is for
testing and development purposes, and the `DenoKvStore` class is Deno KV-backed
implementation for production use (as you can guess from the name, it is only
available in Deno runtime).

As separate packages, [`@fedify/redis`] provides [`RedisKvStore`] class, which
is a Redis-backed implementation for production use, and [`@fedify/postgres`]
provides [`PostgresKvStore`] class, which is a PostgreSQL-backed implementation
for production use.

Further details are explained in the [*Key–value store* section](./kv.md).

[`@fedify/redis`]: https://github.com/fedify-dev/fedify/tree/main/packages/redis
[`RedisKvStore`]: https://jsr.io/@fedify/redis/doc/kv/~/RedisKvStore
[`@fedify/postgres`]: https://github.com/fedify-dev/fedify/tree/main/packages/postgres
[`PostgresKvStore`]: https://jsr.io/@fedify/postgres/doc/kv/~/PostgresKvStore

### `kvPrefixes`

The `~FederationOptions.kvPrefixes` property is an object that contains
the key prefixes for the cache data.  The following are the key prefixes
that the `Federation` object uses:

`~FederationKvPrefixes.activityIdempotence`
:   The key prefix used for storing whether activities have already been
    processed or not.  `["_fedify", "activityIdempotence"]` by default.

`~FederationKvPrefixes.remoteDocument`
:   The key prefix used for storing remote JSON-LD documents.
    `["_fedify", "remoteDocument"]` by default.

`~FederationKvPrefixes.publicKey`
:   *This API is available since Fedify 0.12.0.*

    The key prefix used for caching public keys.  `["_fedify", "publicKey"]`
    by default.

`~FederationKvPrefixes.httpMessageSignaturesSpec`
:   *This API is available since Fedify 1.6.0.*

    The key prefix used for caching HTTP Message Signatures spec.  The cached
    spec is used to reduce the number of attempts to make signed requests
    ([double-knocking] technique).
    `["_fedify", "httpMessageSignaturesSpec"]` by default.

[double-knocking]: https://swicg.github.io/activitypub-http-signature/#how-to-upgrade-supported-versions

### `queue`

*This API is available since Fedify 0.5.0.*

The `~FederationOptions.queue` property is a `MessageQueue` instance that
the `Federation` object uses to maintain the queue of incoming and outgoing
activities.  If you don't provide this option, activities will not be queued
and will be processed immediately.

`MessageQueue` is an abstract interface that represents a message queue.
For now, Fedify provides two built-in implementations of `MessageQueue`, which
are `InProcessMessageQueue` and `DenoKvMessageQueue` classes.
The `InProcessMessageQueue` class is for testing and development purposes,
and the `DenoKvMessageQueue` class is a Deno KV-backed implementation for
production use (as you can guess from the name, it is only available in Deno
runtime).

As separate packages, [`@fedify/redis`] provides [`RedisMessageQueue`] class,
which is a Redis-backed implementation for production use,
and [`@fedify/postgres`] provides [`PostgresMessageQueue`] class, which is a
PostgreSQL-backed implementation for production use, and [`@fedify/amqp`]
provides [`AmqpMessageQueue`] class, which is an AMQP broker-backed
implementation for production use.

Further details are explained in the [*Message queue* section](./mq.md).

> [!IMPORTANT]
> While the `queue` option is optional, it is highly recommended to provide
> a message queue implementation in production environments.  If you don't
> provide a message queue implementation, activities will not be queued and
> will be sent immediately.  This can make delivery of activities unreliable
> and can cause performance issues.

> [!TIP]
> Since Fedify 1.3.0, you can separately configure the message queue for
> incoming and outgoing activities by providing an object with `inbox` and
> `outbox` properties:
>
> ~~~~ typescript twoslash
> import {
>   createFederation,
>   type KvStore,
>   MemoryKvStore,
>   type MessageQueue,
> } from "@fedify/fedify";
> import { PostgresMessageQueue } from "@fedify/postgres";
> import { RedisMessageQueue } from "@fedify/redis";
> import postgres from "postgres";
> import Redis from "ioredis";
>
> createFederation<void>({
> kv: null as unknown as KvStore,
> // ---cut-before---
> queue: {
>   inbox: new PostgresMessageQueue(
>     postgres("postgresql://user:pass@localhost/db")
>   ),
>   outbox: new RedisMessageQueue(() => new Redis()),
> }
> // ---cut-after---
> });
> ~~~~
>
> Or, you can provide a message queue for only the `inbox` or `outbox` by
> omitting the other:
>
> ~~~~ typescript twoslash
> import {
>   createFederation,
>   type KvStore,
>   MemoryKvStore,
>   type MessageQueue,
> } from "@fedify/fedify";
> import { PostgresMessageQueue } from "@fedify/postgres";
> import postgres from "postgres";
>
> createFederation<void>({
> kv: null as unknown as KvStore,
> // ---cut-before---
> queue: {
>   inbox: new PostgresMessageQueue(
>     postgres("postgresql://user:pass@localhost/db")
>   ),
>   // outbox is not provided; outgoing activities will not be queued.
> }
> // ---cut-after---
> });
> ~~~~

[`RedisMessageQueue`]: https://jsr.io/@fedify/redis/doc/mq/~/RedisMessageQueue
[`PostgresMessageQueue`]: https://jsr.io/@fedify/postgres/doc/mq/~/PostgresMessageQueue
[`@fedify/amqp`]: https://github.com/fedify-dev/fedify/tree/main/packages/amqp
[`AmqpMessageQueue`]: https://jsr.io/@fedify/amqp/doc/mq/~/AmqpMessageQueue

### `manuallyStartQueue`

*This API is available since Fedify 0.12.0.*

Whether to start the task queue manually or automatically.

If `true`, the task queue will not start automatically and you need to
manually start it by calling the `Federation.startQueue()` method.

If `false`, the task queue will start automatically as soon as the first
task is enqueued.

By default, the queue starts automatically.

> [!TIP]
> This option is useful when you want to separately deploy the web server
> and the task queue worker.  In this case, you can start the task queue
> in the worker process, and the web server process doesn't start the task
> queue, but only enqueues tasks.  Of course, in this case, you need to
> provide a `MessageQueue` backend that can be shared between the web server
> and the worker process (e.g., a Redis-backed message queue) as
> the [`queue`](#queue) option.

### `documentLoaderFactory`

*This API is available since Fedify 1.4.0.*

A factory function that creates a JSON-LD `DocumentLoader` that the `Federation`
object uses to load remote JSON-LD documents.  The factory function takes
a `DocumentLoaderFactoryOptions` object and returns a `DocumentLoader`
function.

Usually, you don't need to set this property because the default document
loader is sufficient for most cases.  The default document loader
caches the loaded documents in the key–value store.

See the
[*Getting a `DocumentLoader`* section](./context.md#getting-a-documentloader)
for details.

### `authenticatedDocumentLoaderFactory`

*This API is available since Fedify 0.4.0.*

A factory function that creates an authenticated document loader function.
The factory function takes the key pair of an actor and returns a document
loader function that loads remote JSON-LD documents as the actor.

Usually, you don't need to set this property because the default document
loader factory is sufficient for most cases.  The default document loader
factory intentionally doesn't cache the loaded documents in the key–value
store.

See the [*Getting an authenticated `DocumentLoader`*
section](./context.md#getting-an-authenticated-documentloader) for details.

### `contextLoaderFactory`

*This API is available since Fedify 1.4.0.*

A factory function to get a JSON-LD context loader that the `Federation`
object uses to load remote JSON-LD contexts.  The type of the factory is
the same as the `documentLoaderFactory`, but their purposes are different
(see also [*Document loader vs. context loader*
section](./context.md#document-loader-vs-context-loader)).

### `allowPrivateAddress`

*This API is available since Fedify 0.15.0.*

> [!WARNING]
> Do not turn on this option in production environments.  Disallowing fetching
> private network addresses is a security feature to prevent [SSRF] attacks.

Whether to allow fetching private network addresses in the document loader.

Mostly useful for testing purposes.

Turned off by default.

[SSRF]: https://owasp.org/www-community/attacks/Server_Side_Request_Forgery

### `userAgent`

*This API is available since Fedify 1.3.0.*

The options for making `User-Agent` header in the HTTP requests that Fedify
makes.  By default, it contains the name and version of the Fedify library,
and the name and version of the JavaScript runtime, e.g.:

~~~~
Fedify/1.3.0 (Deno/2.0.4)
Fedify/1.3.0 (Node.js/v22.10.0)
Fedify/1.3.0 (Bun/1.1.33)
~~~~

You can customize the `User-Agent` header by providing options like `software`
and `url`.  For example, if you provide the following options:

~~~~ ts
{
  software: "MyApp/1.0.0",
  url: "https://myinstance.com/"
}
~~~~

The `User-Agent` header will be like:

~~~~
MyApp/1.0.0 (Fedify/1.3.0; Deno/2.0.4; +https://myinstance.com/)
~~~~

Or, you can rather provide a custom `User-Agent` string directly instead of
an object for options.

> [!CAUTION]
>
> This settings do not affect the `User-Agent` header of the HTTP requests
> that `lookupWebFinger()`, `lookupObject()`, and `getNodeInfo()` functions
> make, since they do not depend on the `Federation` object.
>
> However, `Context.lookupObject()` method is affected by this settings.

### `firstKnock`

*This API is available since Fedify 1.7.0.*

The HTTP Signatures specification to use for the first signature attempt
when communicating with unknown servers. This option affects the
[double-knocking] mechanism.

When making HTTP requests to servers that haven't been encountered before,
Fedify will first attempt to sign the request using the specified
signature specification. If the request fails, it will retry with the
alternative specification.

Available options are:

`"draft-cavage-http-signatures-12"`
:   [HTTP Signatures], which is obsolete but still widely adopted in
    the fediverse as of May 2025.

`"rfc9421"` (default)
:   [RFC 9421]: HTTP Message Signatures, which is the final revision of
    the specification and is recommended, but not yet widely adopted
    in the fediverse as of May 2025.

Defaults to `"rfc9421"`.

[HTTP Signatures]: https://datatracker.ietf.org/doc/html/draft-cavage-http-signatures-12
[RFC 9421]: https://www.rfc-editor.org/rfc/rfc9421

### `permanentFailureStatusCodes`

*This API is available since Fedify 2.0.0.*

HTTP status codes that should be treated as permanent delivery failures.
When an inbox returns one of these codes, the delivery will not be retried
and the permanent failure handler (if registered via
`~Federatable.setOutboxPermanentFailureHandler()`) will be called.

By default, `[404, 410]`.

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation, InProcessMessageQueue } from "@fedify/fedify";

const federation = createFederation({
  // Omitted for brevity; see the related section for details.
  queue: new InProcessMessageQueue(),
  permanentFailureStatusCodes: [404, 410, 451],
});
~~~~

See also the
[*Permanent delivery failure handling*](./send.md#permanent-delivery-failure-handling)
section in the *Sending activities* page for how to register a handler for
permanent delivery failures.

### `outboxRetryPolicy`

*This API is available since Fedify 0.12.0.*

The retry policy for sending activities to recipients' inboxes.

By default, this uses an exponential backoff strategy with a maximum of 10
attempts and a maximum delay of 12 hours.

You can fully customize the retry policy by providing a custom function that
satisfies the `RetryPolicy` type.  Or you can adjust the parameters of
the `createExponentialBackoffRetryPolicy()` function, which is a default
implementation of the retry policy.

> [!NOTE]
> This policy is ignored when using message queue backends that provide native
> retry mechanisms (`MessageQueue.nativeRetrial` is `true`).  In such cases,
> the backend's native retry logic takes precedence.

### `inboxRetryPolicy`

*This API is available since Fedify 0.12.0.*

The retry policy for processing incoming activities.

By default, this uses an exponential backoff strategy with a maximum of 10
attempts and a maximum delay of 12 hours.

In the same way as the `outboxRetryPolicy` option, you can fully customize
the retry policy by providing a custom function that satisfies the `RetryPolicy`
type.  Or you can adjust the parameters of the built-in
`createExponentialBackoffRetryPolicy()` function.

> [!NOTE]
> This policy is ignored when using message queue backends that provide native
> retry mechanisms (`MessageQueue.nativeRetrial` is `true`).  In such cases,
> the backend's native retry logic takes precedence.

### `activityTransformers`

*This API is available since Fedify 1.4.0.*

Activity transformers are a way to adjust activities before sending them to
the recipients.  It is useful for modifying the activity to fit the recipient's
ActivityPub implementation (which may have some quirks) or for adding some
additional information to the activity.

See the [*Activity transformers* section](./send.md#activity-transformers)
for details.

### `trailingSlashInsensitive`

*This API is available since Fedify 0.12.0.*

Whether the router should be insensitive to trailing slashes in the URL paths.
For example, if this option is `true`, `/foo` and `/foo/` are treated as the
same path.

Turned off by default.

### `tracerProvider`

*This API is available since Fedify 1.3.0.*

The OpenTelemetry tracer provider that the `Federation` object uses to
instrument various parts of Fedify for tracing.  If omitted, it is configured
to use the default tracer provider (i.e., [`trace.getTracerProvider()`]).

For more information, see the [*OpenTelemetry* section](./opentelemetry.md).

[`trace.getTracerProvider()`]: https://open-telemetry.github.io/opentelemetry-js/classes/_opentelemetry_api._opentelemetry_api.TraceAPI.html#gettracerprovider


Builder pattern for structuring
-------------------------------

*This API is available since Fedify 1.6.0.*

If your federated application is large enough, you may want to defer the
instantiation of the `Federation` object until all your dispatchers and
listeners are set up.  This is useful for structuring your code and
avoiding circular dependencies.  Here's a brief instruction on how to
do that:

1.  Instead of instantiating a `Federation` object using `createFederation()`
    function, create a `FederationBuilder` object using
    `createFederationBuilder()` function.
2.  Register your dispatchers and listeners to the `FederationBuilder`
    object as you would do with a regular `Federation` object.
3.  Call the `FederationBuilder.build()` method to create a `Federation`
    object.  This method takes the same options as `createFederation()`
    function, and it returns a `Federation` object.

It looks like this:

~~~~ typescript [federation.ts]
import { createFederationBuilder } from "@fedify/fedify";

export const builder = createFederationBuilder<void>();

// Register your dispatchers and listeners here...
builder.setActorDispatcher(
  "/users/{handle}",
  async (ctx, handle) => {
    // Omitted for brevity
  }
);
// ...
~~~~

~~~~ typescript [main.ts]
import { builder } from "./federation.ts";

// Build the `Federation` object
export const federation = await builder.build({
  kv: new MemoryKvStore(),
  // Omitted for brevity; see the following sections for details.
});
~~~~

If you want to access the `Federation` object inside dispatchers or listeners
before the `FederationBuilder` instantiates it, you can use
the `Context.federation` property.  The `Context.federation` property refers
to the `Federation` object that is to be instantiated by the `FederationBuilder`
and is available in the `Context` object passed to the dispatchers and
listeners.  For example, you can access the `Federation` object like this:

~~~~ typescript twoslash
import { type FederationBuilder } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const builder = null as unknown as FederationBuilder<void>;
// ---cut-before---
builder.setActorDispatcher(
  "/users/{handle}",
  async (ctx, handle) => {
    const federation = ctx.federation; // Access the `Federation` object
    // Omitted for brevity
// ---cut-start---
    return new Person({});
// ---cut-end---
  }
);
~~~~


The `~Federation.fetch()` API
-----------------------------

*This API is available since Fedify 0.6.0.*

The `Federation` object provides the `~Federation.fetch()` method to handle
incoming HTTP requests.  The `~Federation.fetch()` method takes an incoming
[`Request`] and returns a [`Response`].

Actually, this interface is de facto standard in the server-side JavaScript
world, and it is inspired by the [`window.fetch()`] method in the browser
environment.

Therefore, you can pass it to the [`Deno.serve()`] function in [Deno], and
the [`Bun.serve()`] function in [Bun]:

::: code-group

~~~~ typescript twoslash [Deno]
import { type Federation } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
const request = new Request("");
// ---cut-before---
Deno.serve(
  (request) => federation.fetch(request, { contextData: undefined })
);
~~~~

~~~~ typescript twoslash [Bun]
import "@types/bun";
import { type Federation } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
const request = new Request("");
// ---cut-before---
Bun.serve({
  fetch: (request) => federation.fetch(request, { contextData: undefined }),
})
~~~~

:::

However, in case of [Node.js], it has no built-in server API that takes
`fetch()` callback function like Deno or Bun.  Instead, you need to use
[@hono/node-server] package to adapt the `~Federation.fetch()` method to
the Node.js' HTTP server API:

::: code-group

~~~~ sh [Node.js]
npm add @hono/node-server
~~~~

:::

And then, you can use the [`serve()`] function from the package:

::: code-group

~~~~ typescript twoslash [Node.js]
import { type Federation } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
const request = new Request("");
// ---cut-before---
import { serve } from "@hono/node-server";

serve({
  fetch: (request) => federation.fetch(request, { contextData: undefined }),
})
~~~~

:::

> [!NOTE]
>
> Although a `Federation` object can be directly passed to the HTTP server
> APIs, you would usually integrate it with a web framework.  For details,
> see the [*Integration* section](./integration.md).

[`Request`]: https://developer.mozilla.org/en-US/docs/Web/API/Request
[`Response`]: https://developer.mozilla.org/en-US/docs/Web/API/Response
[`window.fetch()`]: https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch
[`Deno.serve()`]: https://docs.deno.com/api/deno/~/Deno.serve
[Deno]: http://deno.com/
[`Bun.serve()`]: https://bun.sh/docs/api/http#bun-serve
[Bun]: https://bun.sh/
[Node.js]: https://nodejs.org/
[@hono/node-server]: https://github.com/honojs/node-server
[`serve()`]: https://github.com/honojs/node-server?tab=readme-ov-file#usage


How the `Federation` object recognizes the domain name
------------------------------------------------------

By default, the `Federation` object recognizes the domain name of the server by
the [`Host`] header of the incoming HTTP requests.  The `Host` header is
a standard HTTP header that contains the domain name of the server.

However, the `Host` header is not always reliable because it can be
bypassed by a reverse proxy or a load balancer.  If you use a reverse
proxy or a load balancer, you should configure it to pass the original
`Host` header to the server.

Or you can make the `Federation` object recognize the domain name by looking
at the [`X-Forwarded-Host`] header instead of the `Host` header using
the [x-forwarded-fetch] middleware.  To use the `x-forwarded-fetch` middleware,
install the package:

::: code-group

~~~~ sh [Deno]
deno add jsr:@hongminhee/x-forwarded-fetch
~~~~

~~~~ sh [Node.js]
npm install x-forwarded-fetch
~~~~

~~~~ sh [Bun]
bun add x-forwarded-fetch
~~~~

:::

Then, import the package and place the `behindProxy()` middleware in front of
the `Federation.fetch()` method:

::: code-group

~~~~ typescript{1,4} twoslash [Deno]
// @noErrors: 2300 2307
import { behindProxy } from "x-forwarded-fetch";
import { type Federation } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
// ---cut-before---
import { behindProxy } from "@hongminhee/x-forwarded-fetch";

Deno.serve(
  behindProxy(request => federation.fetch(request, { contextData: undefined }))
);
~~~~

~~~~ typescript{2,5} twoslash [Node.js]
import { type Federation } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
// ---cut-before---
import { serve } from "@hono/node-server";
import { behindProxy } from "x-forwarded-fetch";

serve({
  fetch: behindProxy((request) => federation.fetch(request, { contextData: undefined })),
});
~~~~

~~~~ typescript{1,4} twoslash [Bun]
import "@types/bun";
import { type Federation } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
// ---cut-before---
import { behindProxy } from "x-forwarded-fetch";

Bun.serve({
  fetch: behindProxy((request) => federation.fetch(request, { contextData: undefined })),
});
~~~~

:::

> [!TIP]
> When your `Federation` object is integrated with a web framework, you should
> place the `behindProxy()` middleware in front of the framework's `fetch()`
> method, not the `Federation.fetch()` method.

[`Host`]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Host
[`X-Forwarded-Host`]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-Host
[x-forwarded-fetch]: https://github.com/dahlia/x-forwarded-fetch


Explicitly setting the canonical origin
---------------------------------------

*This API is available since Fedify 1.5.0.*

Or you can explicitly set the canonical origin of the server by passing
the `~FederationOptions.origin` option to the `createFederation()`
function.  The `~FederationOptions.origin` option is either a string or
a `FederationOrigin` object, which consists of two fields:
`~FederationOrigin.handleHost` and `~FederationOrigin.webOrigin`.

For example, if you want to set the canonical origin to `https://example.com`,
you can pass the string:

~~~~ typescript twoslash
import { createFederation, type KvStore } from "@fedify/fedify";
// ---cut-before---
const federation = createFederation({
// ---cut-start---
  kv: null as unknown as KvStore,
// ---cut-end---
  origin: "https://example.com",
});
~~~~

> [!NOTE]
> The `~FederationOptions.origin` option has to include the leading
> `https://` or `http://` scheme.

Such a configuration leads the [constructed URLs using
`Context`](./context.md#building-the-object-uris) to use the canonical origin
instead of the origin from the incoming HTTP requests, which avoids constructing
unexpected URLs when a request bypasses a reverse proxy or a load balancer.

> [!CAUTION]
> For example, suppose that your federated server (upstream) is accessible at
> the `http://1.2.3.4:8000` and your load balancer (downstream) is accessible at
> the `https://example.com` and forwards the requests to the upstream server.
> In this case, you should set the canonical origin to `https://example.com` to
> construct the correct URLs.  Otherwise, when some malicious actor directly
> sends a request to the upstream server, the constructed URLs will start with
> `http://1.2.3.4:8000` instead of `https://example.com`, which can lead to
> security issues.

> [!TIP]
> If your federated server needs to support [multiple domains on the same
> server](#virtual-hosting), you would not want to set the canonical origin
> explicitly.  Instead, you should rely on the [`Host`] header or
> [`X-Forwarded-Host`] header to determine the domain name.


Separating WebFinger host from the server origin
------------------------------------------------

*This API is available since Fedify 1.5.0.*

Sometimes you may want to use different domain names for WebFinger handles
(i.e., fediverse handles) and the server origin.  For example, you may want
to use `https://ap.example.com/actors/alice` as an actor URI but want to use
`@alice@example.com` as its fediverse handle.

In such cases, you can set the `~FederationOrigin.handleHost` different from
the `~FederationOrigin.webOrigin` in the `~FederationOptions.origin`
option.  The `~FederationOrigin.handleHost` is used to construct the WebFinger
handles, and the `~FederationOrigin.webOrigin` is used to [construct the URLs
in the `Context` object](./context.md#building-the-object-uris):

~~~~ typescript twoslash
import { createFederation, type KvStore } from "@fedify/fedify";
// ---cut-before---
const federation = createFederation({
// ---cut-start---
  kv: null as unknown as KvStore,
// ---cut-end---
  origin: {
    handleHost: "example.com",
    webOrigin: "https://ap.example.com",
  },
});
~~~~

That is not all.  You also need to make the */.well-known/webfinger* endpoint
of the `~FederationOrigin.handleHost` to redirect to the
*/.well-known/webfinger* endpoint of the `~FederationOrigin.webOrigin` unless
you want to connect the `~FederationOrigin.handleHost` to the same server as
the `~FederationOrigin.webOrigin`.  For example, if your
`~FederationOrigin.handleHost` is served by [Caddy], you can use the following
configuration to redirect the WebFinger requests:

~~~~ caddy
example.com {
  redir /.well-known/webfinger https://ap.example.com/.well-known/webfinger
}
~~~~

Or if you use [nginx], you can use the following configuration:

~~~~ nginx
server {
  server_name example.com;
  location /.well-known/webfinger {
    return 301 https://ap.example.com$request_uri;
  }
}
~~~~

> [!NOTE]
> Even if you set the `~FederationOrigin.handleHost` different from the
> `~FederationOrigin.webOrigin`, the other fediverse handle with the same
> domain name as the `~FederationOrigin.webOrigin` will still be recognized.
>
> In the above example, two fediverse handles are recognized as the same:
>
>  -  `@alice@example.com`
>  -  `@alice@ap.example.com`

[Caddy]: https://caddyserver.com/
[nginx]: https://nginx.org/


Integrating with web frameworks
-------------------------------

`Federation` is designed to be used together with web frameworks.  For details,
see the [*Integration* section](./integration.md).


`TContextData`
--------------

The `Federation` class is a generic class that takes a type parameter named
`TContextData`.  The `TContextData` type is the type of the context data,
which is shared among the actor dispatcher, inbox listener, and other
callback functions.  The `TContextData` type can be `void` if you don't
need to share any context data, but it can be any type if you need to share
context data.

For example, if you want to share a database connection among the actor
dispatcher, inbox listener, and other callback functions, you can set the
`TContextData` type to the type of the database connection:

~~~~ typescript
import { FreshContext } from "$fresh/server.ts";
import { federation } from "../federation.ts"; // Import the `Federation` object
import { DatabasePool, getPool } from "./database.ts";

export async function handler(request: Request, context: FreshContext) {
  return federation.fetch(request, {
    contextData: getPool(),  // [!code highlight]
    onNotFound: context.next.bind(context),
    onNotAcceptable: async (request: Request) => {
      // Omitted for brevity
    }
  });
};
~~~~

The `Context.data` is passed to registered callback functions as their first
parameter within the `Context` object:

~~~~ typescript twoslash
// @noErrors: 2345
import { type Federation } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
// ---cut-before---
federation.setActorDispatcher("/users/{handle}", async (ctx, handle) => {
  // There is a database connection in `ctx.data`.
});
~~~~

Another example is to determine the virtual host of the server based on the
incoming HTTP request.  See the [next section](#virtual-hosting) for details.


Virtual hosting
---------------

*This API is available since Fedify 0.12.0.*

> [!CAUTION]
> You should not [explicitly configure a canonical
> origin](#explicitly-setting-the-canonical-origin) when you want to support
> multiple domains on the same server.

You may want to support multiple domains on the same server, so-called
*virtual hosts*.  To determine the virtual host of the server based on the
incoming HTTP request, you can use `Context.host` that contains
the virtual host information:

~~~~ typescript{2} twoslash
// @noErrors: 2345
import { type Federation } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
// ---cut-before---
federation.setActorDispatcher("/@{handle}", (ctx, handle) => {
  const fullHandle = `${handle}@${ctx.host}`;
  // Omitted for brevity
});
~~~~

You can access the virtual host information in the actor dispatcher,
inbox listener, and other callback functions.

See also the [*Getting the base URL* section](./context.md#getting-the-base-url)
in the *Context* document.
