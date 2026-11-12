---
description: >-
  Testing a federated server app is a bit tricky because it requires a
  federated environment.  This document explains how to easily test your
  federated server app with the help of several tools.
---

Testing
=======

Testing a federated server app is a bit tricky because it requires a federated
environment.  This document explains how to easily test your federated server
app with the help of several tools.


Exposing a local server to the public
-------------------------------------

To test your federated server app, you need to expose your local server to the
public internet with a domain name and TLS certificate.  There are several tools
that help you do that:

 -  [`fedify tunnel`](../cli.md#fedify-tunnel-exposing-a-local-http-server-to-the-public-internet)
 -  [ngrok]
 -  [serveo]
 -  [Tailscale Funnel]
 -  [OpenTunnel]

> [!NOTE]
> These tools are not for production use; they are for testing only.
> In production, you should expose your server with a proper domain and TLS
> certificate.

> [!TIP]
> These tools behave like a reverse proxy, so basically the federation server
> cannot recognize if it is behind a reverse proxy, and if the reverse proxy
> is in HTTPS.  So the federation server will generate HTTP URLs in the
> ActivityPub messages, which cause interoperability issues.[^1]  In this case,
> you can use the [x-forwarded-fetch] middleware in front of
> the `Federation.fetch()` method so that the `Federation` object recognizes
> the proper domain name and protocol of the incoming HTTP requests.
>
> For more information, see [*How the <code>Federation</code> object recognizes
> the domain name*
> section](./federation.md#how-the-federation-object-recognizes-the-domain-name)
> in the *Federation* document.

[^1]: According to the [*Object Identifiers* section][1] in the ActivityPub
      specification, the public dereferenceable URIs should use HTTPS URIs.

[ngrok]: https://ngrok.com/
[serveo]: https://serveo.net/
[Tailscale Funnel]: https://tailscale.com/kb/1223/funnel
[OpenTunnel]: https://github.com/anomalyco/opentunnel
[x-forwarded-fetch]: https://github.com/dahlia/x-forwarded-fetch

[1]: https://www.w3.org/TR/activitypub/#obj-id

### OpenTunnel

[OpenTunnel] works differently from the other tools above.  It gives your
machine a persistent hostname under *opentunnel.xyz* and terminates TLS
locally, so the relay server never sees your traffic in plaintext.  You can
install it with Homebrew, npm, or Cargo, or with its install script:

~~~~ bash
curl -fsSL https://opentunnel.xyz/install | sh
~~~~

Then route a local port to the public internet:

~~~~ bash
opentunnel route add 3000
~~~~

The command starts a background service and prints the public URL of the
route, such as `https://21992cc9713e5fc5.<id>.opentunnel.xyz`.  The URL stays
the same across restarts, and you can pass `--name` to pick a readable route
name instead of a random one.

Because the OpenTunnel client forwards the decrypted bytes to your server
unchanged, it does not add `X-Forwarded-Proto` or any other forwarding headers.
Your server sees a plain HTTP request whose `Host` header is the tunnel
hostname, so the [x-forwarded-fetch] middleware does not help here.  Instead,
set the [`~FederationOptions.origin`
option](./federation.md#explicitly-setting-the-canonical-origin) to the URL
that OpenTunnel printed:

~~~~ typescript twoslash
import { createFederation, type KvStore } from "@fedify/fedify";
// ---cut-before---
const federation = createFederation({
// ---cut-start---
  kv: null as unknown as KvStore,
// ---cut-end---
  origin: "https://21992cc9713e5fc5.<id>.opentunnel.xyz",
});
~~~~

> [!WARNING]
> A route name is not a secret, and anyone who knows the URL can reach your
> server.  Also, since every request reaches your server from the loopback
> address, do not treat requests as trusted just because they appear to come
> from *localhost*.

<!-- cSpell: ignore serveo tailscale opentunnel -->


Inspecting ActivityPub objects
------------------------------

### BrowserPub

[BrowserPub] is a browser for debugging ActivityPub and the fediverse.  You can
punch in any ActivityPub discoverable web URL or fediverse handle, and it will
discover and display the underlying ActivityPub.

For example:

 -  [hackers.pub/@fedify]
 -  [@hongminhee@fosstodon.org]

If you want to know further details about BrowserPub,
read the [creator's Mastodon thread].

[BrowserPub]: https://browser.pub/
[hackers.pub/@fedify]: https://browser.pub/https://hackers.pub/@fedify
[@hongminhee@fosstodon.org]: https://browser.pub/@hongminhee@fosstodon.org
[creator's Mastodon thread]: https://podcastindex.social/@js/113011966366461060

### `fedify lookup` command

Fedify provides a [CLI toolchain](../cli.md) for testing and debugging.
The
[`fedify lookup` command](../cli.md#fedify-lookup-looking-up-an-activitypub-object)
is a simple tool for looking up an ActivityPub object by its URL or fediverse
handle.


Inspecting ActivityPub activities
---------------------------------

### ActivityPub.Academy

[ActivityPub.Academy] is a special Mastodon instance that is designed for
debugging and testing ActivityPub peers.  You can create an account on it and
use it for testing your federated server app.  Its best feature is that it
provides a web interface for debugging ActivityPub messages.  Any sent and
received activities are displayed on the web interface in real-time.

> [!NOTE]
> Any accounts on ActivityPub.Academy are volatile; they are deleted after a
> certain period of inactivity.

[ActivityPub.Academy]: https://activitypub.academy/

### `fedify inbox` command

Fedify provides a [CLI toolchain](../cli.md) for testing and debugging.
The [`fedify inbox` command](../cli.md#fedify-inbox-ephemeral-inbox-server) is
a simple tool for spinning up an ephemeral inbox server that receives and
displays incoming ActivityPub messages.


Allowing fetching private network addresses
-------------------------------------------

*This API is available since Fedify 0.15.0.*

By default, Fedify disallows fetching private network addresses
(e.g., localhost) in order to prevent [SSRF] attacks.  However, in some cases,
you may want to allow fetching private network addresses for testing purposes
(e.g., end-to-end testing).  In this case, you can set
the [`allowPrivateAddress`](./federation.md#allowprivateaddress) option to
`true` in the `createFederation()` function:

~~~~ typescript twoslash
// @noErrors: 2345
import { createFederation } from "@fedify/fedify";
// ---cut-before---
const federation = createFederation({
  // ... other options
  allowPrivateAddress: true,
});
~~~~

> [!NOTE]
> By turning on the `allowPrivateAddress` option, you cannot configure other
> options related to document loaders including
> [`documentLoader`](./federation.md#documentloader),
> [`contextLoader`](./federation.md#contextloader), and
> [`authenticatedDocumentLoaderFactory`](./federation.md#authenticateddocumentloaderfactory)

> [!WARNING]
> Be careful when you allow fetching private network addresses.  It may cause
> security vulnerabilities such as [SSRF].  Make sure to turn off the option
> when you finish testing, or conditionally turn it on only in the testing
> environment.

[SSRF]: https://owasp.org/www-community/attacks/Server_Side_Request_Forgery


Mocking
-------

*This API is available since Fedify 1.8.0.*

When writing unit tests for your federated server application, you often need
to mock the federation layer to avoid making actual network requests and to
have predictable test behavior.  Fedify provides the `@fedify/testing` package
that includes mock implementations of the `Federation` and `Context` interfaces
specifically designed for testing purposes.

### Installation

You can install the `@fedify/testing` package using your preferred package
manager:

::: code-group

~~~~ bash [npm]
npm install @fedify/testing
~~~~

~~~~ bash [pnpm]
pnpm add @fedify/testing
~~~~

~~~~ bash [Yarn]
yarn add @fedify/testing
~~~~

~~~~ bash [Bun]
bun add @fedify/testing
~~~~

~~~~ bash [Deno]
deno add @fedify/testing
~~~~

:::

### `createFederation()`

*This API is available since Fedify 1.9.1.*

The `createFederation()` function creates a mock implementation of the
`Federation` interface that allows you to:

 -  Track sent activities without making network requests
 -  Simulate receiving activities and test inbox listeners
 -  Configure custom URI templates for testing
 -  Test queue-based activity processing

Here's a basic example of using `createFederation()`:

~~~~ typescript twoslash
import { createFederation } from "@fedify/testing";
import { Create, Note } from "@fedify/vocab";

// Create a mock federation with context data
const federation = createFederation<{ userId: string }>({
  contextData: { userId: "test-user" }
});

// Set up inbox listeners
federation
  .setInboxListeners("/users/{identifier}/inbox")
  .on(Create, async (ctx: any, activity: any) => {
    console.log("Received activity:", activity.id);
    // Your inbox logic here
  });

// Simulate receiving an activity
const activity = new Create({
  id: new URL("https://example.com/activities/1"),
  actor: new URL("https://example.com/users/alice"),
  object: new Note({
    id: new URL("https://example.com/notes/1"),
    content: "Hello, world!"
  })
});

await federation.receiveActivity(activity);

// Check sent activities
console.log("Sent activities:", federation.sentActivities);
~~~~

To load actors or other referenced objects from a local HTTP server, pass
`allowPrivateAddress: true`.  This enables HTTP document loading for received
activities and contexts created by the mock federation, including addresses
such as `localhost`:

~~~~ typescript twoslash
import { createFederation } from "@fedify/testing";
import { Follow, Undo } from "@fedify/vocab";

const federation = createFederation({
  contextData: {},
  allowPrivateAddress: true
});

federation
  .setInboxListeners("/users/{identifier}/inbox")
  .on(Follow, async (ctx, follow) => {
    const actor = await follow.getActor();
  })
  .on(Undo, async (ctx, undo) => {
    const object = await undo.getObject();
    if (object instanceof Follow) {
      const actor = await object.getActor(ctx);
    }
  });
~~~~

*The `allowPrivateAddress` option is available since Fedify 2.0.35.*

Received activities are cloned with the configured loaders.  Embedded objects
remain shared, so pass the listener context to their getters, as in
`object.getActor(ctx)` above.  If the option is `false` or omitted, contexts
keep their no-op mock loaders and received activities keep their own loaders.

### Creating mock contexts

You can create mock contexts using the `createContext()` method,
which provides a mock implementation of the `Context` interface that tracks
sent activities and provides mock implementations of URI generation methods:

~~~~ typescript twoslash
import { createFederation } from "@fedify/testing";
import { Create, Note, Person } from "@fedify/vocab";

// Create a mock federation and context
const federation = createFederation<{ userId: string }>();
const context = federation.createContext(
  new URL("https://example.com"),
  { userId: "test-user" }
);

// Send an activity
const activity = new Create({
  id: new URL("https://example.com/activities/1"),
  actor: new URL("https://example.com/users/alice"),
  object: new Note({
    id: new URL("https://example.com/notes/1"),
    content: "Hello from MockContext!"
  })
});

await context.sendActivity(
  { identifier: "alice" },
  new Person({ id: new URL("https://example.com/users/bob") }),
  activity
);

// Check sent activities
const sentActivities = context.getSentActivities();
console.log("Context sent activities:", sentActivities);

// Also available in federation
console.log("Federation sent activities:", federation.sentActivities);
~~~~

For portable-object tests, pass a fixture `documentLoader` and
`verifyPortableObject` to `createFederation()`.  Pass a `contextLoader` as well
when the fixture loader does not serve JSON-LD contexts.  Mock context lookups
use these options for portable IDs; without a document loader, they return
`null` as before.  A request context can receive an explicit
`portableRequest` through the third argument of `federation.createContext()`
when the first argument is a `Request`.  Dispatchers can then inspect it, as
they do for a routed gateway request.  The mock does not infer it from the URL.

If you want to test an outbox listener directly, you can also create an
`OutboxContext` with the `createOutboxContext()` helper:

~~~~ typescript twoslash
import { createFederation, createOutboxContext } from "@fedify/testing";

const federation = createFederation<{ userId: string }>();
const context = createOutboxContext({
  federation,
  data: { userId: "test-user" },
  identifier: "alice",
});

console.log(context.identifier);  // alice
~~~~

If you prefer to exercise registered outbox listeners through the mock
federation, use `postOutboxActivity()`:

~~~~ typescript twoslash
import { createFederation } from "@fedify/testing";
import { Create, Person } from "@fedify/vocab";

const federation = createFederation<{ userId: string }>({
  contextData: { userId: "test-user" },
});

let receivedActivityId = "";

federation.setActorDispatcher("/users/{identifier}", (_ctx, identifier) => {
  return new Person({
    id: new URL(`https://example.com/users/${identifier}`),
  });
});

federation
  .setOutboxListeners("/users/{identifier}/outbox")
  .on(Create, async (ctx, activity) => {
    receivedActivityId = activity.id?.href ?? "";
    await ctx.sendActivity(
      { identifier: ctx.identifier },
      new Person({
        id: new URL("https://example.com/users/bob"),
        inbox: new URL("https://example.com/users/bob/inbox"),
      }),
      activity,
    );
  });

const activity = new Create({
  id: new URL("https://example.com/activities/1"),
  actor: new URL("https://example.com/users/alice"),
});

await federation.postOutboxActivity("alice", activity);

console.log(receivedActivityId);  // https://example.com/activities/1
~~~~

### Testing URI generation

Mock contexts created with the `createContext()` method provide mock
implementations of all URI generation methods that work with the paths
configured in your test federation:

~~~~ typescript twoslash
import { createFederation } from "@fedify/testing";
import { Note } from "@fedify/vocab";

const federation = createFederation();

// Configure paths (similar to real federation setup)
federation.setActorDispatcher("/users/{identifier}", () => null);
federation.setInboxListeners("/users/{identifier}/inbox", "/shared-inbox");
federation.setOutboxDispatcher("/users/{identifier}/outbox", () => null);
federation.setObjectDispatcher(Note, "/notes/{id}", () => null);

const context = federation.createContext(
  new URL("https://example.com"),
  undefined
);

// Test URI generation
console.log(context.getActorUri("alice"));     // https://example.com/users/alice
console.log(context.getInboxUri("alice"));     // https://example.com/users/alice/inbox
console.log(context.getOutboxUri("alice"));    // https://example.com/users/alice/outbox
console.log(context.getObjectUri(Note, { id: "123" })); // https://example.com/notes/123
~~~~

### Tracking sent activities

Both the test federation and mock contexts track sent activities with detailed
metadata:

~~~~ typescript twoslash
// @noErrors: 2554
import { createFederation } from "@fedify/testing";

const federation = createFederation();
const context = federation.createContext(
  new URL("https://example.com/"),
  undefined
);

// Send some activities...
await context.sendActivity(/* ... */);

// Check federation-level tracking
for (const sent of federation.sentActivities) {
  console.log("Activity:", sent.activity.id);
  console.log("Queued:", sent.queued);
  console.log("Queue type:", sent.queue);
  console.log("Send order:", sent.sentOrder);
}

// Check context-level tracking
for (const sent of context.getSentActivities()) {
  console.log("Sender:", sent.sender);
  console.log("Recipients:", sent.recipients);
  console.log("Activity:", sent.activity);
}
~~~~

### Simulating queue processing

You can test queue-based activity processing by starting the mock queue:

~~~~ typescript twoslash
// @noErrors: 2554
import { createFederation } from "@fedify/testing";

const federation = createFederation();

// Start the queue to simulate background processing
await federation.startQueue({ contextData: { userId: "test" } });

// Now sent activities will be marked as queued
const context = federation.createContext(
  new URL("https://example.com/"),
  { userId: "test" }
);
await context.sendActivity(/* ... */);

// Check if activities were queued
const queued = federation.sentActivities.filter(a => a.queued);
console.log("Queued activities:", queued.length);
~~~~

### Resetting mock state

Both the test federation and mock contexts provide `reset()` methods to clear
tracked activities:

~~~~ typescript twoslash
import { createFederation } from "@fedify/testing";
const federation = createFederation();
const context = federation.createContext(
  new URL("https://example.com/"),
  undefined
);
// ---cut-before---
// Clear all sent activities
federation.reset();
context.reset();

console.log(federation.sentActivities.length); // 0
console.log(context.getSentActivities().length); // 0
~~~~

The mocking utilities make it easy to write comprehensive unit tests for your
federated server application without requiring a full federation setup or
making actual network requests.


Atomic key–value store conformance
----------------------------------

*This API is available since Fedify 2.5.0.*

Use `testAtomicKvStore()` to check an `AtomicKvStore` implementation.  It
covers ordered snapshot reads, all-or-nothing batches, conditional updates and
deletions, competing clients, logical expiry, and validation.  Run
`testKvStore()` separately for ordinary key–value behavior and prefix listing.

Each case calls the factory for a fresh pair of clients sharing isolated
backing state.  Persistent adapters need independent handles connected to the
same backend.  `MemoryKvStore` may return the same instance for both clients:

~~~~ typescript twoslash
import { MemoryKvStore } from "@fedify/fedify";
import { testAtomicKvStore } from "@fedify/testing";
import { test } from "node:test";

test("Memory atomic contract", () => testAtomicKvStore(() => {
  const store = new MemoryKvStore();
  return {
    first: store,
    second: store,
    dispose() {},
  };
}, { objectKeyOrder: "ignored" }));
~~~~

For persistent adapters, `dispose()` must close both clients and remove the
isolated backing state.  If factory construction fails before returning a
pair, the factory must clean up any resources it already acquired.  The helper
waits for all started concurrent operations before disposal.  If an assertion
and disposal both fail, it retains both errors in an `AggregateError`.

The checks that are expected to succeed use batches of up to three keys or
entries. Configure a supported atomic scope large enough for those calls.  The
`key` option can place generated keys in that scope, for example a common Redis
Cluster hash tag.  The mapping must preserve distinct keys and structural key
equality; it need not preserve prefixes.  Keys receive a fresh random prefix
before mapping.

`objectKeyOrder: "ignored"` checks that reordered object members compare equal
in single-key and batch compare-and-swap (CAS) operations.  Use `"significant"`
for a codec that compares encoded JSON bytes.  Omit the option when the adapter
makes neither promise; nested JSON round trips and type/array distinctions are
still checked.

TTL defaults are 500 ms for the short lifetime and 1 s for the expiry wait.
Override both (`ttl.short` and `ttl.wait`) with positive durations when a
backend rounds expiry or needs more time for network operations.  The wait must
exceed the TTL after the backend's rounding, plus the expected latency.  Zero
and negative TTL policies are adapter-specific and need separate adapter tests.

### Limit and scope rejection probes

Provide `rejections()` to test documented backend limits or unsupported atomic
key scopes.  The `rejections()` callback receives a key factory that already
applies the configured mapper.  Returned keys are used verbatim.  Every key
must be valid for individual store calls. The helper seeds each mutation key,
then verifies that rejection leaves it unchanged through individual reads.  It
seeds CAS keys with the supplied expectations, including absence for expected
`undefined`.  Supply distinct mutation keys, supported values and TTLs, and
changes that would be observable if incorrectly committed.  Do not supply no-op
deletion probes on absent keys or CAS entries whose new value equals their
expectation.

For example, build probes from the adapter's documented maximum batch count,
rather than assuming a universal limit.  This configuration example imports
`Temporal` from `temporal-polyfill`; install that package as a direct
development dependency when using the example in a runtime without native
Temporal:

~~~~ typescript twoslash
import type { TestAtomicKvStoreOptions } from "@fedify/testing";
import { Temporal } from "temporal-polyfill";

function optionsForBatchLimit(maxEntries: number): TestAtomicKvStoreOptions {
  return {
    ttl: {
      short: Temporal.Duration.from({ seconds: 1 }),
      wait: Temporal.Duration.from({ seconds: 2 }),
    },
    key: (key) => ["{fedify-atomic-test}", ...key],
    rejections: (makeKey) => {
      const keys = Array.from(
        { length: maxEntries + 1 },
        (_, index) => makeKey("over-limit", String(index)),
      );
      return {
        getMany: keys,
        setMany: keys.map((key, index) => ({ key, value: index })),
        deleteMany: keys,
        casMany: keys.map((key, index) => ({
          key,
          expectedValue: index,
          newValue: index + 1,
        })),
      };
    },
  };
}
~~~~

This example assumes the documented count applies to all four operations.
When the limits differ, provide only the relevant operation probes or build
each from its own limit.  For a scope probe, the callback can deliberately
return individually valid keys outside the shared atomic scope.

The concurrency checks repeat several races in both snapshot invocation
orders; they are not an exhaustive proof of linearizability.  Add
backend-specific tests for competing handles, absent and expired entries,
rollback when a later write in the same batch fails, injected failures,
supported isolation levels, and reopen persistence.  Method presence and
passing these shared checks do not establish crash durability.
