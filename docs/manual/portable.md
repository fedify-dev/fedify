---
description: >-
  Fedify supports a profile of FEP-ef61 portable objects.  This section
  explains which parts of FEP-ef61 Fedify implements, where it deliberately
  differs from the current FEP text, and what it does not support yet.
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
not settled yet, and without some parts of the FEP.  This section describes
that profile as a whole, so that you and other implementers can tell what to
expect from a Fedify server.  Each feature is explained in detail in the
section it links to.

[FEP-ef61]: https://w3id.org/fep/ef61
[DID]: https://www.w3.org/TR/did-core/
[FEP-8b32]: https://w3id.org/fep/8b32


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

The following work for Fedify 2.4 is still in progress:

 -  Support for portable objects in the `fedify` CLI ([#1156]).
 -  Testing against other implementations of FEP-ef61 ([#1097]).  Until
    then, Fedify's profile has been checked only against Fedify itself and
    against fixtures modeled on other implementations.

*[DID]: Decentralized Identifier
*[FEP]: Fediverse Enhancement Proposal

[FEP-ae97]: https://w3id.org/fep/ae97
[#1097]: https://github.com/fedify-dev/fedify/issues/1097
[#1156]: https://github.com/fedify-dev/fedify/issues/1156
