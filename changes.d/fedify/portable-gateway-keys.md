---
links:
  '#1099': https://github.com/fedify-dev/fedify/pull/1099
  '#288': https://github.com/fedify-dev/fedify/issues/288
  '#840': https://github.com/fedify-dev/fedify/issues/840
---
 -  Added support for HTTP Signature keys that gateways use on behalf of
    [FEP-ef61] portable actors, which Fedify calls *gateway keys*.  Register
    the new `ActorCallbackSetters.mapPortableActorId()` callback to tell
    Fedify which actors are portable, and `Context.getActorKeyPairs()` then
    identifies their dispatched key pairs by the actor's compatible identifier
    on this server, e.g.,
    `https://example.com/.well-known/apgateway/did:key:z6Mk.../actors/alice#main-key`,
    with the portable actor as their owner, and with the same IDs for their
    `CryptographicKey` and `Multikey` forms so that they can be listed in the
    actor's `assertionMethods` as FEP-ef61 requires.  Requests made on behalf
    of such actors, including activity deliveries and signed fetches, are
    signed with these keys.  The new `PortableActorIdMapper` type describes the
    callback.  [[#288], [#840], [#1099]]

 -  Changed HTTP Signature verification to accept a gateway key of a portable
    actor if the actor's document, fetched from the key ID, has a valid Object
    Integrity Proof made by the actor's DID, embeds the key in its
    `assertionMethod`, and lists the gateway in its `gateways`.  Such a key is
    owned by the portable actor, so `RequestContext.getSignedKeyOwner()`,
    `getKeyOwner()`, and `doesActorOwnKey()` return or match the portable
    actor.  Previously, no gateway key of a portable actor could be verified.
    [[#288], [#840], [#1099]]

 -  Changed inboxes to reject activities of portable actors that do not have
    a valid Object Integrity Proof made by the actor's DID with
    `401 Unauthorized`, even if the request has a valid HTTP Signature or the
    activity has a valid Linked Data Signature.  [[#288], [#840], [#1099]]

 -  Changed `Context.sendActivity()` so that keys whose IDs are FEP-ef61
    compatible identifiers, such as gateway keys, never make Object Integrity
    Proofs or Linked Data Signatures; they only sign HTTP requests.  Also,
    activities of portable actors never get Linked Data Signatures, and have
    to have portable IDs of the actors' DIDs, and an unsigned portable
    activity is signed only by a key whose ID is a DID URL for its DID, even
    if it is the only Ed25519 key.  In these cases `sendActivity()` rejects
    with a `TypeError` before anything is delivered or queued.  Sign
    portable activities with `signObject()` beforehand, or pass the DID's key
    as an explicit sender key.  [[#288], [#840], [#1099]]

 -  Changed key lookups so that keys whose IDs are FEP-ef61 compatible
    identifiers are no longer read from or written to the `KeyCache`, as
    whether such a key is valid depends on what it is used for.  `fetchKey()`
    and `fetchKeyDetailed()` do not resolve gateway keys of portable actors.
    [[#288], [#840], [#1099]]

[FEP-ef61]: https://w3id.org/fep/ef61
