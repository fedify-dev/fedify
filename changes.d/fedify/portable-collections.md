---
links:
  '#1111': https://github.com/fedify-dev/fedify/issues/1111
  '#1142': https://github.com/fedify-dev/fedify/pull/1142
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Added serving of [FEP-ef61] portable collections through the gateway
    endpoint, e.g.,
    `GET /.well-known/apgateway/did:key:z6Mk.../users/alice/outbox`, by the
    existing collection dispatchers, including the inbox collection, so that a
    portable actor's outbox and other collections are no longer tied to a
    single server.  Fedify serves such a collection only if the actor whose
    identifier is in its path is a portable actor under the requested DID whose
    corresponding property, e.g., `outbox`, refers to the collection; otherwise
    it responds with `404 Not Found`.  The collection and its pages keep the
    actor's form of the ID, a portable ID or a compatible identifier, identify
    pages with the `cursor` query parameter, and have `attributedTo` set to the
    actor.  The collection's `authorize()` predicate is applied before anything
    is dispatched.  The collection itself is served without an Object Integrity
    Proof, as FEP-ef61 allows, but it is refused with
    `500 Internal Server Error` if it embeds a portable actor, activity, or
    object without a valid proof made with a key of the DID in its ID.
    Applications without portable actors are unaffected, except that their
    actor dispatchers may be called for such requests.
    [[#288], [#1111], [#1142]]

 -  Added the `Context.getPortableOutboxUri()`,
    `Context.getPortableFollowingUri()`, `Context.getPortableFollowersUri()`,
    `Context.getPortableLikedUri()`, `Context.getPortableFeaturedUri()`,
    `Context.getPortableFeaturedTagsUri()`, and
    `Context.getPortableCollectionUri()` methods, which build the portable IDs
    of an actor's collections and of custom collections from the same paths
    as their non-portable counterparts and a DID.  On a `RequestContext`, the
    DID defaults to the one in the gateway request.  Custom implementations of
    the `Context` interface need to implement the new methods.
    [[#288], [#1111], [#1142]]

 -  Added the `CustomCollectionCallbackSetters.mapPortableOwner()` method and
    the `PortableCollectionOwnerMapper` type.  A custom collection is served
    through the FEP-ef61 gateway endpoint only if this callback maps it to
    a portable actor under the requested DID.  [[#288], [#1111], [#1142]]

 -  Changed the actor dispatcher to warn when a portable actor's collection
    property is a portable ID or a compatible identifier that does not match
    the one that the corresponding `Context.getPortable*Uri()` method builds,
    as the gateway endpoint would not serve the collection.
    [[#288], [#1111], [#1142]]

[FEP-ef61]: https://w3id.org/fep/ef61
