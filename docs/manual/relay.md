---
description: >-
  Fedify provides a ready-to-use relay server implementation for building
  ActivityPub relay infrastructure.
---

Relay
=====

*This API is available since Fedify 2.0.0.*

Fedify provides the *@fedify/relay* package for building [ActivityPub relay
servers]—services that forward activities between instances without requiring
individual actor-following relationships.

[ActivityPub relay servers]: https://fediverse.party/en/miscellaneous/#relays


Setting up a relay server
-------------------------

First, install the *@fedify/relay* package.

::: code-group

~~~~ sh [Deno]
deno add @fedify/relay
~~~~

~~~~ sh [npm]
npm add @fedify/relay @hono/node-server
~~~~

~~~~ sh [pnpm]
pnpm add @fedify/relay @hono/node-server
~~~~

~~~~ sh [Yarn]
yarn add @fedify/relay @hono/node-server
~~~~

~~~~ sh [Bun]
bun add @fedify/relay
~~~~

:::

Then create a relay using the `createRelay()` function.

::: code-group

~~~~ typescript twoslash [Deno]
import { createRelay } from "@fedify/relay";
import { MemoryKvStore } from "@fedify/fedify";

const relay = createRelay("mastodon", {
  kv: new MemoryKvStore(),
  domain: "relay.example.com",
  name: "My ActivityPub Relay",
  subscriptionHandler: async (ctx, actor) => {
    // Approve all subscriptions
    return true;
  },
});

Deno.serve((request) => relay.fetch(request));
~~~~

~~~~ typescript twoslash [Bun]
import "@types/bun";
// ---cut-before---
import { createRelay } from "@fedify/relay";
import { MemoryKvStore } from "@fedify/fedify";

const relay = createRelay("mastodon", {
  kv: new MemoryKvStore(),
  domain: "relay.example.com",
  name: "My ActivityPub Relay",
  subscriptionHandler: async (ctx, actor) => {
    // Approve all subscriptions
    return true;
  },
});

Bun.serve({
  port: 8000,
  fetch(request) {
    return relay.fetch(request);
  },
});
~~~~

~~~~ typescript twoslash [Node.js]
import { createRelay } from "@fedify/relay";
import { MemoryKvStore } from "@fedify/fedify";
import { serve } from "@hono/node-server";

const relay = createRelay("mastodon", {
  kv: new MemoryKvStore(),
  domain: "relay.example.com",
  name: "My ActivityPub Relay",
  subscriptionHandler: async (ctx, actor) => {
    // Approve all subscriptions
    return true;
  },
});

serve({
  port: 8000,
  fetch(request) {
    return relay.fetch(request);
  },
});
~~~~

:::

> [!WARNING]
> `MemoryKvStore` is for development only. For production, use a persistent
> store like `RedisKvStore` from *@fedify/redis*, `PostgresKvStore` from
> *@fedify/postgres*, or `DenoKvStore` from *@fedify/denokv*.
>
> See the [*Key–value store* section](./kv.md) for details.


Configuration options
---------------------

`kv` (required)
:   A [`KvStore`](./kv.md) for storing subscriber information and cryptographic
    keys.

`domain`
:   The domain name where the relay is hosted. Defaults to `"localhost"`.

`name`
:   Display name for the relay actor. Defaults to `"ActivityPub Relay"`.

`queue`
:   A [`MessageQueue`](./mq.md) for background activity processing.  Recommended
    for production:

    ~~~~ typescript twoslash
    import { createRelay } from "@fedify/relay";
    import { MemoryKvStore, InProcessMessageQueue } from "@fedify/fedify";
    // ---cut-before---
    const relay = createRelay("mastodon", {
      kv: new MemoryKvStore(),
      domain: "relay.example.com",
      queue: new InProcessMessageQueue(),
      subscriptionHandler: async (ctx, actor) => true,
    });
    ~~~~

    > [!NOTE]
    > For production, use [`RedisMessageQueue`] or [`PostgresMessageQueue`].

[`RedisMessageQueue`]: https://jsr.io/@fedify/redis/doc/mq/~/RedisMessageQueue
[`PostgresMessageQueue`]: https://jsr.io/@fedify/postgres/doc/mq/~/PostgresMessageQueue

`subscriptionHandler` (required)
:   Callback to approve or reject subscription requests. See
    [*Handling subscriptions*](#handling-subscriptions). To create an open relay
    that accepts all subscriptions:

    ~~~~ typescript
    subscriptionHandler: async (ctx, actor) => true
    ~~~~

`documentLoaderFactory`
:   A factory function for creating a document loader to fetch remote
    ActivityPub objects. See [*Getting a `Federation`
    object*](./federation.md#documentloaderfactory).

`authenticatedDocumentLoaderFactory`
:   A factory function for creating an authenticated document loader.
    See [`authenticatedDocumentLoaderFactory`](./federation.md#authenticateddocumentloaderfactory).


Relay types
-----------

The first parameter to `createRelay()` specifies the relay protocol.
For detailed protocol specifications, see [FEP-ae0c].

[FEP-ae0c]: https://w3id.org/fep/ae0c

| Feature                | `"mastodon"`                 | `"litepub"`                  |
|------------------------|------------------------------|------------------------------|
| Activity forwarding    | Direct                       | Wrapped in `Announce`        |
| Following relationship | One-way                      | Bidirectional                |
| Subscription state     | Immediate `"accepted"`       | `"pending"` → `"accepted"`   |
| Compatibility          | Broad (most implementations) | LitePub-aware servers        |

> [!TIP]
> Use `"mastodon"` for broader compatibility. Switch to `"litepub"` only if
> you need its specific features.

### Mastodon-style relay

Activities are forwarded directly to subscribers. Instances follow the relay,
but the relay doesn't follow back.

~~~~ typescript twoslash
import { createRelay } from "@fedify/relay";
import { MemoryKvStore } from "@fedify/fedify";
// ---cut-before---
const relay = createRelay("mastodon", {
  kv: new MemoryKvStore(),
  domain: "relay.example.com",
  subscriptionHandler: async (ctx, actor) => true,
});
~~~~

Forwards `Create`, `Update`, `Delete`, `Move`, and `Announce` activities.

### LitePub-style relay

The relay server follows back instances that subscribe to it. Forwarded
activities are wrapped in `Announce` objects.

~~~~ typescript twoslash
import { createRelay } from "@fedify/relay";
import { MemoryKvStore } from "@fedify/fedify";
// ---cut-before---
const relay = createRelay("litepub", {
  kv: new MemoryKvStore(),
  domain: "relay.example.com",
  subscriptionHandler: async (ctx, actor) => true,
});
~~~~


Subscribing to a relay
----------------------

Instance administrators can subscribe to your relay by adding the relay URL
in their server settings.  The URL format differs depending on the relay type.

### Subscription URL

The subscription URL differs between Mastodon-style and LitePub-style relays:

| Relay type   | Subscription URL                       | Example                           |
|--------------|----------------------------------------|-----------------------------------|
| `"mastodon"` | Inbox URL: `https://{domain}/inbox`    | `https://relay.example.com/inbox` |
| `"litepub"`  | Actor URL: `https://{domain}/actor`    | `https://relay.example.com/actor` |

For more details on the protocol differences, see [FEP-ae0c].

### Subscribing from Mastodon

To subscribe from a Mastodon instance:

 1. Go to **Preferences** → **Administration** → **Relays**
 2. Click **Add new relay**
 3. Enter the relay inbox URL (e.g., `https://relay.example.com/inbox`)
 4. Click **Save and enable**

The relay will receive a `Follow` activity from the instance.  If the
`subscriptionHandler` approves the request, the relay sends back an `Accept`
activity, and the instance becomes a subscriber.

> [!NOTE]
> Mastodon only supports Mastodon-style relays.  Use the inbox URL
> (`https://{domain}/inbox`) when subscribing from Mastodon.

### Subscribing from Pleroma/Akkoma

Pleroma and Akkoma use LitePub-style relays by default.  To subscribe:

 1. Use the admin CLI or MIX task to add the relay
 2. Enter the relay actor URL (e.g., `https://relay.example.com/actor`)

### Subscribing from other software

Consult your server software's documentation for specific instructions.
The general process is:

 1. Find the relay settings in your server's administration panel
 2. Add the appropriate relay URL (inbox URL for Mastodon-style, actor URL
    for LitePub-style)
 3. Wait for the subscription to be approved


Handling subscriptions
----------------------

The `subscriptionHandler` is required and determines whether to approve or
reject subscription requests. For an open relay that accepts all subscriptions:

~~~~ typescript twoslash
import { createRelay } from "@fedify/relay";
import { MemoryKvStore } from "@fedify/fedify";
// ---cut-before---
const relay = createRelay("mastodon", {
  kv: new MemoryKvStore(),
  domain: "relay.example.com",
  subscriptionHandler: async (ctx, actor) => true,  // Accept all
});
~~~~

To implement approval logic with blocklists:

~~~~ typescript twoslash
import { createRelay } from "@fedify/relay";
import { MemoryKvStore } from "@fedify/fedify";
// ---cut-before---
const blockedDomains = ["spam.example", "blocked.example"];

const relay = createRelay("mastodon", {
  kv: new MemoryKvStore(),
  domain: "relay.example.com",
  subscriptionHandler: async (ctx, actor) => {
    const domain = new URL(actor.id!).hostname;
    if (blockedDomains.includes(domain)) {
      return false;  // Reject
    }
    return true;  // Approve
  },
});
~~~~

The handler receives:

 -  `ctx`: The `Context<RelayOptions>` object
 -  `actor`: The `Actor` requesting subscription

Return `true` to approve or `false` to reject.  Rejected requests receive a
`Reject` activity.


Managing followers
------------------

The relay provides methods to query and manage followers through the `Relay`
interface.

### Listing all followers

Use `listFollowers()` to iterate over all followers:

~~~~ typescript twoslash
import { createRelay } from "@fedify/relay";
import { MemoryKvStore } from "@fedify/fedify";
const relay = createRelay("mastodon", {
  kv: new MemoryKvStore(),
  domain: "relay.example.com",
  subscriptionHandler: async (ctx, actor) => true,
});
// ---cut-before---
for await (const follower of relay.listFollowers()) {
  console.log(`Follower: ${follower.actorId}`);
  console.log(`State: ${follower.state}`);
  console.log(`Actor name: ${follower.actor.name}`);
}
~~~~

### Getting a specific follower

Use `getFollower()` to retrieve a specific follower by actor ID:

~~~~ typescript twoslash
import { createRelay } from "@fedify/relay";
import { MemoryKvStore } from "@fedify/fedify";
const relay = createRelay("mastodon", {
  kv: new MemoryKvStore(),
  domain: "relay.example.com",
  subscriptionHandler: async (ctx, actor) => true,
});
// ---cut-before---
const follower = await relay.getFollower(
  "https://mastodon.example.com/users/alice"
);
if (follower != null) {
  console.log(`State: ${follower.state}`);
  console.log(`Actor: ${follower.actor.preferredUsername}`);
}
~~~~

### RelayFollower type

Each follower entry contains:

 -  `actorId`: The actor's ID (URL) as a string
 -  `actor`: The validated `Actor` object
 -  `state`: Either `"pending"` or `"accepted"`

> [!NOTE]
> The `listFollowers()` method requires a `KvStore` implementation that
> supports listing by prefix (Redis, PostgreSQL, SQLite, Deno KV all support
> this).


Storage requirements
--------------------

### Follower data

Stored with keys `["follower", actorId]`.  Actor objects typically range from
1–10 KB.  For 1,000 subscribers, expect 1–10 MB of storage.

### Cryptographic keys

Two key pairs are generated and stored:

| Key                                | Purpose                                          |
|------------------------------------|--------------------------------------------------|
| `["keypair", "rsa", "relay"]`      | HTTP Signatures                                  |
| `["keypair", "ed25519", "relay"]`  | Linked Data Signatures, Object Integrity Proofs  |

> [!NOTE]
> These keys are critical for the relay's identity.  Back up your `KvStore`
> regularly.


Security considerations
-----------------------

### Signature verification

The relay automatically verifies incoming activities using:

 -  [HTTP Signatures]
 -  [Linked Data Signatures]
 -  [Object Integrity Proofs]

Invalid signatures are silently ignored.  Enable [logging](./log.md) for the
`["fedify", "sig"]` category to debug verification failures.

[HTTP Signatures]: https://datatracker.ietf.org/doc/html/draft-cavage-http-signatures-12
[Linked Data Signatures]: https://web.archive.org/web/20170923124140/https://w3c-dvcg.github.io/ld-signatures/
[Object Integrity Proofs]: https://w3id.org/fep/8b32

### Subscription abuse

Protect against abuse by:

 1. Implementing a `subscriptionHandler` to validate requests
 2. Maintaining a blocklist
 3. Rate limiting at the infrastructure level
 4. Monitoring activity volumes

### Content moderation

> [!WARNING]
> Running a relay makes you responsible for forwarded content. Establish clear
> policies and vet subscribing instances.

### Privacy

The relay has access to all activities that pass through it. Do not store or
log activity content beyond operational needs.

> [!CAUTION]
> Never forward non-public activities. The relay is designed only for public
> content distribution.


Monitoring
----------

### Logging

Enable relay-specific logging:

~~~~ typescript twoslash
import { configure, getConsoleSink } from "@logtape/logtape";

await configure({
  sinks: { console: getConsoleSink() },
  loggers: [
    { category: ["fedify"], lowestLevel: "info", sinks: ["console"] },
  ],
});
~~~~

Key log categories:

| Category                               | Description            |
|----------------------------------------|------------------------|
| `["fedify", "federation", "inbox"]`    | Incoming activities    |
| `["fedify", "federation", "outbox"]`   | Outgoing activities    |
| `["fedify", "sig"]`                    | Signature verification |

### OpenTelemetry

The relay supports [OpenTelemetry](./opentelemetry.md) tracing. Key spans:

| Span                                    | Description              |
|-----------------------------------------|--------------------------|
| `activitypub.inbox`                     | Receiving activities     |
| `activitypub.send_activity`             | Forwarding activities    |
| `activitypub.dispatch_inbox_listener`   | Processing inbox events  |


<!-- cSpell: ignore LitePub -->
