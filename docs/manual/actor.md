---
description: >-
  You can register an actor dispatcher so that Fedify can dispatch
  an appropriate actor by its identifier.  This section explains
  how to register an actor dispatcher and the key properties of an actor.
---

Actor dispatcher
================

In ActivityPub, [actors] are entities that can perform [activities].  You can
register an actor dispatcher so that Fedify can dispatch an appropriate actor
by its identifier.  Since the actor dispatcher is the most significant part of
Fedify, it is the first thing you need to do to make Fedify work.

An actor dispatcher is a callback function that takes a `Context` object and
an identifier, and returns an actor object, a `Tombstone`, or `null`.
Live actor objects can be one of the following:

 -  `Application`
 -  `Group`
 -  `Organization`
 -  `Person`
 -  `Service`

The below example shows how to register an actor dispatcher:

~~~~ typescript{8-16} twoslash
// @noErrors: 2451 2345
import type { Federation } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
interface User { }
const user = null as User | null;
// ---cut-before---
import { createFederation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";

const federation = createFederation({
  // Omitted for brevity; see the related section for details.
});

federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
  // Work with the database to find the actor by the identifier.
  if (user == null) return null;  // Return null if the actor is not found.
  return new Person({
    id: ctx.getActorUri(identifier),
    preferredUsername: identifier,
    // Many more properties; see the next section for details.
  });
});
~~~~

In the above example, the `~Federatable.setActorDispatcher()` method registers
an actor dispatcher for the `/users/{identifier}` path.  This pattern syntax
follows the [URI Template] specification.

If the actor exists but should be represented as deleted, return a `Tombstone`
instead of `null`:

~~~~ typescript twoslash
// @noErrors: 2345
import { type Federation } from "@fedify/fedify";
import { Person, Tombstone } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
const deletedAt = Temporal.Instant.from("2024-01-15T00:00:00Z");
// ---cut-before---
federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
  if (identifier !== "alice") return null;
  return new Tombstone({
    id: ctx.getActorUri(identifier),
    formerType: Person,
    deleted: deletedAt,
  });
});
~~~~

When an actor dispatcher returns a `Tombstone`, Fedify responds from the actor
endpoint with `410 Gone` and the serialized tombstone body.  WebFinger for the
same account also responds with `410 Gone`.  If you know the deleted actor's
former Fedify entity class, set `formerType` so the tombstone preserves the
original ActivityStreams type.

Use `null` only when the identifier is not handled at all and the request
should fall through to the next middleware or `onNotFound` handler.

> [!TIP]
> By registering the actor dispatcher, `Federation.fetch()` automatically
> deals with [WebFinger] requests for the actor.

> [!TIP]
> By default, Fedify assumes that the actor's identifier is the WebFinger
> username.  If you want to decouple the WebFinger username from the actor's
> identifier, you can register an actor handle mapper through the
> `~ActorCallbackSetters.mapHandle()` method.
>
> See the [next section](#decoupling-actor-uris-from-webfinger-usernames)
> for details.

> [!NOTE]
> The URI Template syntax supports different expansion types like `{identifier}`
> (simple expansion) and `{+identifier}` (reserved expansion).  Use the plain
> `{identifier}` form for ordinary segment-bounded identifiers such as
> `/users/{identifier}`.  `{+identifier}` is an advanced choice reserved for
> identifiers that themselves contain slashes (such as embedded URIs); because
> it keeps `/` literal, it can consume extra path segments and overlap with
> more specific routes.  See the [*URI Template* guide](./uri-template.md) for
> details on when to use each type.

[actors]: https://www.w3.org/TR/activitystreams-core/#actors
[activities]: https://www.w3.org/TR/activitystreams-core/#activities
[URI Template]: https://datatracker.ietf.org/doc/html/rfc6570
[WebFinger]: https://datatracker.ietf.org/doc/html/rfc7033


Actor identifier and WebFinger username
---------------------------------------

An actor *identifier* is a unique string that identifies the actor.  It can be
a username, a UUID, or any other unique string.  The actor identifier is used
as a URL parameter in the actor dispatcher and other dispatchers.  It's usually
used to find the actor in your database, i.e., primary key.

A WebFinger *username* is a string that comes before the domain part of the
fediverse handle, e.g., `hongminhee` in `@hongminhee@fosstodon.org`.
The WebFinger username is also used as the `preferredUsername` property of
the actor.  It's usually displayed in the user interface, and used to find
the actor by the WebFinger protocol, i.e., looking up the fediverse handle
in the search box.  It's also called the *bare handle*.

By default, Fedify assumes that the actor's identifier is the WebFinger
username, but you can decouple the WebFinger username from the actor's
identifier if you want.   You can think of the difference between these two
approaches as analogous to [natural key] vs. [surrogate key] in the database
design.

There are pros and cons to using the WebFinger username as the actor's
identifier (which is Fedify's default):

Pros
:    -  The actor URI is more predictable and human-readable,
        which makes debugging easier.
     -  The internal ID of the actor can be hidden from the public.

Cons
:    -  Changing the WebFinger username may break the existing network.
        Hence, the fediverse handle is immutable in practice.
     -  It's usually treated as an anti-pattern in the fediverse.

You need to choose the best approach for your use case before implementing the
actor dispatcher.  If you decide to use the WebFinger username as the actor's
identifier, there's nothing to do—Fedify assumes it by default.

If you decide to decouple the WebFinger username from the actor's identifier,
see the [next section](#decoupling-actor-uris-from-webfinger-usernames) for
details.

[natural key]: https://en.wikipedia.org/wiki/Natural_key
[surrogate key]: https://en.wikipedia.org/wiki/Surrogate_key


Key properties of an `Actor`
----------------------------

Although ActivityPub declares every property of an actor as optional,
in practice, you need to set some of them to make the actor work properly
with the existing ActivityPub implementations.  The following shows
the key properties of an `Actor` object:

### `id`

The `~Object.id` property is the URI of the actor.  It is a required property
in ActivityPub.  You can use the `Context.getActorUri()` method to generate
the dereferenceable URI of the actor by its identifier.

### `preferredUsername`

The `preferredUsername` property is the WebFinger username of the actor.
Unless [you decouple the WebFinger username from the actor's
identifier](#decoupling-actor-uris-from-webfinger-usernames), it is okay to
set the `preferredUsername` property to the actor's identifier.

### `name`

The `~Object.name` property is the full name of the actor.

### `summary`

The `~Object.summary` property is usually a short biography of the actor.

### `url`

The `~Object.url` property usually refers to the actor's profile page.

### `published`

The `~Object.published` property is the date and time when the actor was
created.  Note that Fedify represents the date and time in
the [`Temporal.Instant`] value.

[`Temporal.Instant`]: https://tc39.es/proposal-temporal/docs/instant.html

### `inbox`

The `inbox` property is the URI of the actor's inbox.  You can use
the `Context.getInboxUri()` method to generate the URI of the actor's
inbox.

See the [*Inbox listeners*](./inbox.md) section for details.

### `outbox`

The `outbox` property is the URI of the actor's outbox.  You can use
the `Context.getOutboxUri()` method to generate the URI of the actor's
outbox.

### `followers`

The `followers` property is the URI of the actor's followers collection.
You can use the `Context.getFollowersUri()` method to generate the URI of
the actor's followers collection.

### `following`

The `following` property is the URI of the actor's following collection.
You can use the `Context.getFollowingUri()` method to generate the URI of
the actor's following collection.

### `endpoints`

The `endpoints` property is an `Endpoints` instance, an object that contains
the URIs of the actor's endpoints.  The most important endpoint is the
`sharedInbox`.  You can use the `Context.getInboxUri()` method with no
arguments to generate the URI of the actor's shared inbox:

~~~~ typescript twoslash
import { Context } from "@fedify/fedify";
import { Endpoints } from "@fedify/vocab";
const ctx = null as unknown as Context<void>;
// ---cut-before---
new Endpoints({ sharedInbox: ctx.getInboxUri() })
~~~~

If you register a media uploader with `Federation.setMediaUploader()`, advertise
it here too, under the `uploadMedia` endpoint, using the
`Context.getMediaUploaderUri()` method.  See the [*Media upload*][media-upload]
guide for details.

[media-upload]: ./media-upload.md

### `publicKey`

The `publicKey` property contains the public key of the actor.  It is
a `CryptographicKey` instance.  This property is usually used for verifying
[HTTP Signatures](./send.md#http-signatures).

See the [next section](#public-keys-of-an-actor) for details.

> [!TIP]
> In theory, an actor has multiple `publicKeys`, but in practice, most
> implementations have trouble with multiple keys.  Therefore, it is recommended
> to set only one key in the `publicKey` property.  Usually, it contains
> the first RSA-PKCS#1-v1.5 public key of the actor.
>
> If you need to set multiple keys, you can use the `assertionMethods` property
> instead.

### `assertionMethods`

*This API is available since Fedify 0.10.0.*

The `assertionMethods` property contains the public keys of the actor.  It is
an array of `Multikey` instances.  This property is usually used for verifying
[Object Integrity Proofs](./send.md#object-integrity-proofs).

> [!TIP]
> Usually, the `assertionMethods` property contains the Ed25519 public keys of
> the actor.  Although it is okay to include RSA-PKCS#1-v1.5 public keys too,
> those RSA-PKCS#1-v1.5 keys are not used for verifying Object Integrity Proofs.


Public keys of an `Actor`
-------------------------

In order to sign and verify the activities, you need to set the `publicKey` and
`assertionMethods` property of the actor.  The `publicKey` property contains
a `CryptographicKey` instance, and the `assertionMethods` property contains
an array of `Multikey` instances.  Usually you don't have to create them
manually.  Instead, you can register a key pairs dispatcher through
the `~ActorCallbackSetters.setKeyPairsDispatcher()` method so that Fedify can
dispatch appropriate key pairs by the actor's identifier:

~~~~ typescript{4-6,10-14,17-26} twoslash
import { type Federation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
interface User {}
const user = null as User | null;
const publicKey1 = null as unknown as CryptoKey;
const privateKey1 = null as unknown as CryptoKey;
const publicKey2 = null as unknown as CryptoKey;
const privateKey2 = null as unknown as CryptoKey;
// ---cut-before---
federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
  // Work with the database to find the actor by the identifier.
  if (user == null) return null;  // Return null if the actor is not found.
  // Context.getActorKeyPairs() method dispatches the key pairs of an actor
  // by the identifier, and returns an array of key pairs in various formats:
  const keys = await ctx.getActorKeyPairs(identifier);
  return new Person({
    id: ctx.getActorUri(identifier),
    preferredUsername: identifier,
    // For the publicKey property, we only use first CryptographicKey:
    publicKey: keys[0].cryptographicKey,
    // For the assertionMethods property, we use all Multikey instances:
    assertionMethods: keys.map((key) => key.multikey),
    // Many more properties; see the previous section for details.
  });
})
  .setKeyPairsDispatcher(async (ctx, identifier) => {
    // Work with the database to find the key pair by the identifier.
    if (user == null) return [];  // Return null if the key pair is not found.
    // Return the loaded key pair.  See the below example for details.
    return [
      { publicKey: publicKey1, privateKey: privateKey1 },
      { publicKey: publicKey2, privateKey: privateKey2 },
      // ...
    ];
  });
~~~~

In the above example, the `~ActorCallbackSetters.setKeyPairsDispatcher()` method
registers a key pairs dispatcher.  The key pairs dispatcher is a callback
function that takes context data and an identifier, and returns an array of
[`CryptoKeyPair`] object which is defined in the Web Cryptography API.

Usually, you need to generate key pairs for each actor when the actor is
created (i.e., when a new user is signed up), and securely store actor's key
pairs in the database.  The key pairs dispatcher should load the key pairs from
the database and return them.

How to generate key pairs and store them in the database is out of the scope of
this document, but here's a simple example of how to generate key pairs and
store them in a [Deno KV] database in form of JWK:

~~~~ typescript twoslash
const identifier: string = "";
// ---cut-before---
import { generateCryptoKeyPair, exportJwk } from "@fedify/fedify";

const kv = await Deno.openKv();
const rsaPair = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
const ed25519Pair = await generateCryptoKeyPair("Ed25519");
await kv.set(["keypair", "rsa", identifier], {
  privateKey: await exportJwk(rsaPair.privateKey),
  publicKey: await exportJwk(rsaPair.publicKey),
});
await kv.set(["keypair", "ed25519", identifier], {
  privateKey: await exportJwk(ed25519Pair.privateKey),
  publicKey: await exportJwk(ed25519Pair.publicKey),
});
~~~~

> [!TIP]
> Fedify currently supports two key types:
>
>  -  RSA-PKCS#1-v1.5 (`"RSASSA-PKCS1-v1_5"`) is used for [HTTP
>     Signatures](./send.md#http-signatures), [HTTP Message
>     Signatures](./send.md#http-message-signatures), and [Linked Data
>     Signatures](./send.md#linked-data-signatures).
>  -  Ed25519 (`"Ed25519"`) is used for [Object Integrity
>     Proofs](./send.md#object-integrity-proofs).
>
> HTTP Signatures and Linked Data Signatures are de facto standards for signing
> ActivityPub activities, and Object Integrity Proofs is a new standard for
> verifying the integrity of the objects in the fediverse.  While HTTP
> Signatures and Linked Data Signatures are widely supported in the fediverse,
> it's limited to the RSA-PKCS#1-v1.5 algorithm.
>
> If your federated app needs to support HTTP Signatures, Linked Data
> Signatures, and Object Integrity Proofs at the same time,
> you need to generate both RSA-PKCS#1-v1.5 and Ed25519 key
> pairs for each actor, and store them in the database—and we recommend
> you to support both key types.

Here's an example of how to load key pairs from the database too:

~~~~ typescript{12-34} twoslash
// @noErrors: 2345
import { type Federation } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
// ---cut-before---
import { importJwk } from "@fedify/fedify";

interface KeyPairEntry {
  privateKey: JsonWebKey;
  publicKey: JsonWebKey;
}

federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    // Omitted for brevity; see the previous example for details.
  })
  .setKeyPairsDispatcher(async (ctx, identifier) => {
    const kv = await Deno.openKv();
    const result: CryptoKeyPair[] = [];
    const rsaPair = await kv.get<KeyPairEntry>(
      ["keypair", "rsa", identifier],
    );
    if (rsaPair?.value != null) {
      result.push({
        privateKey: await importJwk(rsaPair.value.privateKey, "private"),
        publicKey: await importJwk(rsaPair.value.publicKey, "public"),
      });
    }
    const ed25519Pair = await kv.get<KeyPairEntry>(
      ["keypair", "ed25519", identifier],
    );
    if (ed25519Pair?.value != null) {
      result.push({
        privateKey: await importJwk(ed25519Pair.value.privateKey, "private"),
        publicKey: await importJwk(ed25519Pair.value.publicKey, "public"),
      });
    }
    return result;
  });
~~~~

[`CryptoKeyPair`]: https://developer.mozilla.org/en-US/docs/Web/API/CryptoKeyPair
[Deno KV]: https://deno.com/kv


Constructing actor URIs
-----------------------

To construct an actor URI, you can use the `Context.getActorUri()` method.
This method takes an identifier and returns a dereferenceable URI of the actor.

The below example shows how to construct an actor URI:

~~~~ typescript twoslash
import type { Context } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
// ---cut-before---
ctx.getActorUri("john_doe")
~~~~

In the above example, the `Context.getActorUri()` method generates the
dereferenceable URI of the actor with the identifier `"john_doe"`.

If you [decouple the WebFinger username from the actor's
identifier](#decoupling-actor-uris-from-webfinger-usernames),
you should pass the identifier that is used in the actor dispatcher to
the `Context.getActorUri()` method, not the WebFinger username:

~~~~ typescript twoslash
import type { Context } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
// ---cut-before---
ctx.getActorUri("2bd304f9-36b3-44f0-bf0b-29124aafcbb4")
~~~~

> [!NOTE]
>
> The `Context.getActorUri()` method does not guarantee that the actor
> URI is always dereferenceable for every argument.  Make sure that
> the argument is a valid identifier before calling the method.


Fixed-path actor URIs
---------------------

*This API is available since Fedify 2.3.0.*

In some cases, you may want to expose a single, instance-level actor at a fixed
path, such as `/actor` for a relay or `/bot` for a bot, without leaking a
sentinel identifier like `__instance__` into the actor's URI.

You can alias a fixed path to a sentinel identifier by calling
the `~ActorCallbackSetters.mapActorAlias()` method:

~~~~ typescript
// @noErrors: 2345 2391
import { type Federation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
// ---cut-before---
federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    if (identifier === "bot") {
      return new Person({
        id: ctx.getActorUri(identifier),
        preferredUsername: "bot",
        // ...
      });
    }
    // ...
  })
  .mapActorAlias("/bot", "bot");
~~~~

Once the alias is registered, `Context.getActorUri("bot")` will return
`https://example.com/bot` rather than `https://example.com/users/bot`.
Incoming requests to `/bot` will also correctly resolve the identifier to
`"bot"` and trigger the actor dispatcher.  WebFinger responses for the actor
will also use the fixed path for the `self` link and the aliases.

> [!TIP]
> You can map multiple fixed paths to different sentinel identifiers by calling
> the `~ActorCallbackSetters.mapActorAlias()` method multiple times.


Decoupling actor URIs from WebFinger usernames
----------------------------------------------

*This API is available since Fedify 0.15.0.*

> [!TIP]
> The WebFinger username means the username part of the `acct:` URI or
> the fediverse handle.  For example, the WebFinger username of the
> `acct:fedify@hollo.social` URI or the `@fedify@hollo.social` handle
> is `fedify`.

By default, Fedify uses the identifier as the WebFinger username.  However,
you can decouple the WebFinger username from the identifier by registering
an actor handle mapper through the `~ActorCallbackSetters.mapHandle()` method:

~~~~ typescript twoslash
// @noErrors: 2391 2345
import { type Federation } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
interface User { uuid: string; }
/**
 * It's a hypothetical function that finds a user by the UUID.
 * @param uuid The UUID of the user.
 * @returns The user object.
 */
function findUserByUuid(uuid: string): User;
/**
 * It's a hypothetical function that finds a user by the username.
 * @param username The username of the user.
 * @returns The user object.
 */
function findUserByUsername(username: string): User;
// ---cut-before---
federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    // Since we map a WebFinger username to the corresponding user's UUID below,
    // the `identifier` parameter is the user's UUID, not the WebFinger
    // username:
    const user = await findUserByUuid(identifier);
    // Omitted for brevity; see the previous example for details.
  })
  .mapHandle(async (ctx, username) => {
    // Work with the database to find the user's UUID by the WebFinger username.
    const user = await findUserByUsername(username);
    if (user == null) return null;  // Return null if the actor is not found.
    return user.uuid;
  });
~~~~

Decoupling the WebFinger username from the identifier is useful when you want
to let users change their WebFinger username without breaking the existing
network, because changing the WebFinger username does not affect the actor URI.

> [!NOTE]
> We highly recommend that you set the actor's `preferredUsername` property to
> the corresponding WebFinger username so that peers can find the actor's
> fediverse handle by fetching the actor object.


WebFinger links
---------------

Some properties of an `Actor` returned by the actor dispatcher affect
responses to WebFinger requests.

> [!TIP]
> *Since Fedify 1.9.0*, you can also customize WebFinger responses using
> `~Federatable.setWebFingerLinksDispatcher()` to add custom links with
> the `template` field. See the
> [WebFinger documentation](./webfinger.md#customizing-webfinger-endpoint) for
> details.

### `preferredUsername`

*This API is available since Fedify 0.15.0.*

The `preferredUsername` property is the bare handle of the actor.  It is
used as the WebFinger username, used in the `acct:` URI of the `aliases`
property of the WebFinger response.

### `url`

The `url` property usually refers to the actor's profile page.  It is
used as the `links` property of the WebFinger response, with the `rel`
property set to <http://webfinger.net/rel/profile-page>.

> [!TIP]
> You probably want to implement [actor aliases](#actor-aliases) if you want
> to give different URLs to the actor URI and its web profile URL.

If you want to provide links with other `rel` than
<http://webfinger.net/rel/profile-page>, you can put `Link` objects in the
`url` property:

~~~~ typescript{8-16} twoslash
import { type Federation } from "@fedify/fedify";
import { Link, Person } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
// ---cut-before---
federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    return new Person({
      id: ctx.getActorUri(identifier),
      preferredUsername: identifier,
      urls: [
        new URL(`/@${identifier}`, ctx.origin),
        new Link({
          rel: "alternate",
          href: new URL(`/@${identifier}/atom.xml`, ctx.origin),
          mediaType: "application/atom+xml",
        }),
        new Link({
          rel: "http://openid.net/specs/connect/1.0/issuer",
          href: new URL("/openid", ctx.origin),
        }),
      ],
      // Omitted for brevity; see the previous example for details.
    });
  });
~~~~

With the above example, the WebFinger response will contain the following
`links` property:

~~~~ json
{
  "subject": "acct:johndoe@example.com",
  "aliases": [
    "https://example.com/users/john_doe"
  ],
  "links": [
    {
      "rel": "http://webfinger.net/rel/profile-page",
      "href": "https://example.com/@john_doe"
    },
    {
      "rel": "alternate",
      "href": "https://example.com/@john_doe/atom.xml",
      "type": "application/atom+xml"
    },
    {
      "rel": "http://openid.net/specs/connect/1.0/issuer",
      "href": "https://example.com/openid"
    }
  ]
}
~~~~

### `icon`

*This API is available since Fedify 1.0.0.*

The `icon` property is an `Image` object that represents the actor's
icon (i.e., avatar).  It is used as the `links` property of the WebFinger
response, with the `rel` property set to <http://webfinger.net/rel/avatar>.


Actor aliases
-------------

*This API is available since Fedify 1.4.0.*

Sometimes, you may want to give different URLs to the actor URI and its web
profile URL.  It can be easily configured by setting the `url` property of
the `Actor` object returned by the actor dispatcher.  However, if someone
queries the WebFinger for a profile URL, the WebFinger response will not
contain the corresponding actor URI.

To solve this problem, you can set the aliases of the actor by
the `~ActorCallbackSetters.mapAlias()` method.  It takes a callback function
that takes a `Context` object and a queried URL through WebFinger, and returns
the corresponding actor's internal identifier or username, or `null` if there
is no corresponding actor:

~~~~ typescript{15-25} twoslash
// @noErrors: 2345 2391
import { type Federation } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
interface User { uuid: string; }
/**
 * It's a hypothetical function that finds a user by the UUID.
 * @param uuid The UUID of the user.
 * @returns The user object.
 */
function findUserByUuid(uuid: string): User;
/**
 * It's a hypothetical function that finds a user by the username.
 * @param username The username of the user.
 * @returns The user object.
 */
function findUserByUsername(username: string): User;
// ---cut-before---
federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    // Since we map a WebFinger username to the corresponding user's UUID below,
    // the `identifier` parameter is the user's UUID, not the WebFinger
    // username:
    const user = await findUserByUuid(identifier);
    // Omitted for brevity; see the previous example for details.
  })
  .mapHandle(async (ctx, username) => {
    // Work with the database to find the user's UUID by the WebFinger username.
    const user = await findUserByUsername(username);
    if (user == null) return null;  // Return null if the actor is not found.
    return user.uuid;
  })
  .mapAlias((ctx, resource: URL) => {
    // Parse the URL and return the corresponding actor's username if
    // the URL is the profile URL of the actor:
    if (resource.protocol !== "https:") return null;
    if (resource.hostname !== "example.com") return null;
    const m = /^\/@(\w+)$/.exec(resource.pathname);
    if (m == null) return null;
    // Note that it is okay even if the returned username is non-existent.
    // It's dealt with by the `mapHandle()` above:
    return { username: m[1] };
  });
~~~~

By registering the alias mapper, Fedify can respond to WebFinger requests
for the actor's profile URL with the corresponding actor URI.

> [!TIP]
> You also can return the actor's internal identifier instead of the username
> in the `~ActorCallbackSetters.mapAlias()` method:
>
> ~~~~ typescript twoslash
> // @noErrors: 2345 7006
> import { type Federation } from "@fedify/fedify";
> const federation = null as unknown as Federation<void>;
> federation.setActorDispatcher(
>   "/users/{identifier}", async (ctx, identifier) => {}
> )
> // ---cut-before---
> .mapAlias((ctx, resource: URL) => {
>   // Parse the URL and return the corresponding actor's username if
>   // the URL is the profile URL of the actor:
>   if (resource.protocol !== "https:") return null;
>   if (resource.hostname !== "example.com") return null;
>   const userId = resource.searchParams.get("userId");
>   if (userId == null) return null;
>   return { identifier: userId };  // [!code highlight]
> });
> ~~~~

> [!TIP]
> The callback function of the `~ActorCallbackSetters.mapAlias()` method
> can be an async function.


Portable actors and WebFinger
-----------------------------

*This API is available since Fedify 2.4.0.*

An [FEP-ef61] portable actor has an ID that is not tied to a server, such as
`ap+ef61://did:key:z6Mk.../users/alice`, and a `gateways` property that lists
the servers where the actor can be retrieved.  Since the ID has no host,
FEP-ef61 takes the domain of the actor's WebFinger address from the *first*
gateway instead: a portable actor with `preferredUsername` `alice` and
`https://example.com` as its first gateway is `@alice@example.com`.

Fedify's WebFinger endpoint supports portable actors through the same actor
dispatcher, `~ActorCallbackSetters.mapHandle()`, and
`~ActorCallbackSetters.mapAlias()` as ordinary actors.  If the actor dispatcher
returns an actor whose ID is a portable ID, Fedify responds as follows:

 -  The `self` link is the actor's *compatible identifier* made from its first
    gateway, e.g.,
    `https://example.com/.well-known/apgateway/did:key:z6Mk.../users/alice`,
    so that software that does not support portable IDs can still fetch the
    actor.  Software that supports them recovers the portable ID from it.
    The portable ID itself is not put in the response, as it is not a valid
    URI for most WebFinger clients.  If the actor's ID is a compatible
    identifier already (see the [*Compatible identifiers as actor IDs*
    section](#compatible-identifiers-as-actor-ids)), the `self` link is the
    ID as is.
 -  The `subject` is the `acct:` URI whose domain is the host of the first
    gateway.  If this server is not the first gateway, the queried `acct:`
    URI is listed in `aliases` instead.
 -  If the actor has no `gateways`, or its first gateway is not an HTTP(S)
    origin, Fedify logs an error and responds as if the actor were not found.

The actor dispatcher also serves portable actors at their compatible
identifiers, i.e., requests through the FEP-ef61 gateway endpoint like
`GET /.well-known/apgateway/did:key:z6Mk.../users/alice`, with the path after
the DID.  So use the portable ID that `~Context.getPortableActorUri()` builds
from the same path as the actor's ID (see the [*Portable IDs*
section](./context.md#portable-ids) for how to get a DID):

~~~~ typescript twoslash
import { signObject } from "@fedify/fedify";
import { type Federation } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
const federation = null as unknown as Federation<void>;
interface User { username: string; did: string }
async function findUser(_identifier: string): Promise<User | null> {
  return null;
}
async function getPortableKey(
  _did: string,
): Promise<{ privateKey: CryptoKey; keyId: URL }> {
  return null!;
}
// ---cut-before---
federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    const user = await findUser(identifier);
    if (user == null) return null;
    // Serving GET /.well-known/apgateway/did:key:z6Mk.../users/alice; the DID
    // comes from the request path, so make sure that it is the user's:
    if (
      ctx.portableRequest != null &&
      ctx.portableRequest.authority !== user.did
    ) {
      return null;
    }
    const { privateKey, keyId } = await getPortableKey(user.did);
    return await signObject(
      new Person({
        // ap+ef61://did:key:z6Mk.../users/alice
        id: ctx.getPortableActorUri(identifier, user.did),
        preferredUsername: user.username,
        gateways: [new URL("https://example.com")],
      }),
      privateKey,
      keyId,  // e.g., did:key:z6Mk...#z6Mk...
    );
  })
  // Maps the WebFinger username (preferredUsername) back to the identifier:
  .mapHandle((ctx, username) => username);
~~~~

Such a request is handled the same way as a portable object request that an
object dispatcher serves (see the [*Serving portable objects*
section](./object.md#serving-portable-objects)): the actor is served only if
its ID canonically equals the requested portable ID and it has an Object
Integrity Proof made with a key of the DID, and
the `~ActorCallbackSetters.authorize()` predicate, if any, is applied.
Otherwise, Fedify responds with `404 Not Found`, or with
`500 Internal Server Error` if the proof is missing or invalid.  A `Tombstone`
returned for a deleted portable actor is served with `410 Gone` if it has
a proof made with a key of the DID, and with `404 Not Found` if it has no
proof (see the [*Deleted portable objects*
section](./object.md#deleted-portable-objects)).  Ordinary requests for the
actor, WebFinger, and
[portable inbox](./inbox.md#portable-inboxes) deliveries do not set
`~RequestContext.portableRequest`, so the dispatcher returns the actor for
them as usual.

An object dispatcher can serve a portable actor as well, if you want its ID
to have a path other than the actor dispatcher's; in that case, build the
actor's ID with `~Context.getPortableObjectUri()` instead.

> [!NOTE]
> Fedify generates only one `self` link for a portable actor, but links
> returned by the [WebFinger links dispatcher](#webfinger-links) are added
> as they are.  Also note that WebFinger discovery alone does not make
> a portable actor usable for software without FEP-ef61 support, which may
> still refuse the actor document whose ID is a portable ID.

On the other side, `Context.lookupObject()` resolves a handle of a portable
actor, e.g., `@alice@example.com`, whether the `self` link of the WebFinger
response is a portable ID or a compatible identifier.  It fetches the actor
through gateways, asking the WebFinger server first, and returns it only if it
has a valid Object Integrity Proof made by the DID in its ID; the WebFinger
server is never treated as the actor's origin.  See the [*Looking up remote
objects* section](./context.md#looking-up-remote-objects) for details.
The `getActorHandle()` function, in turn, takes the domain of a portable
actor's handle from its first gateway, and returns the handle only if the
WebFinger response for it links back to the actor, since anyone can list any
server in the `gateways` of their actor.

[FEP-ef61]: https://w3id.org/fep/ef61


Compatible identifiers as actor IDs
-----------------------------------

*This API is available since Fedify 2.4.0.*

Software that does not support [FEP-ef61] cannot handle portable IDs like
`ap+ef61://did:key:z6Mk.../users/alice`, and may refuse an actor document
whose ID is one.  For such software, FEP-ef61 lets a portable actor, and its
activities and objects, be identified by their *compatible identifiers*
instead, e.g.,
`https://example.com/.well-known/apgateway/did:key:z6Mk.../users/alice`.
Some implementations, such as [tootik], identify all their portable actors
this way.

Prefer portable IDs unless your actors have to interoperate with software
that cannot handle them.  A compatible identifier has a few drawbacks:

 -  FEP-ef61 requires publishers to construct compatible identifiers with
    the *first* gateway in the actor's `gateways`, so changing the first
    gateway changes the IDs that software without FEP-ef61 support sees,
    although the canonical portable IDs stay the same.
 -  Software without FEP-ef61 support takes every object that a gateway
    serves as having the same origin, as it does not know the DIDs in the
    compatible identifiers.

Fedify treats an actor whose ID is a compatible identifier as a portable actor
in the same way as one whose ID is a portable ID, since software that supports
FEP-ef61 turns the compatible identifier back into the portable ID it contains:

 -  Its activities follow the same rules as those of other portable actors:
    each has to have a portable ID or a compatible identifier of the actor's
    DID, and is signed only by the DID's key.  See the [*Choosing the proof
    key* section](./send.md#choosing-the-proof-key).
 -  The [actor dispatcher](#portable-actors-and-webfinger) and the [object
    dispatchers](./object.md#serving-portable-objects) that serve the actor
    and its objects may return them with compatible identifiers as their IDs.
 -  Its WebFinger `self` link is its ID as is, while the domain of its
    address still comes from its first gateway.
 -  Its inbox may be a compatible identifier as well, through which Fedify
    accepts deliveries as for other [portable
    inboxes](./inbox.md#portable-inboxes).
 -  The `~ActorCallbackSetters.mapPortableActorId()` callback may return the
    compatible identifier; see the [*Gateway keys of portable actors*
    section](#gateway-keys-of-portable-actors).

The `~Context.getPortableActorUri()`, `~Context.getPortableObjectUri()`, and
`~Context.getPortableInboxUri()` methods build portable IDs only.  Turn them
into compatible identifiers on the actor's first gateway with
`toCompatibleEf61Id()`, before signing the documents that contain them; a
signed document cannot be rewritten without invalidating its proof:

~~~~ typescript twoslash
import { type Context, signObject } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
import { toCompatibleEf61Id } from "@fedify/vocab-runtime";
interface User { username: string; did: string; identifier: string }
async function getPortableKey(
  _did: string,
): Promise<{ privateKey: CryptoKey; keyId: URL }> {
  return null!;
}
// ---cut-before---
const gateways = [new URL("https://example.com"), new URL("https://other.example")];

async function getPortableActor(
  ctx: Context<void>,
  user: User,
): Promise<Person> {
  const { privateKey, keyId } = await getPortableKey(user.did);
  return await signObject(
    new Person({
      // https://example.com/.well-known/apgateway/did:key:z6Mk.../users/alice
      id: toCompatibleEf61Id(
        ctx.getPortableActorUri(user.identifier, user.did),
        gateways[0],
      ),
      // https://example.com/.well-known/apgateway/did:key:z6Mk.../users/alice/inbox
      inbox: toCompatibleEf61Id(
        ctx.getPortableInboxUri(user.identifier, user.did),
        gateways[0],
      ),
      preferredUsername: user.username,
      gateways,
    }),
    privateKey,
    keyId,  // e.g., did:key:z6Mk...#z6Mk...
  );
}
~~~~

If the actor dispatcher returns an actor whose ID is a compatible identifier
that is malformed, e.g., has `@gateway` location hints, or is not on the
actor's first gateway, Fedify logs a warning.  It does not check the
compatible identifiers of activities and objects against the first gateway,
as it does not know their actors' `gateways`, except that it warns when
an activity and its actor are identified by compatible identifiers on
different gateways.

A WebFinger query for the compatible identifier itself does not match the
actor dispatcher's path, so map it back to the actor's identifier through
`~ActorCallbackSetters.mapAlias()`:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
import { fromCompatibleEf61Id, getFe34Origin } from "@fedify/vocab-runtime";
const federation = null as unknown as Federation<void>;
interface User { identifier: string; username: string }
async function findUserByDid(_did: string): Promise<User | null> {
  return null;
}
// ---cut-before---
federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    // Omitted for brevity; see the example above.
    return null;
  })
  .mapAlias(async (ctx, resource) => {
    let portableId: URL | null;
    try {
      // e.g., ap+ef61://did:key:z6Mk.../users/alice:
      portableId = fromCompatibleEf61Id(resource);
    } catch {
      return null;  // A malformed compatible identifier.
    }
    if (portableId == null) return null;  // Not a compatible identifier.
    // did:key:z6Mk...
    const user = await findUserByDid(getFe34Origin(portableId));
    if (
      user == null ||
      portableId.pathname !== ctx.getActorUri(user.identifier).pathname
    ) {
      return null;
    }
    return { identifier: user.identifier };
  });
~~~~

[tootik]: https://github.com/dimkr/tootik


Gateway keys of portable actors
-------------------------------

*This API is available since Fedify 2.4.0.*

When a server delivers activities or makes signed requests on behalf of an
[FEP-ef61] portable actor, it acts as one of the actor's gateways, and signs
the requests with HTTP Signatures as usual.  FEP-ef61 asks each gateway to
sign with its own keys, and to list their public keys in the actor's
`assertionMethods` as [FEP-521a] describes.  Fedify calls them
*gateway keys*.

Gateway keys only sign HTTP requests.  A portable actor's activities and
objects are authenticated by the Object Integrity Proofs made by the actor's
DID, not by the gateway that sends them.  So Fedify never makes Object
Integrity Proofs or Linked Data Signatures with gateway keys, and never takes
a gateway's HTTP Signature in place of a proof.

To have the [key pairs dispatcher](#public-keys-of-an-actor) dispatch gateway
keys for a portable actor, tell Fedify the actor's portable ID through
the `~ActorCallbackSetters.mapPortableActorId()` method:

~~~~ typescript twoslash
import { type Federation } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
interface User { username: string; did: string }
async function findUser(_identifier: string): Promise<User | null> {
  return null;
}
async function getGatewayKeyPairs(
  _identifier: string,
): Promise<CryptoKeyPair[]> {
  return [];
}
// ---cut-before---
federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    // Omitted for brevity; see the example below.
    return null;
  })
  .setKeyPairsDispatcher(async (ctx, identifier) => {
    // This server's own key pairs for the actor, not the DID's key pair:
    return await getGatewayKeyPairs(identifier);
  })
  .mapPortableActorId(async (ctx, identifier) => {
    const user = await findUser(identifier);
    if (user == null) return null;  // Not a portable actor.
    // The same ID as the actor dispatcher returns for the actor, e.g.,
    // ap+ef61://did:key:z6Mk.../users/alice:
    return ctx.getPortableActorUri(identifier, user.did);
  });
~~~~

For an actor the callback returns a portable ID for, the
`~Context.getActorKeyPairs()` method derives the keys this way:

 -  The key IDs are the actor's [compatible identifier] on this server,
    i.e., the canonical origin of the federation, with `#main-key` for
    the first key and `#key-2`, `#key-3`, and so on for the rest, e.g.,
    `https://example.com/.well-known/apgateway/did:key:z6Mk.../users/alice#main-key`.
    Such key IDs can be dereferenced to the actor document that this server
    serves through the [actor dispatcher](#portable-actors-and-webfinger), and
    tell which gateway made the signature.
 -  The `cryptographicKey` and the `multikey` of each key pair have the key ID
    as their IDs, so that verifiers find the key with the signature's key ID
    in both `publicKey` and `assertionMethod`.  Their owner and controller is
    the portable actor ID that the callback returns.

The RSA key among them signs the HTTP requests made on behalf of the actor,
such as the ones made by `Context.sendActivity()`,
`InboxContext.forwardActivity()`, and the document loader that
`Context.getDocumentLoader()` returns for the actor, as well as the activities
that Fedify [forwards from the actor's portable
inbox](./inbox.md#forwarding-to-other-gateways) to its other gateways.  If the
callback is not registered, or it returns `null`, the keys are derived from
`Context.getActorUri()` as usual.

The actor document itself has to list the keys of all the actor's gateways,
while the key pairs dispatcher knows only this server's keys.  Fedify does not
store or exchange the keys of other gateways, so add their public keys to
the actor's `assertionMethods` yourself, and sign the document with the DID's
key as usual:

~~~~ typescript twoslash
import { type Context, signObject } from "@fedify/fedify";
import { type Multikey, Person } from "@fedify/vocab";
interface User { username: string; did: string; identifier: string }
async function getPortableKey(
  _did: string,
): Promise<{ privateKey: CryptoKey; keyId: URL }> {
  return null!;
}
async function getOtherGatewayKeys(_did: string): Promise<Multikey[]> {
  return [];
}
// ---cut-before---
async function getPortableActor(
  ctx: Context<void>,
  user: User,
): Promise<Person> {
  const { privateKey, keyId } = await getPortableKey(user.did);
  // This server's gateway keys:
  const keys = await ctx.getActorKeyPairs(user.identifier);
  return await signObject(
    new Person({
      id: ctx.getPortableActorUri(user.identifier, user.did),
      preferredUsername: user.username,
      gateways: [new URL("https://example.com"), new URL("https://other.example")],
      publicKeys: keys.map((key) => key.cryptographicKey),
      assertionMethods: [
        ...keys.map((key) => key.multikey),
        // The public keys of the actor's other gateways:
        ...await getOtherGatewayKeys(user.did),
      ],
    }),
    privateKey,
    keyId,  // e.g., did:key:z6Mk...#z6Mk...
  );
}
~~~~

> [!IMPORTANT]
> This server has to be listed in the actor's `gateways`.  Receivers accept
> a gateway key only from a gateway the actor lists.

Since the DID's key pair is not dispatched by the key pairs dispatcher, sign
a portable actor's activities with `signObject()` before sending them, or pass
the DID's key to `Context.sendActivity()` as an explicit sender key.  An
activity of a portable actor has to have a portable ID or a compatible
identifier of the actor's DID, and
`Context.sendActivity()` throws a `TypeError` if it does not, or if it has no
proof and no key can make one.  See the [*Choosing the proof key*
section](./send.md#choosing-the-proof-key) for details.

On the receiving side, Fedify verifies an HTTP Signature made with a gateway
key if the key ID is a compatible identifier that dereferences to a portable
actor document, and:

 -  the document is the actor that the key ID is a compatible identifier of,
    whether the document's own ID is a portable ID or, as some
    implementations such as [tootik] publish, a compatible identifier,
 -  the document has a valid Object Integrity Proof made by the actor's DID,
 -  the document embeds the key in its `assertionMethod`, with the actor as
    its `controller` (a `publicKey` entry that embeds a key with the same ID,
    if any, must have the same key material), or, if no `assertionMethod` entry
    has the key ID, in its `publicKey`, with the actor as its `owner`,
 -  no more than one entry of either property has the key ID, and
 -  the gateway that the key ID belongs to is listed in the actor's
    `gateways`.

Otherwise the signature is not verified.  A verified gateway key belongs to
the portable actor, so `RequestContext.getSignedKeyOwner()` returns the actor,
e.g., to decide whether the actor may see a non-public portable object.
Inboxes, however, still require a valid Object Integrity Proof on the
activities of portable actors; see the [*Portable actors*
section](./inbox.md#portable-actors) of the inbox guide.

Accepting a key listed only in `publicKey` is a tolerance for publishers that
list their RSA keys there, such as [tootik]; list your own gateway keys in
`assertionMethods` as FEP-ef61 requires.

A portable actor, whether its ID is a portable ID or a compatible identifier,
is never authenticated by the web origin that serves it.  If the document at
a compatible key ID is a portable actor that does not vouch for the key, e.g.,
an unsigned one on someone else's gateway, the key is rejected rather than
resolved as an ordinary actor's.  Likewise, a key at an ordinary URL that
names a portable actor as its owner or controller is never that actor's key.

> [!NOTE]
> Fedify does not resolve gateway keys whose IDs are `ap:` or `ap+ef61:`
> URIs, as there is no gateway to dereference them through.

Whether a key at a compatible identifier is valid depends on what it is used
for, so Fedify caches such keys apart for each purpose: a gateway key cached
for verifying HTTP Signatures is never used for Object Integrity Proofs or
Linked Data Signatures.  Since the key's validity depends on the actor's
signed document rather than its origin, and the actor can drop the gateway
from its document at any time, Fedify looks up a cached gateway key again
after an hour at most, or once the proof on the actor's document expires,
whichever comes first.  A failure to fetch a key at a compatible identifier,
by contrast, fails every purpose alike, so it is cached like that of any
other key.

[FEP-521a]: https://w3id.org/fep/521a
[compatible identifier]: https://w3id.org/fep/ef61#compatible-ids
