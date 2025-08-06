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
the Fedify, it is the first thing you need to do to make Fedify work.

An actor dispatcher is a callback function that takes a `Context` object and
an identifier, and returns an actor object.  The actor object can be one of
the following:

 -  `Application`
 -  `Group`
 -  `Organization`
 -  `Person`
 -  `Service`

The below example shows how to register an actor dispatcher:

~~~~ typescript{7-15} twoslash
// @noErrors: 2451 2345
import type { Federation } from "@fedify/fedify";
const federation = null as unknown as Federation<void>;
interface User { }
const user = null as User | null;
// ---cut-before---
import { createFederation, Person } from "@fedify/fedify";

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

By default, Fedify assumes that the actor's identifier is the WebFinger username, but you can decouple the WebFinger username from the actor's identifier if you want.   You can think of the difference between these
two approaches as analogous to [natural key] vs. [surrogate key] in the database
design.

There are pros and cons to using the WebFinger username as the actor's identifier (which is Fedify's default):

Pros
:    -  The actor URI is more predictable and human-readable,
        which makes debugging easier.
     -  The internal ID of the actor can be hidden from the public.

Cons
:    -  Changing the WebFinger username may break the existing network.
        Hence, the fediverse handle is immutable in practice.
     -  It's usually treated as an anti-pattern in the fediverse.

You need to choose the best approach for your use case before implementing the actor
dispatcher.  If you decide to use the WebFinger username as the actor's
identifier, there's nothing to do—Fedify assumes it by default.

If you decide to decouple the WebFinger username from the actor's identifier,
see the [next section](#decoupling-actor-uris-from-webfinger-usernames) for
details.

[natural key]: https://en.wikipedia.org/wiki/Natural_key
[surrogate key]: https://en.wikipedia.org/wiki/Surrogate_key


Key properties of an `Actor`
----------------------------

Despite ActivityPub declares every property of an actor as optional,
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
the URIs of the actor's endpoints.  The most important endpoint is the `sharedInbox`.  You can use the `Context.getInboxUri()` method with no arguments
to generate the URI of the actor's shared inbox:

~~~~ typescript twoslash
import { Endpoints, Context } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
// ---cut-before---
new Endpoints({ sharedInbox: ctx.getInboxUri() })
~~~~

### `publicKey`

The `publicKey` property contains the public key of the actor.  It is
a `CryptographicKey` instance.  This property is usually used for verifying
[HTTP Signatures](./send.md#http-signatures).

See the [next section](#public-keys-of-an-actor) for details.

> [!TIP]
> In theory, an actor has multiple `publicKeys`, but in practice, the most
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
import { type Federation, Person } from "@fedify/fedify";
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
> We highly recommend you to set the actor's `preferredUsername` property to
> the corresponding WebFinger username so that peers can find the actor's
> fediverse handle by fetching the actor object.


WebFinger links
---------------

Some properties of an `Actor` returned by the actor dispatcher affect
responses to WebFinger requests.

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
import { type Federation, Person, Link } from "@fedify/fedify";
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
