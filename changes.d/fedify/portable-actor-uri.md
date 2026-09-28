---
links:
  '#1114': https://github.com/fedify-dev/fedify/pull/1114
  '#288': https://github.com/fedify-dev/fedify/issues/288
  '#841': https://github.com/fedify-dev/fedify/issues/841
---
 -  Added the `Context.getPortableActorUri()` method, which builds the
    [FEP-ef61] portable ID of an actor from its actor dispatcher's path and
    a DID, e.g., `ap+ef61://did:key:z6Mk.../users/alice`.  Like
    `Context.getPortableObjectUri()`, the DID can be omitted while handling
    a gateway request, in which case the DID in the request path is used.
    Custom implementations of the `Context` interface need to implement the
    new method.  [[#288], [#841], [#1114]]

 -  The actor dispatcher now serves portable actors through the FEP-ef61
    gateway endpoint, e.g.,
    `GET /.well-known/apgateway/did:key:z6Mk.../users/alice`, the same way
    object dispatchers serve portable objects, so a portable actor whose ID
    `Context.getPortableActorUri()` builds can be fetched at its compatible
    identifier without registering an extra object dispatcher.  The actor is
    served only if its ID canonically equals the requested portable ID and it
    has an Object Integrity Proof made with a key of the DID, and
    `RequestContext.portableRequest` is set for such requests.  Applications
    that do not have portable actors are unaffected, except that their actor
    dispatchers may be called for such requests.  [[#288], [#841], [#1114]]

 -  `Context.getPortableActorUri()`, `Context.getPortableObjectUri()`, and
    `Context.getPortableInboxUri()` now throw a `TypeError` if the DID is
    a `did:key` DID that is not encoded in base58-btc, as FEP-ef61 requires,
    so that the same key does not yield two different portable IDs.  Use
    `exportDidKey()` from `@fedify/vocab-runtime` to make such DIDs.
    Likewise, the gateway endpoint responds with `400 Bad Request` to
    requests whose path has such a DID.  [[#288], [#841], [#1114]]

[FEP-ef61]: https://w3id.org/fep/ef61
