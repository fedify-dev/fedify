<!-- deno-fmt-ignore-file -->

@fedify/relay: ActivityPub relay for Fedify
============================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]
[![Follow @fedify@hollo.social][@fedify@hollo.social badge]][@fedify@hollo.social]

*This package is available since Fedify 2.0.0.*

This package provides ActivityPub relay functionality for the [Fedify]
ecosystem, enabling the creation and management of relay servers that can
forward activities between federated instances.


What is an ActivityPub relay?
------------------------------

ActivityPub relays are infrastructure components that help small instances
participate effectively in the federated social network by acting as
intermediary servers that distribute public content without requiring
individual actor-following relationships.  When an instance subscribes to
a relay, all public posts from that instance are forwarded to all other
subscribed instances, creating a shared pool of federated content.


Relay protocols
---------------

This package supports two popular relay protocols used in the fediverse:

### Mastodon-style relay

The Mastodon-style relay protocol uses LD signatures for activity
verification and follows the Public collection.  This protocol is widely
supported by Mastodon and many other ActivityPub implementations.

Key features:

 -  Direct activity relaying with proper content types (`Create`, `Update`,
    `Delete`, `Move`)
 -  LD signature verification and generation
 -  Follows the ActivityPub Public collection
 -  Simple subscription mechanism via `Follow` activities

### LitePub-style relay

The LitePub-style relay protocol uses bidirectional following relationships
and wraps activities in `Announce` activities for distribution.

Key features:

 -  Reciprocal following between relay and subscribers
 -  Activities wrapped in `Announce` for distribution
 -  Two-phase subscription (pending → accepted)
 -  Enhanced federation capabilities


Installation
------------

::: code-group

~~~~ sh [Deno]
deno add jsr:@fedify/relay
~~~~

~~~~ sh [npm]
npm add @fedify/relay
~~~~

~~~~ sh [pnpm]
pnpm add @fedify/relay
~~~~

~~~~ sh [Yarn]
yarn add @fedify/relay
~~~~

~~~~ sh [Bun]
bun add @fedify/relay
~~~~

:::


Usage
-----

### Creating a relay

Here's a simple example of creating a relay server using the factory function:

~~~~ typescript
import { createRelay } from "@fedify/relay";
import { MemoryKvStore } from "@fedify/fedify";

// Create a Mastodon-style relay
const relay = createRelay("mastodon", {
  kv: new MemoryKvStore(),
  domain: "relay.example.com",
  // Optional: Set a custom subscription handler to approve/reject subscriptions
  subscriptionHandler: async (ctx, actor) => {
    // Implement your approval logic here
    // Return true to approve, false to reject
    const domain = new URL(actor.id!).hostname;
    const blockedDomains = ["spam.example", "blocked.example"];
    return !blockedDomains.includes(domain);
  },
});

// Serve the relay
Deno.serve((request) => relay.fetch(request));
~~~~

You can also create a LitePub-style relay by changing the type:

~~~~ typescript
const relay = createRelay("litepub", {
  kv: new MemoryKvStore(),
  domain: "relay.example.com",
});
~~~~

### Subscription handling

By default, the relay automatically rejects all subscription requests.
You can customize this behavior by providing a subscription handler in the options:

~~~~ typescript
const relay = createRelay("mastodon", {
  kv: new MemoryKvStore(),
  domain: "relay.example.com",
  subscriptionHandler: async (ctx, actor) => {
    // Example: Only allow subscriptions from specific domains
    const domain = new URL(actor.id!).hostname;
    const allowedDomains = ["mastodon.social", "fosstodon.org"];
    return allowedDomains.includes(domain);
  },
});
~~~~

### Integration with web frameworks

The relay's `fetch()` method returns a standard `Response` object, making it
compatible with any web framework that supports the Fetch API.  Here's an
example with Hono:

~~~~ typescript
import { Hono } from "hono";
import { createRelay } from "@fedify/relay";
import { MemoryKvStore } from "@fedify/fedify";

const app = new Hono();
const relay = createRelay("mastodon", {
  kv: new MemoryKvStore(),
  domain: "relay.example.com",
});

app.use("*", async (c) => {
  return await relay.fetch(c.req.raw);
});

export default app;
~~~~


How it works
------------

The relay operates by:

1.  **Actor registration**: The relay presents itself as a Service actor at
    `/users/relay`
2.  **Subscription**: Instances subscribe to the relay by sending a `Follow`
    activity
3.  **Approval**: The relay's subscription handler determines whether to
    approve the subscription (responds with `Accept` or `Reject`)
4.  **Forwarding**: When a subscribed instance sends activities (`Create`,
    `Update`, `Delete`, `Move`) to the relay's inbox, the relay forwards them
    to all other subscribed instances
5.  **Unsubscription**: Instances can unsubscribe by sending an `Undo` activity
    wrapping their original `Follow` activity


Storage requirements
--------------------

The relay requires a key–value store to persist:

 -  Subscriber list and their Follow activity IDs
 -  Subscriber actor information
 -  Relay's cryptographic key pairs (RSA and Ed25519)

Any `KvStore` implementation from Fedify can be used, including:

 -  `MemoryKvStore` (for development/testing)
 -  `DenoKvStore` (Deno KV)
 -  `RedisKvStore` (Redis)
 -  `PostgresKvStore` (PostgreSQL)
 -  `SqliteKvStore` (SQLite)

For production use, choose a persistent storage backend like Redis or
PostgreSQL.  See the [Fedify documentation on key–value stores] for more
details.


API reference
-------------

### `createRelay()`

Factory function to create a relay instance.

~~~~ typescript
function createRelay(
  type: "mastodon" | "litepub",
  options: RelayOptions
): BaseRelay
~~~~

**Parameters:**

 -  `type`: The type of relay to create (`"mastodon"` or `"litepub"`)
 -  `options`: Configuration options for the relay

**Returns:** A relay instance (`MastodonRelay` or `LitePubRelay`)

### `BaseRelay`

Abstract base class for relay implementations.

#### Methods

 -  `fetch(request: Request): Promise<Response>`: Handle incoming HTTP requests

### `MastodonRelay`

A Mastodon-compatible ActivityPub relay implementation that extends `BaseRelay`.

 -  Uses direct activity forwarding
 -  Immediate subscription approval
 -  Compatible with standard ActivityPub implementations

### `LitePubRelay`

A LitePub-compatible ActivityPub relay implementation that extends `BaseRelay`.

 -  Uses bidirectional following
 -  Activities wrapped in `Announce`
 -  Two-phase subscription (pending → accepted)

### `RelayOptions`

Configuration options for the relay:

 -  `kv: KvStore` (required): Key–value store for persisting relay data
 -  `domain?: string`: Relay's domain name (defaults to `"localhost"`)
 -  `name?: string`: Relay's display name (defaults to `"ActivityPub Relay"`)
 -  `subscriptionHandler?: SubscriptionRequestHandler`: Custom handler for
    subscription approval/rejection
 -  `documentLoaderFactory?: DocumentLoaderFactory`: Custom document loader
    factory
 -  `authenticatedDocumentLoaderFactory?: AuthenticatedDocumentLoaderFactory`:
    Custom authenticated document loader factory
 -  `queue?: MessageQueue`: Message queue for background activity processing

### `SubscriptionRequestHandler`

A function that determines whether to approve a subscription request:

~~~~ typescript
type SubscriptionRequestHandler = (
  ctx: Context<RelayOptions>,
  clientActor: Actor,
) => Promise<boolean>
~~~~

**Parameters:**

 -  `ctx`: The Fedify context object with relay options
 -  `clientActor`: The actor requesting to subscribe

**Returns:**

 -  `true` to approve the subscription
 -  `false` to reject the subscription


[JSR]: https://jsr.io/@fedify/relay
[JSR badge]: https://jsr.io/badges/@fedify/relay
[npm]: https://www.npmjs.com/package/@fedify/relay
[npm badge]: https://img.shields.io/npm/v/@fedify/relay?logo=npm
[@fedify@hollo.social badge]: https://fedi-badge.deno.dev/@fedify@hollo.social/followers.svg
[@fedify@hollo.social]: https://hollo.social/@fedify
[Fedify]: https://fedify.dev/
[Fedify documentation on key–value stores]: https://fedify.dev/manual/kv
