---
description: >-
  The Context object exposes a rich set of methods beyond URI building.  This
  guide gathers the advanced Context helpers—URI parsing, manual activity
  routing, signature introspection, authenticated fetching, and remote
  lookups—in one place so you can discover them without hunting across multiple
  pages.
---

Advanced context helpers
========================

The [`Context`] (and its subtype [`RequestContext`]) object is passed to every
callback you register on a [`Federation`] instance. The [_Context_
guide](./context.md) explains the basics: where to get a `Context`, how to
build URIs, and how to enqueue outgoing activities. This page covers
the advanced helpers that let you _parse_ URIs, _introspect_ incoming
signatures, _load_ remote documents with authentication, and _look up_ remote
fediverse resources.

Quick reference:

| Method / property                                        | Available on     | Since  |
| -------------------------------------------------------- | ---------------- | ------ |
| [`parseUri()`](#parsing-uris)                            | `Context`        | 0.9.0  |
| [`routeActivity()`](#routing-activities-manually)        | `Context`        | 1.3.0  |
| [`getSignedKey()`](#signed-key-and-its-owner)            | `RequestContext` | 0.7.0  |
| [`getSignedKeyOwner()`](#signed-key-and-its-owner)       | `RequestContext` | 0.7.0  |
| [`getDocumentLoader()`](#authenticated-document-loaders) | `Context`        | 0.4.0  |
| [`getActorKeyPairs()`](#actor-key-pairs)                 | `Context`        | 0.10.0 |
| [`lookupObject()`](#looking-up-remote-objects)           | `Context`        | 0.15.0 |
| [`lookupWebFinger()`](#webfinger-lookups)                | `Context`        | 1.6.0  |
| [`lookupNodeInfo()`](#nodeinfo-lookups)                  | `Context`        | 1.4.0  |
| [`traverseCollection()`](#traversing-collections)        | `Context`        | 1.1.0  |
| [`request`](#request-and-url)                            | `RequestContext` | 0.1.0  |
| [`url`](#request-and-url)                                | `RequestContext` | 0.1.0  |

[`Context`]: https://jsr.io/@fedify/fedify/doc/federation/~/Context
[`RequestContext`]: https://jsr.io/@fedify/fedify/doc/federation/~/RequestContext
[`Federation`]: https://jsr.io/@fedify/fedify/doc/federation/~/Federation


Parsing URIs
------------

_This API is available since Fedify 0.9.0._

`Context` provides methods to build the canonical URIs for your actors and
objects (e.g., `~Context.getActorUri()`, `~Context.getObjectUri()`).
The inverse operation—determining _what_ a URI refers to—is handled by
[`Context.parseUri()`]:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
const someUri = new URL("https://example.com/users/alice");
// ---cut-before---
const result = ctx.parseUri(someUri);
if (result?.type === "actor") {
  console.log(result.identifier); // e.g. "alice"
}
~~~~

`parseUri()` returns `null` when the argument is `null` or when the URI does
not match any route registered on the `Federation`. Otherwise it returns a
discriminated union keyed on `type`:

| `type`                | Extra fields                                |
| --------------------- | ------------------------------------------- |
| `"actor"`             | `identifier`                                |
| `"object"`            | `class`, `typeId`, `values`                 |
| `"inbox"`             | `identifier` (`undefined` for shared inbox) |
| `"outbox"`            | `identifier`                                |
| `"following"`         | `identifier`                                |
| `"followers"`         | `identifier`                                |
| `"liked"`             | `identifier`                                |
| `"featured"`          | `identifier`                                |
| `"featuredTags"`      | `identifier`                                |
| `"collection"`        | `name`, `class`, `typeId`, `values`         |
| `"orderedCollection"` | `name`, `class`, `typeId`, `values`         |

A common pattern is to extract the sender identifier from an incoming activity
so you can pass it to `~Context.sendActivity()`:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
// ---cut-before---
import { Accept, Follow } from "@fedify/vocab";

federation
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
  .on(Follow, async (ctx, follow) => {
    if (follow.objectId == null) return;
    const parsed = ctx.parseUri(follow.objectId); // [!code highlight]
    if (parsed?.type !== "actor") return; // [!code highlight]
    const recipient = await follow.getActor(ctx);
    if (recipient == null) return;
    await ctx.sendActivity(
      { identifier: parsed.identifier },
      recipient,
      new Accept({ actor: follow.objectId, object: follow }),
    );
  });
~~~~

[`Context.parseUri()`]: https://jsr.io/@fedify/fedify/doc/federation/~/Context#method_parseUri_0


Routing activities manually
---------------------------

_This API is available since Fedify 1.3.0._

Inbox listeners normally receive activities that arrive over HTTP. Sometimes,
however, you want to dispatch an activity through the same listener logic
_without_ an actual network request—for example, when an `Announce` wraps
another `Activity`, or when you replay a remote actor's outbox locally.
[`Context.routeActivity()`] does exactly that.

The first argument is the recipient identifier (or `null` for the shared
inbox). The second is the `Activity` to route:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Activity, Announce } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
// ---cut-before---
federation
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
  .on(Announce, async (ctx, announce) => {
    const object = await announce.getObject();
    if (object instanceof Activity) {
      // Route the enclosed activity to the matching inbox listener:
      await ctx.routeActivity(ctx.recipient, object); // [!code highlight]
    }
  });
~~~~

As another example, you can replay a remote actor's outbox into your local
inbox listeners:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
import { Activity, isActor } from "@fedify/vocab";
async function main(context: Context<void>) {
  // ---cut-before---
  const actor = await context.lookupObject("@hongminhee@fosstodon.org");
  if (!isActor(actor)) return;
  const outbox = await actor.getOutbox();
  if (outbox == null) return;
  for await (const item of context.traverseCollection(outbox)) {
    if (item instanceof Activity) {
      await context.routeActivity(null, item); // [!code highlight]
    }
  }
  // ---cut-after---
}
~~~~

> [!CAUTION]
> `routeActivity()` verifies the activity before dispatching it. An activity
> is accepted only when _at least one_ of these conditions is met:
>
>  -  The activity carries valid Object Integrity Proofs signed by its actor.
>  -  The activity has a dereferenceable `id` whose fetched document contains
>     at least one actor sharing the same origin as the `id`.
>
> If neither condition is satisfied, the activity is silently discarded and
> `routeActivity()` returns `false`. Never pass arbitrary untrusted
> `Activity` objects with the expectation that they will be accepted.

By default, `routeActivity()` enqueues the activity for background processing,
just like activities received over HTTP. Pass `immediate: true` in the options
to invoke the matching listener synchronously instead:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
import { Activity } from "@fedify/vocab";
const context = null as unknown as Context<void>;
const activity = new Activity({});
// ---cut-before---
await context.routeActivity(null, activity, { immediate: true });
~~~~

See also the [_Manual routing_ section](./inbox.md#manual-routing) in the
_Inbox listeners_ guide for more examples.

[`Context.routeActivity()`]: https://jsr.io/@fedify/fedify/doc/federation/~/Context#method_routeActivity_0


Signed key and its owner
------------------------

_This API is available since Fedify 0.7.0._

[`RequestContext.getSignedKey()`] verifies the HTTP Signature on the current
incoming request and returns the corresponding [`CryptographicKey`], or `null`
if the request is unsigned or the signature is invalid:

~~~~ typescript twoslash
import { type RequestContext } from "@fedify/fedify";
const ctx = null as unknown as RequestContext<void>;
// ---cut-before---
const key = await ctx.getSignedKey();
if (key != null) {
  console.log("Request signed with key:", key.id?.href);
}
~~~~

[`RequestContext.getSignedKeyOwner()`] goes one step further: it looks up the
actor that owns the verified key and returns an [`Actor`] object, or `null` if
no valid signature is present or the owner cannot be fetched:

~~~~ typescript twoslash
import { type RequestContext } from "@fedify/fedify";
const ctx = null as unknown as RequestContext<void>;
async function handleRequest() {
  // ---cut-before---
  const owner = await ctx.getSignedKeyOwner();
  if (owner == null) {
    // No valid signature—treat as unauthenticated.
    return;
  }
  console.log("Request from actor:", owner.id?.href);
  // ---cut-after---
}
~~~~

Both results are cached: calling either method more than once in the same
request returns the same value without re-verifying.

[`RequestContext.getSignedKey()`]: https://jsr.io/@fedify/fedify/doc/federation/~/RequestContext#method_getSignedKey_0
[`CryptographicKey`]: https://jsr.io/@fedify/vocab/doc/~/CryptographicKey
[`RequestContext.getSignedKeyOwner()`]: https://jsr.io/@fedify/fedify/doc/federation/~/RequestContext#method_getSignedKeyOwner_0
[`Actor`]: https://jsr.io/@fedify/vocab/doc/~/Actor

### Instance actor and mutual authorized fetch

When both your server and the remote server require [authorized fetch], a
naive implementation can deadlock: fetching the remote actor's public key
requires a signed request, which in turn requires the remote actor's key.
The standard solution is an [instance actor]—a special actor that represents
the whole server and is exempt from authorized fetch requirements.

Pass an authenticated document loader (created via `getDocumentLoader()` for
your instance actor) to `getSignedKeyOwner()` so that Fedify can fetch the
remote actor's key with a valid signature:

~~~~ typescript twoslash
// @noErrors: 2307 2345
import type { Federation } from "@fedify/fedify";
import type { Actor } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
async function isBlocked(userId: string, signedKeyOwner: Actor): Promise<boolean> {
  return false;
}
// ---cut-before---
federation
  .setActorDispatcher("/actors/{identifier}", async (ctx, identifier) => {
    // ... actor implementation omitted ...
  })
  .authorize(async (ctx, identifier) => {
    if (identifier === ctx.hostname) return true; // instance actor bypass
    const documentLoader = await ctx.getDocumentLoader({
      identifier: ctx.hostname, // sign as instance actor
    });
    const owner = await ctx.getSignedKeyOwner({ documentLoader }); // [!code highlight]
    if (owner == null) return false;
    return !(await isBlocked(identifier, owner));
  });
~~~~

For a complete explanation of authorized fetch and instance actors, see the
[_Access control_ guide](./access-control.md).

[authorized fetch]: https://swicg.github.io/activitypub-http-signature/#authorized-fetch
[instance actor]: https://swicg.github.io/activitypub-http-signature/#instance-actor


Authenticated document loaders
------------------------------

_This API is available since Fedify 0.4.0._

The `Context.documentLoader` property holds the default (unauthenticated)
[`DocumentLoader`] configured for the federation. When you need to fetch a
private resource—such as a followers-only note or a locked collection—you
must send the request with a valid HTTP Signature.
[`Context.getDocumentLoader()`] creates an authenticated loader on your behalf.

You can identify the signing actor by identifier, by username (if a handle
mapper is registered), or directly by key material:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
// ---cut-before---
// Sign as an actor identified by UUID:
const loaderById = await ctx.getDocumentLoader({
  identifier: "2bd304f9-36b3-44f0-bf0b-29124aafcbb4",
});

// Sign as an actor identified by username:
const loaderByUsername = await ctx.getDocumentLoader({
  username: "alice",
});

// Sign with an explicit key pair:
const privateKey = null as unknown as CryptoKey;
const loaderByKey = ctx.getDocumentLoader({
  keyId: new URL("https://example.com/users/alice#main-key"),
  privateKey,
});
~~~~

Pass the resulting loader to any dereferencing accessor or to
`lookupObject()`:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
import { type Actor } from "@fedify/vocab";
const ctx = null as unknown as Context<void>;
const actor = null as unknown as Actor;
// ---cut-before---
const documentLoader = await ctx.getDocumentLoader({ identifier: "alice" });
const followers = await actor.getFollowers({ documentLoader });
~~~~

> [!NOTE]
> Authenticated document loaders intentionally do _not_ cache responses,
> because cached data might be stale or correspond to a different
> authentication context.

> [!TIP]
> Inside a personal inbox listener, `ctx.documentLoader` is already
> pre-authenticated as the inbox owner. You do not need to call
> `getDocumentLoader()` there—just pass `ctx` directly to dereferencing
> accessors. See [_`Context.documentLoader` on an inbox
> listener_](./inbox.md#context-documentloader-on-an-inbox-listener) for
> details.

For a deeper dive into when and why to use authenticated loaders, see
[_Getting an authenticated `DocumentLoader`_](./context.md#getting-an-authenticated-documentloader)
in the _Context_ guide.

[`DocumentLoader`]: https://jsr.io/@fedify/fedify/doc/federation/~/DocumentLoader
[`Context.getDocumentLoader()`]: https://jsr.io/@fedify/fedify/doc/federation/~/Context#method_getDocumentLoader_0


Actor key pairs
---------------

_This API is available since Fedify 0.10.0._

[`Context.getActorKeyPairs()`] dispatches the cryptographic key pairs for an
actor and returns them as an array of [`ActorKeyPair`] objects. Each entry
exposes the key in three formats:

| Property           | Format                          | Use case                     |
| ------------------ | ------------------------------- | ---------------------------- |
| `cryptographicKey` | `CryptographicKey` (vocab type) | HTTP Signatures, LD Sigs     |
| `multikey`         | `Multikey` (vocab type)         | Object Integrity Proofs      |
| `privateKey`       | Web Crypto `CryptoKey`          | Manual signing               |
| `keyId`            | `URL`                           | Reference in actor documents |

The first key always gets the `#main-key` fragment for backward compatibility
with clients that look for that specific key ID. Subsequent keys are numbered
`#key-2`, `#key-3`, and so on.

A typical use in an actor dispatcher:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
// ---cut-before---
federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
  const keys = await ctx.getActorKeyPairs(identifier); // [!code highlight]
  return new Person({
    id: ctx.getActorUri(identifier),
    preferredUsername: identifier,
    publicKey: keys[0].cryptographicKey, // [!code highlight]
    assertionMethods: keys.map((k) => k.multikey), // [!code highlight]
  });
});
~~~~

`getActorKeyPairs()` internally calls the key pairs dispatcher you registered
with `~ActorCallbackSetters.setKeyPairsDispatcher()`. If no dispatcher is
registered, it returns an empty array. See [_Public keys of an
actor_](./actor.md#public-keys-of-an-actor) for details on registering the
dispatcher and generating key pairs.

[`Context.getActorKeyPairs()`]: https://jsr.io/@fedify/fedify/doc/federation/~/Context#method_getActorKeyPairs_0
[`ActorKeyPair`]: https://jsr.io/@fedify/fedify/doc/federation/~/ActorKeyPair


Looking up remote objects
-------------------------

_This API is available since Fedify 0.15.0._

[`Context.lookupObject()`] fetches an ActivityStreams object by URI or
fediverse handle. When given a handle, it first queries WebFinger to discover
the actor URI and then fetches the actor.

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
// ---cut-before---
// All three forms are equivalent:
const actor1 = await ctx.lookupObject("@hongminhee@fosstodon.org");
const actor2 = await ctx.lookupObject("hongminhee@fosstodon.org");
const actor3 = await ctx.lookupObject("acct:hongminhee@fosstodon.org");

// Look up a post by URI:
const note = await ctx.lookupObject("https://fosstodon.org/@hongminhee/112060633798771581");
~~~~

The method returns `null` when the object cannot be fetched or does not pass
validation.

[`Context.lookupObject()`]: https://jsr.io/@fedify/fedify/doc/federation/~/Context#method_lookupObject_0

### Authenticated lookups

Some resources require authorization, such as followers-only posts. Pass an
authenticated document loader (obtained from `getDocumentLoader()`) to gain
access:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
// ---cut-before---
const loader = await ctx.getDocumentLoader({ identifier: "alice" });
const note = await ctx.lookupObject("https://example.com/users/bob/notes/123", {
  documentLoader: loader,
});
~~~~

### Origin validation

For security, `lookupObject()` follows [FEP-fe34]: if the fetched document
contains an `@id` with a different origin from the requested URL, the method
returns `null` by default to prevent content-spoofing attacks. Control this
behavior with the `crossOrigin` option:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
// ---cut-before---
// Default: return null for cross-origin ids (recommended).
const obj = await ctx.lookupObject("https://example.com/notes/123");

// Throw instead of returning null:
const strict = await ctx.lookupObject("https://example.com/notes/123", { crossOrigin: "throw" });

// Skip origin check (use only with additional validation):
const trusted = await ctx.lookupObject("https://example.com/notes/123", { crossOrigin: "trust" });
~~~~

> [!CAUTION]
> Only use `crossOrigin: "trust"` when you fully understand the security
> implications and have implemented additional validation measures.

[FEP-fe34]: https://w3id.org/fep/fe34


WebFinger lookups
-----------------

_This API is available since Fedify 1.6.0._

[`Context.lookupWebFinger()`] queries a remote server's WebFinger endpoint
and returns the raw [`ResourceDescriptor`] (JRD) document, or `null` on
failure.

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
// ---cut-before---
const jrd = await ctx.lookupWebFinger("acct:fedify@hollo.social");

// Extract the ActivityPub actor URI:
const link = jrd?.links?.find((l) => l.rel === "self" && l.type === "application/activity+json");
if (link?.href) {
  const actor = await ctx.lookupObject(link.href);
}
~~~~

> [!TIP]
> In most cases, `lookupObject()` is simpler: it handles the WebFinger step
> automatically when given a handle. Use `lookupWebFinger()` when you need
> the raw JRD—for example, to inspect profile-page links or custom
> relation types.

For more information about WebFinger, see the
[_WebFinger_ guide](./webfinger.md).

[`Context.lookupWebFinger()`]: https://jsr.io/@fedify/fedify/doc/federation/~/Context#method_lookupWebFinger_0
[`ResourceDescriptor`]: https://jsr.io/@fedify/webfinger/doc/~/ResourceDescriptor


NodeInfo lookups
----------------

_This API is available since Fedify 1.4.0._

[`Context.lookupNodeInfo()`] fetches a remote server's [NodeInfo] document.
By default it discovers the NodeInfo URL from `/.well-known/nodeinfo`; pass
`direct: true` to skip discovery and fetch the given URL directly.

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
// ---cut-before---
// Discover and fetch NodeInfo for a remote server:
const info = await ctx.lookupNodeInfo("https://mastodon.social");
if (info != null) {
  console.log("Software:", info.software.name, info.software.version);
  console.log("Users:", info.usage?.users?.total);
}
~~~~

The method returns `undefined` when the server does not expose NodeInfo or
when the fetch fails. For the full list of options, see
[`GetNodeInfoOptions`].

For more information on NodeInfo, see the [_NodeInfo_ guide](./nodeinfo.md).

[`Context.lookupNodeInfo()`]: https://jsr.io/@fedify/fedify/doc/federation/~/Context#method_lookupNodeInfo_0
[NodeInfo]: https://nodeinfo.diaspora.software/
[`GetNodeInfoOptions`]: https://jsr.io/@fedify/fedify/doc/nodeinfo/~/GetNodeInfoOptions


Traversing collections
----------------------

_This API is available since Fedify 1.1.0._

[`Context.traverseCollection()`] iterates over all items in an ActivityStreams
[`Collection`] or [`OrderedCollection`], automatically following pagination
links.

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
import { isActor } from "@fedify/vocab";
const ctx = null as unknown as Context<void>;
// ---cut-before---
const actor = await ctx.lookupObject("@hongminhee@fosstodon.org");
if (isActor(actor)) {
  const outbox = await actor.getOutbox();
  if (outbox != null) {
    for await (const activity of ctx.traverseCollection(outbox)) {
      // [!code highlight]
      console.log(activity.id?.href);
    }
  }
}
~~~~

Pass `suppressError: true` to log page-fetch errors instead of throwing, which
is useful when you want to process as many items as possible even if some pages
are unavailable:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
import { type Collection } from "@fedify/vocab";
const ctx = null as unknown as Context<void>;
const collection = null as unknown as Collection;
// ---cut-before---
for await (const item of ctx.traverseCollection(collection, {
  suppressError: true,
})) {
  console.log(item.id?.href);
}
~~~~

[`Context.traverseCollection()`]: https://jsr.io/@fedify/fedify/doc/federation/~/Context#method_traverseCollection_0
[`Collection`]: https://jsr.io/@fedify/vocab/doc/~/Collection
[`OrderedCollection`]: https://jsr.io/@fedify/vocab/doc/~/OrderedCollection


`request` and `url`
-------------------

`RequestContext`—the subtype of `Context` used inside HTTP-request
callbacks—exposes two additional properties for inspecting the current
request:

~~~~ typescript twoslash
import { type RequestContext } from "@fedify/fedify";
const ctx = null as unknown as RequestContext<void>;
// ---cut-before---
// The raw Web API Request object:
const request: Request = ctx.request;

// The parsed URL of the request:
const url: URL = ctx.url;
~~~~

These are distinct from `Context.origin`, which only contains the scheme and
host. `ctx.url` includes the full path and query string.

A common use is to pass the original request along to another handler or to
read custom headers and query parameters:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
// ---cut-before---
federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
  // Read a custom header from the incoming request:
  const accept = ctx.request.headers.get("Accept");
  // Inspect the full URL, including any query string:
  const query = ctx.url.searchParams.get("format");
  // ...
  return null;
});
~~~~

`RequestContext` is used in actor dispatchers, inbox listeners, object
dispatchers, collection dispatchers, and anywhere else a live HTTP request
is in scope. Background tasks and contexts created with
`Federation.createContext()` without a `Request` argument use the base
`Context` type and do not have these properties.
