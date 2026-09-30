---
description: >-
  Fedify supports a profile of FEP-ef61 portable objects.  This section
  walks through running portable actors, and explains which parts of
  FEP-ef61 Fedify implements, where it deliberately differs from the current
  FEP text, and what it does not support yet.
---

Portable objects
================

*FEP-ef61 support is available since Fedify 2.4.0.*

[FEP-ef61] makes ActivityPub objects *portable*: instead of an HTTP(S) URL
tied to one server, a portable object has an `ap:` URI whose authority is
a [DID], such as `ap://did:key:z6Mk.../actor`.  The object can be stored on
several servers, called *gateways*, and served by each of them under
the */.well-known/apgateway/* path.  Since the ID does not belong to any
server, a portable actor, activity, or object is authenticated by its
[FEP-8b32] Object Integrity Proof, which has to be made with a key of the DID
in its ID.

FEP-ef61 is still a draft, and some of the specifications it relies on leave
questions open.  Fedify therefore implements a *profile* of FEP-ef61: most of
what a gateway and a consumer of portable objects need, with a few deliberate
choices that differ from the current FEP text or rest on semantics that are
not settled yet, and without some parts of the FEP.

This chapter first walks through running portable actors with Fedify, and
then describes the profile as a whole, so that you and other implementers can
tell what to expect from a Fedify server.  Each feature is explained in detail
in the section it links to.

[FEP-ef61]: https://w3id.org/fep/ef61
[DID]: https://www.w3.org/TR/did-core/
[FEP-8b32]: https://w3id.org/fep/8b32


Running portable actors
-----------------------

This section shows how to host a portable actor in a Fedify application, from
creating its DID to sending and receiving activities.  Each step links to the
sections of the manual that explain its APIs in detail.  The examples assume a
single server, `https://example.com`, that acts as the actor's only gateway;
see [*Running on several gateways*](#running-on-several-gateways) for more.

### Creating a DID

A portable actor is identified by a [DID] rather than by a server, and
everything it publishes is signed with a key of the DID.  Fedify supports
`did:key` DIDs made from Ed25519 public keys, so generate an Ed25519 key pair
for each portable actor, and make its DID with `exportDidKey()`:

~~~~ typescript twoslash
import { exportJwk, generateCryptoKeyPair } from "@fedify/fedify";
import { exportDidKey } from "@fedify/vocab-runtime";

const { publicKey, privateKey } = await generateCryptoKeyPair("Ed25519");
const did = await exportDidKey(publicKey);  // did:key:z6Mk...
// The verification method of the DID's key, which proofs refer to:
const keyId = new URL(`${did}#${did.slice("did:key:".length)}`);

// Store the DID and the key pair along with the actor, e.g., as JWKs:
const jwks = {
  publicKey: await exportJwk(publicKey),
  privateKey: await exportJwk(privateKey),
};
~~~~

The DID is the actor's identity: every ID the actor has is built from it, and
whoever holds its private key can act as the actor.  Keep the private key
safe, and do not lose it, since Fedify has no workflow for rotating it or for
moving an actor to another DID.  Store the DID along with the actor, rather
than taking it from requests.  See the [*Portable IDs*
section](./context.md#portable-ids) of the *Context* chapter for more.

### Dispatching the actor

The actor dispatcher returns a portable actor as it would an ordinary actor.
Build its portable ID from the dispatcher's path and the DID with
`~Context.getPortableActorUri()`, and sign the actor with the DID's key by
`signObject()`.  Its inbox and collections get portable IDs as well,
and its `gateways` lists the servers that host it, the first of which gives
the domain of its fediverse handle:

~~~~ typescript twoslash
import {
  createFederation,
  MemoryKvStore,
  signObject,
} from "@fedify/fedify";
import { Person } from "@fedify/vocab";
interface User {
  identifier: string;
  username: string;
  did: string;
  didKeyPair: CryptoKeyPair;
  gatewayKeyPair: CryptoKeyPair;
}
async function findUser(_identifier: string): Promise<User | null> {
  return null;
}
async function findUserByUsername(_username: string): Promise<User | null> {
  return null;
}
function getDidKeyId(did: string): URL {
  return new URL(`${did}#${did.slice("did:key:".length)}`);
}
// ---cut-before---
const federation = createFederation<void>({
  kv: new MemoryKvStore(),
  origin: "https://example.com",
});

federation
  .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
    const user = await findUser(identifier);
    if (user == null) return null;
    // A request through the gateway endpoint, e.g.,
    // GET /.well-known/apgateway/did:key:z6Mk.../users/alice, names the DID
    // in its path, so make sure that it is the user's:
    if (
      ctx.portableRequest != null &&
      ctx.portableRequest.authority !== user.did
    ) {
      return null;
    }
    // This server's gateway keys for the actor (see below):
    const keys = await ctx.getActorKeyPairs(identifier);
    return await signObject(
      new Person({
        // ap+ef61://did:key:z6Mk.../users/alice
        id: ctx.getPortableActorUri(identifier, user.did),
        preferredUsername: user.username,
        inbox: ctx.getPortableInboxUri(identifier, user.did),
        outbox: ctx.getPortableOutboxUri(identifier, user.did),
        followers: ctx.getPortableFollowersUri(identifier, user.did),
        gateways: [new URL("https://example.com")],
        publicKeys: keys.map((key) => key.cryptographicKey),
        assertionMethods: keys.map((key) => key.multikey),
      }),
      user.didKeyPair.privateKey,
      getDidKeyId(user.did),  // did:key:z6Mk...#z6Mk...
    );
  })
  .setKeyPairsDispatcher(async (ctx, identifier) => {
    const user = await findUser(identifier);
    // This server's own key pair for the actor, not the DID's key pair:
    return user == null ? [] : [user.gatewayKeyPair];
  })
  .mapPortableActorId(async (ctx, identifier) => {
    const user = await findUser(identifier);
    return user == null
      ? null
      : ctx.getPortableActorUri(identifier, user.did);
  })
  .mapHandle(async (ctx, username) => {
    const user = await findUserByUsername(username);
    return user?.identifier ?? null;
  });
~~~~

With this dispatcher, Fedify serves the actor in several ways:

 -  Through the FEP-ef61 gateway endpoint, at the actor's compatible
    identifier, e.g.,
    `https://example.com/.well-known/apgateway/did:key:z6Mk.../users/alice`,
    which is how other servers retrieve it.  Fedify serves the actor there
    only if its ID is the requested portable ID and it has a proof made with
    a key of the DID, and responds with `500 Internal Server Error` if the
    proof is missing.
 -  Through WebFinger, as `@alice@example.com`, whose `self` link is the
    compatible identifier above.  The domain comes from the first gateway in
    the actor's `gateways`, which has to be an HTTP(S) origin.
 -  At its ordinary URL, e.g., `https://example.com/users/alice`, as before.

See the [*Portable actors and WebFinger*
section](./actor.md#portable-actors-and-webfinger) for the details.

The key pairs dispatcher and `~ActorCallbackSetters.mapPortableActorId()`
give the actor *gateway keys*: this server's own keys for the actor, which
sign the HTTP requests that the server makes on behalf of the actor, such as
deliveries.  They never sign the actor's activities or objects, which only
the DID's key does.  The actor document lists them in its
`assertionMethods`, so that other servers can verify the HTTP Signatures.
See the [*Gateway keys of portable actors*
section](./actor.md#gateway-keys-of-portable-actors).

> [!TIP]
> Software that does not support FEP-ef61 may refuse an actor whose ID is
> a portable ID.  If your actors have to interoperate with such software,
> identify them by their compatible identifiers instead; see the [*Compatible
> identifiers as actor IDs*
> section](./actor.md#compatible-identifiers-as-actor-ids).

### Serving objects and collections

Object dispatchers serve portable objects through the gateway endpoint in
the same way, e.g.,
`GET /.well-known/apgateway/did:key:z6Mk.../users/alice/notes/1` by
the dispatcher for `/users/{identifier}/notes/{id}`.  Give such an object
the portable ID that `~Context.getPortableObjectUri()` builds, and sign it
with the DID's key:

~~~~ typescript twoslash
import { type Federation, signObject } from "@fedify/fedify";
import { Note, PUBLIC_COLLECTION } from "@fedify/vocab";
import { withGatewayHints } from "@fedify/vocab-runtime";
const federation = null as unknown as Federation<void>;
interface Post { content: string; didKeyPair: CryptoKeyPair }
async function findPost(
  _did: string,
  _identifier: string,
  _id: string,
): Promise<Post | null> {
  return null;
}
function getDidKeyId(did: string): URL {
  return new URL(`${did}#${did.slice("did:key:".length)}`);
}
// ---cut-before---
federation.setObjectDispatcher(
  Note,
  "/users/{identifier}/notes/{id}",
  async (ctx, values) => {
    // Ordinary requests are omitted for brevity:
    if (ctx.portableRequest == null) return null;
    const { authority } = ctx.portableRequest;
    // Look the post up by the DID as well, since anyone can ask for any DID:
    const post = await findPost(authority, values.identifier, values.id);
    if (post == null) return null;
    return await signObject(
      new Note({
        // ap+ef61://did:key:z6Mk.../users/alice/notes/1
        id: ctx.getPortableObjectUri(Note, values),
        // ap+ef61://did:key:z6Mk.../users/alice?@gateway=https%3A%2F%2Fexample.com
        attribution: withGatewayHints(
          ctx.getPortableActorUri(values.identifier),
          [new URL("https://example.com")],
        ),
        to: PUBLIC_COLLECTION,
        content: post.content,
      }),
      post.didKeyPair.privateKey,
      getDidKeyId(authority),
    );
  },
);
~~~~

Fedify serves only publicly addressed portable objects unless the dispatcher
has an authorization predicate, since a gateway must not serve a non-public
object to anyone but its audience; `~RequestContext.isSignedByAudience()`
helps to write such a predicate.  Return a signed `Tombstone` for a deleted
object, which is served with `410 Gone`.  See the [*Serving portable objects*
section](./object.md#serving-portable-objects) and the sections that follow
it.

Collection dispatchers, such as the outbox and followers dispatchers, serve
the actor's portable collections through the gateway endpoint as well, if the
actor's corresponding property has the portable ID that the matching method
builds, e.g., if its `outbox` is what `~Context.getPortableOutboxUri()`
returns.  The collections themselves need no proofs, but the portable
activities and objects embedded in them do.  See the
[*Portable collections* section](./collections.md#portable-collections).

### Receiving activities

A portable actor's inbox is reached through the gateway endpoint as well,
e.g.,
`POST /.well-known/apgateway/did:key:z6Mk.../users/alice/inbox`, and Fedify
routes it by the path after the DID to the same inbox listeners as the ordinary
inbox.  Fedify accepts such a delivery only if the actor dispatcher returns a
portable actor whose `inbox` is the requested inbox and whose `gateways`
include this server.

In a listener, `~Context.parseUri()` with the `portable` option tells which
of your portable actors an activity is about, and its `authority` property
has the DID, which you have to check against the one you store:

~~~~ typescript twoslash
import { type Federation, signObject } from "@fedify/fedify";
import { Accept, Follow, Note } from "@fedify/vocab";
import { withGatewayHints } from "@fedify/vocab-runtime";
const federation = null as unknown as Federation<void>;
interface User { identifier: string; did: string; didKeyPair: CryptoKeyPair }
async function findUser(_identifier: string): Promise<User | null> {
  return null;
}
async function addFollower(_user: User, _follower: URL): Promise<void> {}
function getDidKeyId(did: string): URL {
  return new URL(`${did}#${did.slice("did:key:".length)}`);
}
// ---cut-before---
federation
  .setInboxListeners("/users/{identifier}/inbox", "/inbox")
  .on(Follow, async (ctx, follow) => {
    if (follow.id == null || follow.objectId == null) return;
    const parsed = ctx.parseUri(follow.objectId, { portable: true });
    if (parsed?.type !== "actor") return;
    const user = await findUser(parsed.identifier);
    if (user == null || parsed.authority !== user.did) return;
    const follower = await follow.getActor(ctx);
    if (follower?.id == null) return;
    await addFollower(user, follower.id);
    const accept = await signObject(
      new Accept({
        id: ctx.getPortableObjectUri(
          Note,  // Any object dispatcher's path would do.
          { identifier: user.identifier, id: crypto.randomUUID() },
          user.did,
        ),
        // With location hints, so that the recipient can fetch the actor:
        actor: withGatewayHints(
          ctx.getPortableActorUri(user.identifier, user.did),
          [new URL("https://example.com")],
        ),
        object: follow.id,
      }),
      user.didKeyPair.privateKey,
      getDidKeyId(user.did),
    );
    await ctx.sendActivity(
      { identifier: user.identifier },
      follower,
      accept,
      { normalizeExistingProofs: true },
    );
  });
~~~~

 -  Fedify accepts an activity of a portable actor, or one with a portable
    ID, only if it has a valid proof made by that DID; an HTTP Signature does
    not authenticate it.  Portable objects embedded in an activity need their
    own proofs.  See the [*Portable actors* section](./inbox.md#portable-actors)
    and the [*Compound portable objects*
    section](./inbox.md#compound-portable-objects) of the *Inbox listeners*
    chapter.
 -  Accessors such as `~Follow.getActor()` verify the portable objects they
    fetch, since activities that inboxes receive use
    `~Context.verifyPortableObject` by default.  See the [*Default verifiers*
    section](./vocab.md#default-verifiers).
 -  Fedify forwards activities received in a portable inbox to the actor's
    other gateways, if the key–value store supports `~KvStore.cas()`.
    Configure the `origin` option, as in the example above, so that Fedify
    can tell which gateway it is.  See the [*Portable inboxes*
    section](./inbox.md#portable-inboxes) and the [*Forwarding to other
    gateways* section](./inbox.md#forwarding-to-other-gateways).

### Sending activities

The activities of a portable actor are signed with the DID's key, which
the key pairs dispatcher does not know.  So sign them with `signObject()`
before sending them, as the `Accept` above is, and pass
`normalizeExistingProofs: true` to `~Context.sendActivity()` so that the
activity is sent in the form that the proof covers.  If an activity embeds a
portable object, such as the `Note` of a `Create`, sign the object first, and
then the activity:

~~~~ typescript twoslash
import { type Context, signObject } from "@fedify/fedify";
import { Create, Note, PUBLIC_COLLECTION } from "@fedify/vocab";
import { withGatewayHints } from "@fedify/vocab-runtime";
const ctx = null as unknown as Context<void>;
interface User { identifier: string; did: string; didKeyPair: CryptoKeyPair }
const user = null as unknown as User;
function getDidKeyId(did: string): URL {
  return new URL(`${did}#${did.slice("did:key:".length)}`);
}
// ---cut-before---
const gateways = [new URL("https://example.com")];
// A reference to the actor, with location hints that tell where to get it:
// ap+ef61://did:key:z6Mk.../users/alice?@gateway=https%3A%2F%2Fexample.com
const actor = withGatewayHints(
  ctx.getPortableActorUri(user.identifier, user.did),
  gateways,
);
const note = await signObject(
  new Note({
    id: ctx.getPortableObjectUri(
      Note,
      { identifier: user.identifier, id: crypto.randomUUID() },
      user.did,
    ),
    attribution: actor,
    to: PUBLIC_COLLECTION,
    content: "Hello, world!",
  }),
  user.didKeyPair.privateKey,
  getDidKeyId(user.did),
);
const create = await signObject(
  new Create({
    id: ctx.getPortableObjectUri(
      Note,  // Any object dispatcher's path would do.
      { identifier: user.identifier, id: crypto.randomUUID() },
      user.did,
    ),
    actor,
    to: PUBLIC_COLLECTION,
    object: note,
  }),
  user.didKeyPair.privateKey,
  getDidKeyId(user.did),
);
await ctx.sendActivity(
  { identifier: user.identifier },
  "followers",
  create,
  { normalizeExistingProofs: true },
);
~~~~

 -  The activity has to have a portable ID of the actor's DID, and it is
    signed with the DID's key only; `~Context.sendActivity()` throws
    a `TypeError` otherwise, e.g., for an unsigned portable activity.  The
    HTTP requests are signed with the gateway keys.  See the [*Choosing the
    proof key* section](./send.md#choosing-the-proof-key).
 -  Location hints go on references to portable actors, such as `actor` and
    `attributedTo`, but not on an object's own `id`, and they have to be
    added before signing.  See the [*Location hints*
    section](./vocab.md#location-hints).
 -  An embedded portable object can be verified on its own only if it is signed
    with `signObject()` before it is embedded.  See the [*Producing
    a compound document* section](./send.md#producing-a-compound-document).
 -  Recipients that are portable actors themselves are delivered to through
    their gateways.  If your followers collection dispatcher returns
    `Recipient` objects, include the `~Recipient.gateways` of portable
    followers.  See the [*Delivering to portable actors*
    section](./send.md#delivering-to-portable-actors).

### Attaching media

A portable object refers to its media, such as images, by [hashlinks], which
carry the digests of the media, so that the media can be retrieved from any
gateway and verified.  Compute the digest with `computeDigestMultibase()`,
and make the hashlink with `createHashlink()`:

~~~~ typescript twoslash
import { Image } from "@fedify/vocab";
import {
  computeDigestMultibase,
  createHashlink,
} from "@fedify/vocab-runtime";
declare const bytes: Uint8Array;
// ---cut-before---
const digestMultibase = await computeDigestMultibase(bytes);
const image = new Image({
  url: new URL(createHashlink(digestMultibase)),  // hl:zQm...
  mediaType: "image/png",
  digestMultibase,
});
~~~~

To serve the media through the gateway endpoint, e.g.,
`GET /.well-known/apgateway/hl:zQm...`, register a hashlink media dispatcher
with `~Federatable.setHashlinkMediaDispatcher()`.  Fedify does not check what
the dispatcher serves against the digest, so store the media under their
digests.  See the [*Serving hashlink media*
section](./object.md#serving-hashlink-media).  To retrieve and verify the media
of others' portable objects, use `fetchPortableMedia()`; see the
[*Portable media* section](./vocab.md#portable-media).

[hashlinks]: https://datatracker.ietf.org/doc/html/draft-sporny-hashlink-07

### Looking up portable objects

`~Context.lookupObject()` looks up portable objects of others by their
portable IDs, their compatible identifiers, and the fediverse handles of
portable actors, and returns them only if their proofs are valid:

~~~~ typescript twoslash
import type { Context } from "@fedify/fedify";
const ctx = null as unknown as Context<void>;
// ---cut-before---
// Through WebFinger:
const actor = await ctx.lookupObject("@alice@example.com");
// A portable ID without location hints needs gateways to ask:
const note = await ctx.lookupObject("ap://did:key:z6Mk.../notes/1", {
  gateways: ["https://example.com"],
});
~~~~

Property accessors of the returned objects, and of the activities that
inboxes receive, verify the portable objects they dereference, too.  For
objects obtained elsewhere, pass a `Context` as the options of an accessor,
e.g., `await create.getObject(ctx)`, to verify them.

A portable actor's own collections, such as its outbox, have no location
hints, and accessors do not take the actor's `gateways` by themselves, so
pass them along with the context's verifier:

~~~~ typescript twoslash
import type { Context } from "@fedify/fedify";
import { isActor, traverseCollection } from "@fedify/vocab";
const ctx = null as unknown as Context<void>;
// ---cut-before---
const actor = await ctx.lookupObject("@alice@example.com");
if (isActor(actor)) {
  const options = {
    documentLoader: ctx.documentLoader,
    contextLoader: ctx.contextLoader,
    verifyPortableObject: ctx.verifyPortableObject,
    gateways: actor.gateways,
  };
  const outbox = await actor.getOutbox(options);
  if (outbox != null) {
    for await (const item of traverseCollection(outbox, options)) {
      console.log(item.id?.href);
    }
  }
}
~~~~

Unsigned collections are accepted only from gateways that their owners
list, as described in the [*Portable collections*
section](./vocab.md#portable-collections) of the *Vocabulary* chapter.  See the
[*Portable objects* section](./context.md#portable-objects) of the *Context*
chapter and the
[*Dereferencing portable references* section](./vocab.md#dereferencing-portable-references).

### Running on several gateways

The point of a portable actor is that it can be hosted by several servers,
so that it survives any of them.  Fedify, however, does not copy actors,
objects, or collections between gateways; the only built-in exchange between
them is the forwarding of activities that portable inboxes receive.  To host
an actor on several gateways:

 -  List every gateway in the actor's `gateways`, in the order of preference.
    Each of them has to serve the actor, its objects, and its collections,
    and to accept deliveries to its inbox, e.g., by running an application
    like the one above with the same data.
 -  List the gateway keys of every gateway in the actor's
    `assertionMethods`, not only those of the server that serves the
    document, so that each gateway's HTTP Signatures can be verified.  See
    the [*Gateway keys of portable actors*
    section](./actor.md#gateway-keys-of-portable-actors).
 -  Decide which servers hold the DID's private key.  A gateway that signs
    documents when it serves them, like the example above, needs the key.
    Otherwise, the application has to store the signed documents and keep
    them in sync across the gateways by itself.  Keep the received JSON of
    such documents rather than serializing vocabulary objects parsed from
    them, which can change what their proofs cover; see the [*Staying
    compatible* section](#staying-compatible).

### Testing

The mock federation and contexts of `@fedify/testing` support portable IDs,
portable object verification with fixture document loaders, gateway
requests, and hashlink media.  See the [*Testing* chapter](./test.md).


Supported features
------------------

Portable IDs
:   Fedify accepts portable IDs in both the `ap:` and `ap+ef61:` schemes,
    with a decoded or percent-encoded DID authority, anywhere an IRI is
    expected, and compares them canonically, ignoring the query.  Portable
    IDs whose paths contain a `.` or `..` segment cannot go through Fedify's
    `URL`-based APIs and are rejected there.  See the [*FEP-ef61 portable
    objects* section](./vocab.md#fep-ef61-portable-objects) and the
    [*Portable IDs* section](./context.md#portable-ids) of the *Context*
    chapter.

`did:key` DIDs with Ed25519 keys
:   Portable IDs use `did:key` DIDs made from Ed25519 public keys in
    the base58-btc encoding, which `exportDidKey()` produces.  Fedify resolves
    their verification methods locally, without fetching anything.  See the
    [*Object Integrity Proofs* section](./send.md#object-integrity-proofs).

Proof verification of portable objects
:   A portable actor, activity, or object has to carry an Object Integrity
    Proof whose `verificationMethod` is a DID URL of the DID in its ID, and
    a portable actor has to have valid `gateways`.  `verifyPortableObject()`
    applies this policy, and Fedify uses it by default for the objects it
    parses for you, such as activities in inboxes and the results of
    `~Context.lookupObject()`.  HTTP Signatures and Linked Data Signatures do
    not authenticate portable activities.  See the [*Object Integrity Proofs*
    section](./send.md#object-integrity-proofs), the [*Default verifiers*
    section](./vocab.md#default-verifiers), and the [*Portable actors*
    section](./inbox.md#portable-actors) of the *Inbox listeners* chapter.

Compound documents
:   Inboxes verify portable objects embedded in another document, such as
    the `Note` in a `Create`, independently, each against its own proof and
    DID, following Fedify's [map-local profile](#map-local-compound-proofs).
    See the [*Compound portable objects*
    section](./inbox.md#compound-portable-objects) of the *Inbox listeners*
    chapter for verification and the [*Compound portable objects*
    section](./send.md#compound-portable-objects) of the *Sending activities*
    chapter for producing them.  Dereferencing is different: there,
    a portable object embedded in a verified portable object with the same
    DID is trusted as covered by its parent's proof (see the [*Dereferencing
    portable references*
    section](./vocab.md#dereferencing-portable-references)).

Gateway dereferencing
:   Property accessors, such as `~Create.getObject()`, and
    `~Context.lookupObject()` retrieve portable objects from gateways in
    order, falling back to the next gateway when one fails or serves
    an object that does not verify.  Gateways come from `@gateway` location
    hints, which `withGatewayHints()` adds to a reference, or from
    the `gateways` option.  See the [*Dereferencing portable references*
    section](./vocab.md#dereferencing-portable-references), the [*Location
    hints* section](./vocab.md#location-hints), and the [*Portable objects*
    section](./context.md#portable-objects) of the *Context* chapter.

Serving portable objects and tombstones
:   The gateway endpoint, e.g.,
    `GET /.well-known/apgateway/did:key:z6Mk.../notes/123`, serves portable
    actors and objects through the existing actor and object dispatchers.
    Only publicly addressed objects are served unless the dispatcher has
    an authorization predicate, for example, one that uses
    `~RequestContext.isSignedByAudience()`.  Signed tombstones are served
    with `410 Gone`.  See the [*Serving portable objects*
    section](./object.md#serving-portable-objects), the [*Non-public portable
    objects* section](./object.md#non-public-portable-objects), and
    the [*Deleted portable objects*
    section](./object.md#deleted-portable-objects).

Portable collections
:   Collection dispatchers serve the collections of portable actors through
    the gateway endpoint, too.  As FEP-ef61 allows, such collections may be
    served without proofs; Fedify accepts an unsecured collection only from
    a gateway listed in its owner's `gateways`, and only for an actor's
    `inbox`, `outbox`, `followers`, `following`, and `liked`.  See the
    [*Portable collections* section](./collections.md#portable-collections)
    of the *Collections* chapter and the [*Portable collections*
    section](./vocab.md#portable-collections) of the *Vocabulary* chapter.

Hashlink media
:   `~Federatable.setHashlinkMediaDispatcher()` serves resources that
    portable objects refer to with SHA-256 `hl:` hashlinks, such as
    `GET /.well-known/apgateway/hl:zQm...`.  The dispatcher's response is not
    checked against the digest, but `fetchPortableMedia()` verifies what it
    retrieves against the `digestMultibase` of the object.  See the [*Serving
    hashlink media* section](./object.md#serving-hashlink-media) and the
    [*Portable media* section](./vocab.md#portable-media).

Portable inboxes and forwarding
:   The gateway endpoint accepts deliveries to the inboxes of portable
    actors, e.g., `POST /.well-known/apgateway/did:key:z6Mk.../inbox`, and
    passes them to the inbox listeners.  An accepted activity that carries
    its own proof or Linked Data Signature is forwarded at most once to
    the actor's other gateways, if the key–value store supports
    `~KvStore.cas()`.  See the [*Portable inboxes*
    section](./inbox.md#portable-inboxes), the [*Forwarding to other
    gateways* section](./inbox.md#forwarding-to-other-gateways), and the
    [`portableInboxForwarding`](./federation.md#portableinboxforwarding)
    option.

Delivery to portable actors
:   `~Context.sendActivity()` delivers to portable inboxes through
    the recipient's gateways, trying them in order.  An unsigned portable
    activity cannot be sent with an actor identifier alone, as the keys that
    Fedify derives for a portable actor are gateway keys, not keys of its
    DID; pass the key pair of the DID as the sender, or sign the activity
    beforehand.  See the [*Delivering to portable actors*
    section](./send.md#delivering-to-portable-actors).

WebFinger
:   Fedify's WebFinger endpoint serves portable actors under the host of
    their first gateway, and `~Context.lookupObject()` resolves the handles
    of portable actors on other servers.  See the [*Portable actors and
    WebFinger* section](./actor.md#portable-actors-and-webfinger).

Compatible identifiers
:   Fedify recognizes compatible identifiers, i.e., HTTP(S) URLs such as
    `https://gateway.example/.well-known/apgateway/did:key:z6Mk.../actor`,
    as portable IDs, and lets you use them as the IDs of your own portable
    actors and objects for software that does not support portable IDs.
    See the [*Compatible identifiers as actor IDs*
    section](./actor.md#compatible-identifiers-as-actor-ids) and
    the [*Compatible identifiers* section](./vocab.md#compatible-identifiers).

Gateway HTTP Signature keys
:   Each gateway signs its requests on behalf of a portable actor with its
    own key, which the actor document lists in `assertionMethod` as
    [FEP-521a] describes, and Fedify verifies HTTP Signatures made with such
    keys, including keys whose IDs are `ap:` URIs.  See the [*Gateway keys of
    portable actors* section](./actor.md#gateway-keys-of-portable-actors).

URI helpers and routing
:   The `~Context.getPortableActorUri()` method and its siblings build
    portable IDs from your dispatchers' paths, and `~Context.parseUri()`
    recognizes portable IDs with the `portable` option.  See the [*Portable
    IDs* section](./context.md#portable-ids) of the *Context* chapter and
    the [*Portable IDs* section](./context-advanced.md#portable-ids) of
    the *Advanced context helpers* chapter.

Testing
:   The mock federation and contexts of `@fedify/testing` support portable
    IDs and portable object verification.  See the [*Creating mock contexts*
    section](./test.md#creating-mock-contexts).

[FEP-521a]: https://w3id.org/fep/521a


Deliberate choices
------------------

Two choices of Fedify's profile differ from the current FEP-ef61 text or rest
on semantics that the specifications have not settled yet.  Fedify keeps both
for the 2.x series, but either may change in Fedify 3.0; such a change will
be announced in the changelog.

### Canonical `ap+ef61:` scheme

FEP-ef61 recommends the `ap:` scheme, and its canonicalization replaces
`ap+ef61` with `ap` when comparing IDs.  Fedify does the reverse: it
canonicalizes and serializes portable IDs as `ap+ef61:`, because the FEP warns
that the recommended scheme might change to `ap+ef61`, as these IDs are meant
only for portable objects.  (See [#826] and [#828] for the background.)

In practice, this means:

 -  Fedify accepts both schemes and compares `ap://did:key:z6Mk.../actor`
    and `ap+ef61://did:key:z6Mk.../actor` as equal.
 -  `formatIri()`, `canonicalizePortableUri()`, and the JSON-LD serialization
    of vocabulary objects produce `ap+ef61://` IDs with a decoded DID
    authority.  The portable IDs you mint with `~Context.getPortableActorUri()`
    and the like, and sign with `signObject()`, are therefore `ap+ef61:` IDs.
 -  Parsing a document into a vocabulary object normalizes its portable IRIs
    to `ap+ef61://`, including in the JSON-LD that the object caches.  So
    serializing an object that another implementation signed with `ap://` IDs
    changes the signed representation, and its proof no longer verifies
    against the result.

Since portable IDs end up in signed documents, consider this before you mint
them.

[#826]: https://github.com/fedify-dev/fedify/issues/826
[#828]: https://github.com/fedify-dev/fedify/issues/828

### Map-local compound proofs

When a signed portable object is embedded in another signed document, e.g.,
a `Note` in a `Create`, the verifier has to tell which part of the document
each proof covers.  Neither [FEP-8b32] nor
[Verifiable Credential Data Integrity] defines the boundaries of embedded
proofs yet (see [w3c/vc-data-integrity#350]), so Fedify uses an interim
*map-local* profile, defined in [#938]:

 -  Each JSON map that carries a `proof` is a separate secured document.
    Verifying it removes only its own proof, so the proofs of the maps
    embedded in it remain part of its input.
 -  Each embedded portable object needs its own proof and its own complete
    `@context`, apart from qualifying keys embedded in a verified portable
    actor, which the actor's proof covers.
 -  Proof aliases, proof sets, proof chains, and remote proof references are
    not supported in documents with portable objects.
 -  The profile authenticates the JSON values that make up each proof's
    input.  It does not guarantee that a child's JSON-LD expansion inside its
    parent is the same as its expansion on its own.

This is Fedify's interim interpretation, not a settled reading of
the specifications.  See the [*Compound portable objects*
section](./inbox.md#compound-portable-objects) of the *Inbox listeners*
chapter for the exact verification rules and the [*Compound portable objects*
section](./send.md#compound-portable-objects) of the *Sending activities*
chapter for producing compound documents.

[Verifiable Credential Data Integrity]: https://www.w3.org/TR/vc-data-integrity/
[w3c/vc-data-integrity#350]: https://github.com/w3c/vc-data-integrity/issues/350
[#938]: https://github.com/fedify-dev/fedify/issues/938

### Staying compatible

To keep your application working if these choices change:

 -  Compare portable IDs with `arePortableUrisEqual()`, or with keys derived
    by `canonicalizePortableUri()`, not as strings or by `URL.href`.  Pass
    them the raw ID strings, since a `URL` object may already have
    normalized the path.  Both accept only `ap:` and `ap+ef61:` URIs, so
    convert compatible identifiers with `fromCompatibleEf61Id()` first, as
    the example in the [*Portable IDs*
    section](./context-advanced.md#portable-ids) of the *Advanced context
    helpers* chapter does.
 -  Keep the original ID strings, and derive comparison keys from them when
    you need them, rather than storing only the canonical form, whose scheme
    might change.  Never rewrite a signed document with canonical IDs.
 -  Accept both schemes in documents from others, and do not require
    `ap+ef61:` in them.
 -  To keep or relay a document that someone else signed, keep the received
    JSON instead of serializing a vocabulary object parsed from it.
    `~InboxContext.forwardActivity()`, `~OutboxContext.forwardActivity()`,
    and the forwarding to other gateways send the received JSON, not one
    rebuilt from vocabulary objects.
 -  When you embed portable objects, follow the [*Producing a compound
    document* section](./send.md#producing-a-compound-document), or refer to
    the portable objects by their IDs instead of embedding them, which does
    not depend on the compound proof profile.


Not supported
-------------

The following parts of FEP-ef61 and the proposals around it are not
implemented by Fedify:

FEP-ae97 gateway endpoints
:   Fedify does not implement the gateway endpoints of [FEP-ae97]: submitting
    client-signed activities to a portable outbox, e.g.,
    `POST /.well-known/apgateway/did:key:z6Mk.../outbox`, and registering
    actors with `POST /.well-known/apgateway`.  Your own [outbox
    listeners](./outbox.md) can still forward activities that clients have
    signed without changing them.

Gateway discovery
:   Fedify does not serve the discovery endpoint of FEP-ae97,
    `GET /.well-known/apgateway`, which tells clients about the gateway, such
    as its media upload endpoint.

FEP-ae97 media upload and deletion
:   Fedify serves hashlink media, but does not implement the endpoints of
    FEP-ae97 for uploading and deleting it under
    */.well-known/apgateway-media*; storing media is up to your application.
    This is not to be confused with the ActivityPub Media Upload extension,
    which Fedify supports (see the [*Media upload* chapter](./media-upload.md)).

Storage and synchronization across gateways
:   Fedify does not copy or reconcile actors, objects, or collections between
    gateways; storing them is up to your application.  The only built-in
    delivery between gateways is the forwarding of activities received in
    portable inboxes.

Key rotation and migration
:   There is no built-in workflow for rotating the key of a DID or for
    migrating an actor to another DID.

Built-in support for DID methods other than `did:key`
:   Fedify resolves verification methods by itself only for `did:key` DIDs
    with Ed25519 keys.  Proofs made with keys of other DID methods can be
    verified only if your document loader resolves their verification
    methods; Fedify itself only checks the syntax of such DIDs, and does not
    resolve DID documents or their services.

Gateways with paths
:   Gateways have to be HTTP(S) origins, and portable objects are served and
    retrieved only under the */.well-known/apgateway/* path.  The arbitrary
    gateway paths that FEP-ef61 discusses are not supported.

Other limits
:   The shared inbox is not reachable through the gateway endpoint.  Hashlinks
    with metadata or digests other than SHA-256 are rejected, and the hashlink
    media endpoint has no built-in access control.  Portable collections other
    than an actor's `inbox`, `outbox`, `followers`, `following`, and `liked`,
    such as `featured` and custom collections, are served without proofs, but
    consumers, Fedify included, do not accept them unsecured, so they may not
    be usable by others yet.

[FEP-ae97]: https://w3id.org/fep/ae97


Interoperability
----------------

Besides Fedify itself, Fedify's profile has been tested against [tootik]
v0.25.4 and [Mitra] v5.10.0.  Fedify verifies tootik's portable actors,
activities, and HTTP Signatures, and Mitra's gateway HTTP Signatures on
activities that a client signed, and both accept portable activities that
Fedify sends.  Fedify has not yet verified a portable actor or activity that
Mitra itself signed.  Mastodon's handling of portable actors has not
been tested.  The [*FEP-ef61 interoperability*][interoperability] section of
*FEDERATION.md* records what was tested and how, along with the limits that
were found, e.g., that tootik v0.25.4 does not recognize compatible
identifiers with explicit ports.

The `fedify lookup` command looks up and verifies portable objects, which
helps to check what your server serves; see the [*`fedify lookup`*
section](../cli.md#fedify-lookup-looking-up-an-activitypub-object) of the CLI
manual.

*[DID]: Decentralized Identifier
*[FEP]: Fediverse Enhancement Proposal

[tootik]: https://github.com/dimkr/tootik
[Mitra]: https://codeberg.org/silverpill/mitra
[interoperability]: https://github.com/fedify-dev/fedify/blob/main/FEDERATION.md#fep-ef61-interoperability
