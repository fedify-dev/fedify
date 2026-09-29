---
description: >-
  The Context object is a container that holds the information of the current
  request.  This section explains the key features of the Context object.
---

Context
=======

The `Context` object is a container that holds the information of the current
request.  It is passed to various callback functions that are registered to
the `Federation` object, and also can be gathered from the outside of the
callbacks.

The key features of the `Context` object are as follows:

 -  Carrying [`TContextData`](./federation.md#tcontextdata)
 -  [Building the object URIs](#building-the-object-uris)
    (e.g., actor URIs, shared inbox URI)
 -  [Dispatching Activity Vocabulary objects](#dispatching-objects)
 -  Getting the current HTTP request
 -  [Enqueuing an outgoing activity](#enqueuing-an-outgoing-activity)
 -  [Getting a `DocumentLoader`](#getting-a-documentloader)
 -  [Looking up remote objects](#looking-up-remote-objects)
 -  [NodeInfo client](./nodeinfo.md#nodeinfo-client)

For advanced helpers—URI parsing, manual activity routing, signature
introspection, and authenticated document loading—see the
[*Advanced context helpers*](./context-advanced.md) guide.


Where to get a `Context` object
-------------------------------

You can get a `Context` object from the first parameter of most of the callbacks
that are registered to the `Federation` object.  The following shows a few
callbacks that take a `Context` object as the first parameter:

 -  [Actor dispatcher](./actor.md)
 -  [Inbox listeners](./inbox.md)
 -  [Outbox listeners](./outbox.md)
 -  [Outbox collection dispatcher](./collections.md#outbox)
 -  [Inbox collection dispatcher](./collections.md#inbox)
 -  [Following collection dispatcher](./collections.md#following)
 -  [Followers collection dispatcher](./collections.md#followers)
 -  [Liked collection dispatcher](./collections.md#liked)
 -  [Featured collection dispatcher](./collections.md#featured)
 -  [Featured tags collection dispatcher](./collections.md#featured-tags)
 -  [NodeInfo dispatcher](./nodeinfo.md)

Those are not all; there are more callbacks that take a `Context` object.

You can also get a `Context` object from the `Federation` object by calling the
`~Federation.createContext()` method.  The following shows an example:

~~~~ typescript twoslash
// @noErrors
import { type Federation } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
// ---cut-before---
import { federation } from "../federation.ts"; // Import the `Federation` object

export async function handler(request: Request) {
  const ctx = federation.createContext(request, undefined);  // [!code highlight]
  // Work with the `ctx` object...
};
~~~~


Getting the base URL
--------------------

*This API is available since Fedify 0.12.0.*

The `Context` object has properties to get the base URL of the current request:

| Property                  | Description                                              | Value example              |
| ------------------------- | -------------------------------------------------------- | -------------------------- |
| `Context.hostname`        | A hostname                                               | `"example.com"`            |
| `Context.host`            | A hostname followed by an optional port                  | `"example.com:88"`         |
| `Context.origin`          | A scheme followed by a host                              | `"https://example.com:88"` |
| `Context.canonicalOrigin` | An explicitly configured `~FederationOptions.origin`[^1] | `"https://example.com"`    |

For `RequestContext`, there is an additional property named
`~RequestContext.url` that contains the full URL of the current request.

[^1]: If no canonical origin is explicitly configured, it is the same as the
      `Context.origin`. See also the [*Explicitly setting the canonical origin*
      section](./federation.md#explicitly-setting-the-canonical-origin) in the
      *Federation* document.


Building the object URIs
------------------------

The `Context` object has a few methods to build the object URIs.  The following
shows the methods:

 -  `~Context.getNodeInfoUri()`
 -  `~Context.getActorUri()`
 -  `~Context.getPortableActorUri()`
 -  `~Context.getObjectUri()`
 -  `~Context.getPortableObjectUri()`
 -  `~Context.getInboxUri()`
 -  `~Context.getPortableInboxUri()`
 -  `~Context.getOutboxUri()`
 -  `~Context.getMediaUploaderUri()`
 -  `~Context.getFollowingUri()`
 -  `~Context.getFollowersUri()`
 -  `~Context.getLikedUri()`
 -  `~Context.getFeaturedUri()`
 -  `~Context.getFeaturedTagsUri()`

You could hard-code the URIs, but it is better to use those methods to build
the URIs because the URIs are subject to change in the future.

Here's an example of using the `~Context.getActorUri()` method in the actor
dispatcher:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
interface User { }
const user: User | null = true ? { } : null;
// ---cut-before---
federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
  // Work with the database to find the actor by the identifier.
  if (user == null) return null;
  return new Person({
    id: ctx.getActorUri(identifier),  // [!code highlight]
    preferredUsername: identifier,
    // Many more properties...
  });
});
~~~~

On the other way around, you can use the `~Context.parseUri()` method to
determine the type of the URI and extract the identifier or other values from
the URI.

### Portable IDs

*This API is available since Fedify 2.4.0.*

An [FEP-ef61] portable actor or object has an ID whose authority is a [DID]
instead of a host name, e.g., `ap+ef61://did:key:z6Mk.../users/alice`, so that
it is not tied to a server.  The following methods build such portable IDs
from the same paths as their counterparts above:

`~Context.getPortableActorUri()`
:   The portable ID of an actor, with the path of `~Context.getActorUri()`.

`~Context.getPortableObjectUri()`
:   The portable ID of an object, with the path of `~Context.getObjectUri()`.

`~Context.getPortableInboxUri()`
:   The portable ID of an actor's inbox, with the path of
    `~Context.getInboxUri()`.

`~Context.getPortableOutboxUri()`
:   The portable ID of an actor's outbox, with the path of
    `~Context.getOutboxUri()`.

`~Context.getPortableFollowingUri()`
:   The portable ID of an actor's following collection, with the path of
    `~Context.getFollowingUri()`.

`~Context.getPortableFollowersUri()`
:   The portable ID of an actor's followers collection, with the path of
    `~Context.getFollowersUri()`.

`~Context.getPortableLikedUri()`
:   The portable ID of an actor's liked collection, with the path of
    `~Context.getLikedUri()`.

`~Context.getPortableFeaturedUri()`
:   The portable ID of an actor's featured collection, with the path of
    `~Context.getFeaturedUri()`.

`~Context.getPortableFeaturedTagsUri()`
:   The portable ID of an actor's featured tags collection, with the path of
    `~Context.getFeaturedTagsUri()`.

`~Context.getPortableCollectionUri()`
:   The portable ID of a custom collection, with the path of
    `~Context.getCollectionUri()`.

They take the DID that controls the actor or object as their last argument.
Portable objects are authenticated by Object Integrity Proofs, so the DID is
usually a `did:key` DID made from the Ed25519 public key that signs them.
The `exportDidKey()` function from `@fedify/vocab-runtime` makes one; store it
along with the actor rather than taking it from a request:

~~~~ typescript twoslash
import { type Context, signObject } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
import { exportDidKey, formatIri } from "@fedify/vocab-runtime";
const ctx = null as unknown as Context<void>;
const { publicKey, privateKey } = await crypto.subtle.generateKey(
  "Ed25519",
  true,
  ["sign", "verify"],
) as CryptoKeyPair;
// ---cut-before---
const did = await exportDidKey(publicKey);  // did:key:z6Mk...
const id = ctx.getPortableActorUri("alice", did);
console.log(formatIri(id));  // ap+ef61://did:key:z6Mk.../users/alice

// The proof has to be made with a key of the same DID:
const keyId = new URL(`${did}#${did.slice("did:key:".length)}`);
const actor = await signObject(
  new Person({
    id,
    inbox: ctx.getPortableInboxUri("alice", did),
    outbox: ctx.getPortableOutboxUri("alice", did),
    followers: ctx.getPortableFollowersUri("alice", did),
    gateways: [new URL("https://example.com")],
  }),
  privateKey,
  keyId,  // did:key:z6Mk...#z6Mk...
);
~~~~

A few things to note about them:

 -  The DID has to be a bare DID, without a path, query, or fragment.
    A `did:key` DID has to be encoded in base58-btc, i.e., start with
    `did:key:z`, as FEP-ef61 requires, so that the same key does not yield
    two different IDs; `exportDidKey()` always makes such DIDs.  The gateway
    endpoint responds with `400 Bad Request` to requests whose path has
    a `did:key` DID in another encoding.  Other DID
    methods are only checked for their syntax, which does not mean that
    Fedify can verify proofs made by them.
 -  While an actor dispatcher, an object dispatcher, or a collection
    dispatcher is handling a request through the FEP-ef61 gateway endpoint,
    i.e.,
    `~RequestContext.portableRequest` is set, the DID can be omitted, and
    the one in the request path is used.  It is anyone's to choose, though,
    so it is not evidence that this server hosts anything for the DID.
    Elsewhere, the DID is required.
 -  The returned `URL` keeps the DID percent-encoded, e.g.,
    `ap+ef61://did%3Akey%3Az6Mk.../users/alice`, as the `URL` class cannot
    represent the canonical form.  Generated vocabulary classes serialize
    it in the canonical form, and `formatIri()` from `@fedify/vocab-runtime`
    returns the canonical string.
 -  They build portable IDs only.  To get the *compatible identifier* of
    a portable ID on a gateway, an HTTP(S) URL for software that does not
    support portable IDs, use `toCompatibleEf61Id()` from
    `@fedify/vocab-runtime`.
 -  The other way around, `~Context.parseUri()` recognizes portable IDs and
    compatible identifiers when the `portable` option is enabled; see the
    [*Portable IDs* section](./context-advanced.md#portable-ids) of
    *Advanced context helpers*.

Portable actors and objects with such IDs can be served by the same
dispatchers through the gateway endpoint; see the [*Portable actors and
WebFinger* section](./actor.md#portable-actors-and-webfinger), the [*Serving
portable objects* section](./object.md#serving-portable-objects), the
[*Portable collections* section](./collections.md#portable-collections), and
the [*Portable inboxes* section](./inbox.md#portable-inboxes).

[FEP-ef61]: https://w3id.org/fep/ef61
[DID]: https://www.w3.org/TR/did-core/


Enqueuing an outgoing activity
------------------------------

The `Context` object can enqueue an outgoing activity to the actor's outbox
by calling the `~Context.sendActivity()` method.  The following shows an
example in an [inbox listener](./inbox.md):

~~~~ typescript{12-16} twoslash
import { type Federation } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
// ---cut-before---
import { Accept, Follow } from "@fedify/vocab";

federation
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
  .on(Follow, async (ctx, follow) => {
    // In order to send an activity, we need the identifier of the sender actor:
    if (follow.id == null || follow.objectId == null) return;
    const parsed = ctx.parseUri(follow.objectId);
    if (parsed?.type !== "actor") return;
    const recipient = await follow.getActor(ctx);
    if (recipient == null) return;
    await ctx.sendActivity(
      { identifier: parsed.identifier }, // sender
      recipient,
      new Accept({ actor: follow.objectId, object: follow.id }),
    );
  });
~~~~

For more information about this topic, see the [*Sending activities*
section](./send.md).

> [!NOTE]
> The `~Context.sendActivity()` method works only if the [key pairs dispatcher]
> is registered to the `Federation` object.  If the key pairs dispatcher is not
> registered, the `~Context.sendActivity()` method throws an error.

> [!TIP]
> Why do you need to enqueue an outgoing activity, instead of directly sending
> the activity to the recipient's inbox?  The reason is that in distributed
> systems, we need to consider the delivery failure.  If the delivery fails,
> the system needs to retry the delivery.  Delivery failure can happen for
> various reasons, such as network failure, recipient server failure, and so on.
>
> Anyway, you don't have to worry about the delivery failure because the
> Fedify handles the delivery failure by enqueuing the outgoing
> activity to the actor's outbox and retrying the delivery on failure.

[key pairs dispatcher]: ./actor.md#public-keys-of-an-actor


Dispatching objects
-------------------

*This API is available since Fedify 0.7.0.*

The `RequestContext` object has a method to dispatch an Activity Vocabulary
object from the URL arguments.  The following shows an example of using
the `RequestContext.getActor()` method:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Update } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
const request = new Request("");
const identifier: string = "";
// ---cut-before---
const ctx = federation.createContext(request, undefined);
const actor = await ctx.getActor(identifier);  // [!code highlight]
if (actor != null) {
  await ctx.sendActivity(
    { identifier },
    "followers",
    new Update({ actor: actor.id, object: actor }),
  );
}
~~~~

By default, `RequestContext.getActor()` suppresses tombstoned actors and returns
`null` for them.  If you need to distinguish a deleted actor from a missing
identifier, pass `{ tombstone: "passthrough" }`:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Tombstone } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
const request = new Request("");
const identifier: string = "";
// ---cut-before---
const ctx = federation.createContext(request, undefined);
const actor = await ctx.getActor(identifier, {
  tombstone: "passthrough",
});
if (actor instanceof Tombstone) {
  console.log(
    `${identifier} was deleted at ${actor.deleted} ` +
      `(former type: ${actor.formerType?.name ?? "unknown"})`,
  );
}
~~~~

> [!NOTE]
> The `RequestContext.getActor()` method is only available when the actor
> dispatcher is registered to the `Federation` object.  If the actor dispatcher
> is not registered, the `RequestContext.getActor()` method throws an error.

In the same way, you can use the `RequestContext.getObject()` method to dispatch
an object from the URL arguments.  The following shows an example:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Note } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
const request = new Request("");
const identifier: string = "";
const id: string = "";
// ---cut-before---
const ctx = federation.createContext(request, undefined);
const note = await ctx.getObject(Note, { identifier, id });  // [!code highlight]
~~~~

Like `RequestContext.getActor()`, `RequestContext.getObject()` returns `null`
for an object that the object dispatcher represents as deleted by returning
a `Tombstone`.  If you need to distinguish a deleted object from a missing one,
pass `{ tombstone: "passthrough" }`:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { Note, Tombstone } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
const request = new Request("");
const identifier: string = "";
const id: string = "";
// ---cut-before---
const ctx = federation.createContext(request, undefined);
const note = await ctx.getObject(Note, { identifier, id }, {
  tombstone: "passthrough",
});
if (note instanceof Tombstone) {
  console.log(`The note was deleted at ${note.deleted}`);
}
~~~~

A tombstone is returned even without the option if it is an instance of
the requested class, i.e., if you get an object of the `Object` or `Tombstone`
class itself, since it is a valid object of that class.  For example, if the
object dispatcher for `Object` returns either notes or tombstones,
`ctx.getObject(Object, values)` returns tombstones as well; check the result
with `instanceof Tombstone` in that case.


Getting a `DocumentLoader`
--------------------------

The `Context.documentLoader` property carries a `DocumentLoader` object that
is specified in the `Federation` constructor.  It is used to load remote
documents and contexts in the JSON-LD format.  There are a few methods to take
a `DocumentLoader` as an option in vocabulary API:

 -  [`fromJsonLd()` static method](./vocab.md#json-ld)
 -  [`toJsonLd()` method](./vocab.md#json-ld)
 -  [`get*()` dereferencing accessors](./vocab.md#object-ids-and-remote-objects)
 -  [`lookupObject()` function](./vocab.md#looking-up-remote-objects)

All of those methods take options in the form of
`{ documentLoader?: DocumentLoader, contextLoader?: DocumentLoader }` which is
compatible with `Context`.  So you can just pass a `Context` object to those
methods:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
import { Object } from "@fedify/vocab";
const ctx = null as unknown as Context<void>;
const jsonLd: unknown = {};
// ---cut-before---
const object = await Object.fromJsonLd(jsonLd, ctx);
const json = await object.toJsonLd(ctx);
~~~~


Getting an authenticated `DocumentLoader`
-----------------------------------------

*This API is available since Fedify 0.4.0.*

Sometimes you need to load a remote document which requires authentication,
such as an actor's following collection that is configured as private.
In such cases, you can use the `Context.getDocumentLoader()` method to get
an authenticated `DocumentLoader` object.  The following shows an example:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
import { type Actor, Person } from "@fedify/vocab";
const ctx = null as unknown as Context<void>;
const actor = new Person({}) as Actor;
// ---cut-before---
const documentLoader = await ctx.getDocumentLoader({
  identifier: "2bd304f9-36b3-44f0-bf0b-29124aafcbb4",
});
const following = await actor.getFollowing({ documentLoader });
~~~~

In the above example, the `getFollowing()` method takes the `documentLoader`
which is authenticated as the actor with an identifier of
`2bd304f9-36b3-44f0-bf0b-29124aafcbb4`.  If the `actor` allows
actor `2bd304f9-36b3-44f0-bf0b-29124aafcbb4` to see the following collection,
the `getFollowing()` method returns the following collection.

> [!TIP]
> Inside a personal inbox listener, the `Context.documentLoader` property is
> automatically set to an authenticated `DocumentLoader` object that is
> identified by the inbox owner's key.  So you don't need to call the
> `Context.getDocumentLoader()` method in the personal inbox listener,
> but just passing the `Context` object to dereferencing accessors is enough.
>
> See the [*`Context.documentLoader` on an inbox listener*
> section](./inbox.md#context-documentloader-on-an-inbox-listener) for details.


Document loader vs. context loader
----------------------------------

Both a document loader and a context loader are represented by `DocumentLoader`
type, but they are used for different purposes:

 -  A <dfn>document loader</dfn> is used to load remote documents,
    such as an actor's profile document, an object document, and so on.

 -  A <dfn>context loader</dfn> is used to load remote contexts,
    such as the ActivityStreams context, the W3C security context, and so on.

Sometimes a document loader needs to be authenticated to load a remote document
which requires authorization, but a context loader mostly needs to be highly
cached and doesn't require authorization.

### Response size limits

Since Fedify 2.0.28, the built-in document loaders limit each remote JSON body
to 16 MiB of decoded bytes.  This includes actor and object documents,
HTTP-signature keys, and JSON-LD contexts, whether fetched with or without
HTTP authentication.  HTML alternate-link discovery is limited to 1 MiB.
The limits apply while reading the stream, including after decompression,
before JSON parsing or caching.  An oversized document raises `FetchError`.

Inbox request bodies are also limited to 16 MiB and receive HTTP 413 when
too large, before JSON parsing or signature verification.

Custom document loaders are responsible for enforcing their own response
size limits.

### Timeouts

*This API is available since Fedify 2.4.0.*

The built-in document loaders time out each call after 10 seconds by default.
The time limit covers the whole call: URL validation, every redirect and
alternate document link it follows, double-knocking retries of
the authenticated document loader, and reading the response body.  So a remote
server that responds slowly or never cannot hold a request of yours, e.g.,
an incoming activity whose signature key Fedify fetches, for longer than that.

A call that times out throws a `FetchError` without a `~FetchError.response`,
whose `cause` is a `DOMException` named `"TimeoutError"`:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
import { FetchError } from "@fedify/vocab-runtime";
const ctx = null as unknown as Context<void>;
// ---cut-before---
try {
  await ctx.documentLoader("https://example.com/slow-object");
} catch (error) {
  if (
    error instanceof FetchError &&
    error.cause instanceof DOMException &&
    error.cause.name === "TimeoutError"
  ) {
    console.error("Timed out:", error.url.href);
  }
}
~~~~

Such a failure is treated like other network failures.  For example, if
fetching the key of an HTTP Signature times out, `verifyRequestDetailed()`
reports it as a `keyFetchError`, and the failure is cached like other failures
to fetch a key.  Note that a cached failure keeps only the error's name and
message, not its `cause`.

An `AbortSignal` passed as the `signal` option still cancels a call; the loader
then throws the signal's reason instead of a `FetchError`.

You can change the time limit with the [`documentLoaderTimeout`
option](./federation.md#documentloadertimeout) of `createFederation()`, or
the `timeout` option (in milliseconds) of `getDocumentLoader()` and
`getAuthenticatedDocumentLoader()`.  Setting it to `null` turns the timeout
off.  Custom document loaders are responsible for their own timeouts.


Looking up remote objects
-------------------------

*This API is available since Fedify 0.15.0.*

> [!TIP]
> In most cases, you don't need to look up remote objects explicitly.
> Instead, you can use the dereferencing accessors to fetch the remote objects
> implicitly.
>
> For example, you can get the `object` from an `Activity` object directly:
>
> ~~~~ typescript twoslash
> import { Activity } from "@fedify/vocab";
> const activity = new Activity({});
> // ---cut-before---
> const object = await activity.getObject();
> ~~~~
>
> … instead of:
>
> ~~~~ typescript twoslash
> import { type Context } from "@fedify/fedify";
> import { Activity } from "@fedify/vocab";
> const ctx = null as unknown as Context<void>;
> const activity = new Activity({});
> // ---cut-before---
> const object = activity.objectId == null
>   ? null
>   : await ctx.lookupObject(activity.objectId);
> ~~~~

Suppose your app has a search box that allows the user to look up a fediverse
user by the handle or a post by the URI.  In such cases, you need to look up
the object from a remote server that your app haven't interacted with yet.
The `Context.lookupObject()` method plays a role in such cases.  The following
shows an example of looking up an actor object from the handle:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
// ---cut-before---
const actor = await ctx.lookupObject("@hongminhee@todon.eu");
~~~~

In the above example, the `~Context.lookupObject()` method queries the remote
server's WebFinger endpoint to get the actor's URI from the handle,
and then fetches the actor object from the URI.

> [!TIP]
> The `~Context.lookupObject()` method accepts a fediverse handle without
> prefix `@` as well:
>
> ~~~~ typescript twoslash
> import { type Context } from "@fedify/fedify";
> const ctx = null as unknown as Context<void>;
> // ---cut-before---
> const actor = await ctx.lookupObject("hongminhee@todon.eu");
> ~~~~
>
> Also an `acct:` URI:
>
> ~~~~ typescript twoslash
> import { type Context } from "@fedify/fedify";
> const ctx = null as unknown as Context<void>;
> // ---cut-before---
> const actor = await ctx.lookupObject("acct:hongminhee@todon.eu");
> ~~~~

The `~Context.lookupObject()` method is not limited to the actor object.
It can look up any object in the Activity Vocabulary.  For example
the following shows an example of looking up a `Note` object from the URI:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
// ---cut-before---
const note = await ctx.lookupObject(
  "https://todon.eu/@hongminhee/112060633798771581"
);
~~~~

> [!NOTE]
> Some objects require authentication to look up, such as a `Note` object with
> a visibility of followers-only.  In such cases, you need to use
> the `Context.getDocumentLoader()` method to get an authenticated
> `DocumentLoader` object.  The `~Context.lookupObject()` method takes the
> `documentLoader` option to specify the method to fetch the remote object:
>
> ~~~~ typescript twoslash
> import { type Context } from "@fedify/fedify";
> const ctx = null as unknown as Context<void>;
> // ---cut-before---
> const documentLoader = await ctx.getDocumentLoader({ identifier: "john" });
> const note = await ctx.lookupObject("...", { documentLoader });
> ~~~~
>
> See the [*Getting an authenticated
> `DocumentLoader`*](#getting-an-authenticated-documentloader)
> section for details.

> [!CAUTION]
> For security reasons, the `~Context.lookupObject()` method implements
> origin-based validation following [FEP-fe34].  If the fetched JSON-LD
> document contains an `@id` that has a different origin than the requested
> URL, the method will return `null` by default to prevent content spoofing
> attacks.
>
> For example, if you request `https://example.com/notes/123` but the fetched
> document has `@id: "https://malicious.com/notes/456"`, the method will
> refuse to return the object and log a warning instead.
> For portable `ap:`/`ap+ef61:` IDs and DID URLs, Fedify compares the
> cryptographic DID origin rather than an HTTP origin.
>
> You can control this behavior using the `crossOrigin` option:
>
> ~~~~ typescript twoslash
> import { type Context } from "@fedify/fedify";
> const ctx = null as unknown as Context<void>;
> // ---cut-before---
> // Default behavior: return null for cross-origin objects (recommended)
> const objectDefault = await ctx.lookupObject("https://example.com/notes/123");
>
> // Throw an error when encountering cross-origin objects
> const objectStrict = await ctx.lookupObject(
>   "https://example.com/notes/123",
>   { crossOrigin: "throw" }
> );
>
> // Bypass origin checks (not recommended, potential security risk)
> const objectBypass = await ctx.lookupObject(
>   "https://example.com/notes/123",
>   { crossOrigin: "trust" }
> );
> ~~~~
>
> Only use `crossOrigin: "trust"` if you fully understand the security
> implications and have implemented additional validation measures.

[FEP-fe34]: https://w3id.org/fep/fe34

### Portable objects

*This API is available since Fedify 2.4.0.*

The `~Context.lookupObject()` method also looks up [FEP-ef61] portable objects,
whose IDs are `ap:` or `ap+ef61:` URIs with a [DID] instead of a host, e.g.,
`ap://did:key:z6Mk.../actor`.  A portable object is not served from its ID,
but from *gateways*, so the method fetches it through gateways in the same way
as [dereferencing accessors](./vocab.md#dereferencing-portable-references):

 -  A portable ID is fetched through the gateways in its `@gateway` location
    hints, e.g.,
    `ap://did:key:z6Mk.../actor?@gateway=https%3A%2F%2Fexample.com`.
 -  A compatible identifier, e.g.,
    `https://example.com/.well-known/apgateway/did:key:z6Mk.../actor`, is
    fetched through the gateway it names.
 -  When a fediverse handle of a [portable
    actor](./actor.md#portable-actors-and-webfinger) is looked up, the `self`
    link of the WebFinger response can be either of them.  A portable ID is
    fetched through the WebFinger server first, as it is the actor's first
    gateway, and then through the location hints.

In every case, the fetched object is returned only if its `@id` identifies the
requested portable object and it has a valid [Object Integrity
Proof](./send.md#object-integrity-proofs) made by the DID in its ID, since
a portable object belongs to its DID, not to the server that serves it.
`Context.lookupObject()` applies `~Context.verifyPortableObject`, i.e.,
`verifyPortableObject()`, by default, which also accepts a collection without
a proof if a gateway that its owner lists serves it (see [*Portable
collections*](./vocab.md#portable-collections)); pass the
`verifyPortableObject` option to use another policy, e.g.,
`verifyPortableObjectProof()` to accept only objects with proofs.  The returned
object uses the same policy by default when its accessors dereference its
properties (see [*Default verifiers*](./vocab.md#default-verifiers)).  If
a gateway returns an object that fails these checks, the next candidate is
tried; `crossOrigin: "throw"` makes the method throw an error instead, and
`crossOrigin: "trust"` does not skip the checks.  To limit the number of
servers a single lookup reaches, the method asks at most five gateways.

The same checks apply to a document looked up by an ordinary HTTP(S) URL if it
turns out to be a portable object: if it is served from a compatible
identifier after redirects, or its `@id` is a portable ID, it is returned only
if it passes them, instead of being trusted because of where it came from.

> [!NOTE]
> The `lookupObject()` function from `@fedify/vocab` does not look up portable
> objects unless you pass the `verifyPortableObject` option, e.g.,
> `verifyPortableObject` from `@fedify/fedify`.  Without it, compatible
> identifiers are fetched as ordinary HTTP(S) URLs, and an object with
> a portable ID served there is refused as a cross-origin object, even with
> `crossOrigin: "trust"`.


WebFinger lookups
-----------------

*This API is available since Fedify 1.6.0.*

The `Context` provides a dedicated method for WebFinger lookups when you need
to find information about accounts and resources across federated networks.
The `~Context.lookupWebFinger()` method allows you to query a remote server's
WebFinger endpoint directly:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
// ---cut-before---
const webfingerData = await ctx.lookupWebFinger("acct:fedify@hollo.social");
~~~~

If the lookup fails or the account doesn't exist, the method returns `null`.
The returned WebFinger document contains links to various resources associated
with the account, such as profile pages, ActivityPub actor URIs, and more:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
// ---cut-before---
const webfingerData = await ctx.lookupWebFinger("acct:fedify@hollo.social");

// Find the ActivityPub actor URI
const activityPubActorLink = webfingerData?.links?.find(link =>
  link.rel === "self" && link.type === "application/activity+json"
);

if (activityPubActorLink?.href) {
  const actor = await ctx.lookupObject(activityPubActorLink.href);
  // Work with the actor...
}
~~~~

> [!NOTE]
> In most cases, you can use the higher-level `~Context.lookupObject()` method
> which automatically performs WebFinger lookups when given a handle.
> Use `~Context.lookupWebFinger()` when you need the raw WebFinger data or
> want more direct control over the lookup process.


Traversing remote collections
-----------------------------

*This API is available since Fedify 1.1.0.*

Sometimes you need to traverse a remote collection from the beginning
to the end, such as an actor's outbox, an actor's followers collection,
and so on.  The `Context.traverseCollection()` method plays a role in such
cases.  The following shows an example of traversing an actor's outbox:

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
      console.log(activity);
    }
  }
}
~~~~


Replacing the context data
--------------------------

*This API is available since Fedify 1.6.0.*

You can replace the context data by calling the `Context.clone()` method.
This is useful when you want to create a new context based on the existing one
but with different data.  The following shows an example of replacing the
context data:

~~~~ typescript twoslash
import { type Context } from "@fedify/fedify";
const ctx = null as unknown as Context<{ foo: string; bar: number }>;
// ---cut-before---
const newCtx = ctx.clone({ ...ctx.data, foo: "new value" });
~~~~
