---
description: >-
  Fedify provides a ready-to-use relay server implementation for building
  ActivityPub relay infrastructure.
---

Relay
=====

*This API is available since Fedify 2.0.0.*

Fedify provides the *@fedify/relay* package for building
[ActivityPub relay servers]—services that forward activities between instances
without requiring individual actor-following relationships.

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
  origin: "https://relay.example.com",
  name: "My ActivityPub Relay",
  subscriptionHandler: async (ctx, actor) => {
    // Approve all subscriptions
    return true;
  },
});

Deno.serve((request) => relay.fetch(request));
~~~~

~~~~ typescript twoslash [Bun]
import "bun";
// ---cut-before---
import { createRelay } from "@fedify/relay";
import { MemoryKvStore } from "@fedify/fedify";

const relay = createRelay("mastodon", {
  kv: new MemoryKvStore(),
  origin: "https://relay.example.com",
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
  origin: "https://relay.example.com",
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
> *@fedify/postgres*, `MysqlKvStore` from *@fedify/mysql*, or `DenoKvStore`
> from *@fedify/denokv*.
>
> See the [*Key–value store* section](./kv.md) for details.


Configuration options
---------------------

`kv` (required)
:   A [`KvStore`](./kv.md) for storing subscriber information and cryptographic
    keys.

`origin` (required)
:   The origin URL where the relay is hosted (e.g.,
    `"https://relay.example.com"`).

`name`
:   Display name for the relay actor. Defaults to `"ActivityPub Relay"`.

`queue`
:   A [`MessageQueue`](./mq.md) for background activity processing.  Recommended
    for production.

~~~~ typescript twoslash
import { createRelay } from "@fedify/relay";
import { MemoryKvStore, InProcessMessageQueue } from "@fedify/fedify";
// ---cut-before---
const relay = createRelay("mastodon", {
  kv: new MemoryKvStore(),
  origin: "https://relay.example.com",
  queue: new InProcessMessageQueue(),
  subscriptionHandler: async (ctx, actor) => true,
});
~~~~

> [!NOTE]
> For production, use [`RedisMessageQueue`], [`PostgresMessageQueue`],
> or [`MysqlMessageQueue`].

`subscriptionHandler` (required)
:   Callback to approve or reject subscription requests. See
    [*Handling subscriptions*](#handling-subscriptions). To create an open relay
    that accepts all subscriptions, set `subscriptionHandler` to always return
    `true`.

    ~~~~ typescript
    subscriptionHandler: async (ctx, actor) => true
    ~~~~

`documentLoaderFactory`
:   A factory function for creating a document loader to fetch remote
    ActivityPub objects. See [*Getting a `Federation`
    object*](./federation.md#documentloaderfactory).

`authenticatedDocumentLoaderFactory`
:   A factory function for creating an authenticated document loader.
    See
    [`authenticatedDocumentLoaderFactory`](./federation.md#authenticateddocumentloaderfactory).

[`RedisMessageQueue`]: https://jsr.io/@fedify/redis/doc/mq/~/RedisMessageQueue
[`PostgresMessageQueue`]: https://jsr.io/@fedify/postgres/doc/mq/~/PostgresMessageQueue
[`MysqlMessageQueue`]: https://jsr.io/@fedify/mysql/doc/mq/~/MysqlMessageQueue


Relay types
-----------

The first parameter to `createRelay()` selects how this relay server handles
subscriptions and forwards activities.  The package implements the server side
of the Mastodon-style and LitePub-style protocols described by [FEP-ae0c]; it
does not configure an existing ActivityPub application as a relay client.

| Feature                   | `"mastodon"`           | `"litepub"`                |
| ------------------------- | ---------------------- | -------------------------- |
| Activity forwarding       | Direct                 | Wrapped in `Announce`      |
| Following relationship    | One-way                | Bidirectional              |
| Subscription state        | Immediate `"accepted"` | `"pending"` → `"accepted"` |
| Canonical `Follow` object | Public collection      | Relay actor                |

[FEP-ae0c]: https://w3id.org/fep/ae0c

### Mastodon-style relay

Activities are forwarded directly to subscribers. Instances follow the relay,
but the relay doesn't follow back.

~~~~ typescript twoslash
import { createRelay } from "@fedify/relay";
import { MemoryKvStore } from "@fedify/fedify";
// ---cut-before---
const relay = createRelay("mastodon", {
  kv: new MemoryKvStore(),
  origin: "https://relay.example.com",
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
  origin: "https://relay.example.com",
  subscriptionHandler: async (ctx, actor) => true,
});
~~~~


Subscribing to a relay
----------------------

Instance administrators can subscribe to your relay by adding the relay URL
in their server settings.  The URL format differs depending on the relay type.

### Subscription URL

Retrieve subscription URLs from the relay instance rather than constructing
them from assumed paths.

~~~~ typescript twoslash
import { createRelay } from "@fedify/relay";
import { MemoryKvStore } from "@fedify/fedify";
const relay = createRelay("mastodon", {
  kv: new MemoryKvStore(),
  origin: "https://relay.example.com",
  subscriptionHandler: async (ctx, actor) => true,
});
// ---cut-before---
const actorUri = await relay.getActorUri();
const sharedInboxUri = await relay.getSharedInboxUri();
~~~~

| Relay type   | Give clients     | Default URI                             |
| ------------ | ---------------- | --------------------------------------- |
| `"mastodon"` | `sharedInboxUri` | `https://relay.example.com/inbox`       |
| `"litepub"`  | `actorUri`       | `https://relay.example.com/users/relay` |

For more details on the protocol differences, see [FEP-ae0c].


Application responsibilities
----------------------------

`createRelay()` provides the relay actor, inboxes, subscription handshake,
activity forwarding, cryptographic keys, and follower storage.  The surrounding
application still needs to implement the following.

 -  Route requests for the configured `origin` to `relay.fetch()` without
    rewriting the relay's paths.
 -  Terminate HTTPS and use a persistent `KvStore` in production.
 -  Configure a durable `MessageQueue` when delivery should survive process
    restarts.
 -  Implement subscription policy and infrastructure-level rate limiting,
    monitoring, and moderation.
 -  Provide WebFinger or NodeInfo separately when deployed clients require
    those discovery endpoints.

The `subscriptionHandler` decides who is stored as a delivery recipient.  It is
not authorization for publishing to the relay.  The relay verifies incoming
activities using Fedify's federation pipeline, but it does not require the
sender to be a stored follower or check that an activity addresses the Public
collection.  Deployments should account for that behavior in their access and
moderation policies.


Handling subscriptions
----------------------

The `subscriptionHandler` is required and determines whether to approve or
reject subscription requests.  The following example creates an open relay that
accepts all subscriptions.

~~~~ typescript twoslash
import { createRelay } from "@fedify/relay";
import { MemoryKvStore } from "@fedify/fedify";
// ---cut-before---
const relay = createRelay("mastodon", {
  kv: new MemoryKvStore(),
  origin: "https://relay.example.com",
  subscriptionHandler: async (ctx, actor) => true,  // Accept all
});
~~~~

Approval logic can also be implemented with a domain block list.

~~~~ typescript twoslash
import { createRelay } from "@fedify/relay";
import { MemoryKvStore } from "@fedify/fedify";
// ---cut-before---
const blockedDomains = ["spam.example", "blocked.example"];

const relay = createRelay("mastodon", {
  kv: new MemoryKvStore(),
  origin: "https://relay.example.com",
  subscriptionHandler: async (ctx, actor) => {
    const domain = new URL(actor.id!).hostname;
    if (blockedDomains.includes(domain)) {
      return false;  // Reject
    }
    return true;  // Approve
  },
});
~~~~

The handler receives the `Context<RelayOptions>` object as `ctx` and the `Actor`
requesting the subscription as `actor`.

Return `true` to approve the request or `false` to reject it.  The relay
responds to rejected requests with a `Reject` activity.


Managing followers
------------------

The relay provides methods to query and manage followers through the `Relay`
interface.

### Listing all followers

Use `listFollowers()` to iterate over all followers.

~~~~ typescript twoslash
import { createRelay } from "@fedify/relay";
import { MemoryKvStore } from "@fedify/fedify";
const relay = createRelay("mastodon", {
  kv: new MemoryKvStore(),
  origin: "https://relay.example.com",
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

Use `getFollower()` to retrieve a specific follower by actor ID.

~~~~ typescript twoslash
import { createRelay } from "@fedify/relay";
import { MemoryKvStore } from "@fedify/fedify";
const relay = createRelay("mastodon", {
  kv: new MemoryKvStore(),
  origin: "https://relay.example.com",
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

### `RelayFollower` type

Each follower entry contains the following.

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

The relay generates and stores two key pairs.

| Key                               | Purpose                                         |
| --------------------------------- | ----------------------------------------------- |
| `["keypair", "rsa", "relay"]`     | HTTP Signatures                                 |
| `["keypair", "ed25519", "relay"]` | Linked Data Signatures, Object Integrity Proofs |

> [!NOTE]
> These keys are critical for the relay's identity.  Back up your `KvStore`
> regularly.


Security considerations
-----------------------

### Signature verification

Incoming activities pass through Fedify's normal signature verification
pipeline.  A valid signature authenticates the sender but does not make the
activity trusted.

The `subscriptionHandler` controls which actors receive forwarded activities.
It does not restrict which actors can submit activities to the relay, and
`createRelay()` does not check whether an activity addresses the Public
collection before forwarding it.

Deployments should apply appropriate access controls, rate limiting, and
moderation to the relay inbox.  Avoid logging activity content unless it is
needed for operation or debugging.


Monitoring
----------

### Logging

The following example enables Fedify logging, including relay operations.

~~~~ typescript twoslash
import { configure, getConsoleSink } from "@logtape/logtape";

await configure({
  sinks: { console: getConsoleSink() },
  loggers: [
    { category: ["fedify"], lowestLevel: "info", sinks: ["console"] },
  ],
});
~~~~

You can enable logging relevant to relay operation as follows.

| Category                             | Description            |
| ------------------------------------ | ---------------------- |
| `["fedify", "relay"]`                | Relay-specific events  |
| `["fedify", "federation", "inbox"]`  | Incoming activities    |
| `["fedify", "federation", "outbox"]` | Outgoing activities    |
| `["fedify", "sig"]`                  | Signature verification |

### OpenTelemetry

Relay operations are included in [OpenTelemetry](./opentelemetry.md).

| Span                                  | Description                  |
| ------------------------------------- | ---------------------------- |
| `activitypub.inbox`                   | Receiving an activity        |
| `activitypub.send_activity`           | Sending a relayed activity   |
| `activitypub.dispatch_inbox_listener` | Processing an inbox activity |

<!-- cSpell: ignore LitePub -->
