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
 -  [localhost.run]
 -  [Tailscale Funnel]

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

<!-- cSpell: ignore serveo tailscale -->

[^1]: According to the [*Object Identifiers* section][1] in the ActivityPub
      specification, the public dereferenceable URIs should use HTTPS URIs.

[ngrok]: https://ngrok.com/
[serveo]: https://serveo.net/
[localhost.run]: https://localhost.run/
[Tailscale Funnel]: https://tailscale.com/kb/1223/funnel
[x-forwarded-fetch]: https://github.com/dahlia/x-forwarded-fetch

[1]: https://www.w3.org/TR/activitypub/#obj-id


Inspecting ActivityPub objects
------------------------------

### BrowserPub

[BrowserPub] is a browser for debugging ActivityPub and the fediverse.  You can
punch in any ActivityPub discoverable web URL or fediverse handle, and it will
discover and display the underlying ActivityPub.

For example:

 -  [hollo.social/@fedify]
 -  [@hongminhee@fosstodon.org]

If you want to know further details about BrowserPub,
read the [creator's Mastodon thread].

[BrowserPub]: https://browser.pub/
[hollo.social/@fedify]: https://browser.pub/https://hollo.social/@fedify
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

~~~~ bash [Deno]
deno add @fedify/testing
~~~~

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
