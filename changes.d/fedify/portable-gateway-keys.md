---
links:
  '#1095': https://github.com/fedify-dev/fedify/issues/1095
  '#1096': https://github.com/fedify-dev/fedify/issues/1096
  '#1099': https://github.com/fedify-dev/fedify/pull/1099
  '#1119': https://github.com/fedify-dev/fedify/pull/1119
  '#1123': https://github.com/fedify-dev/fedify/issues/1123
  '#1132': https://github.com/fedify-dev/fedify/issues/1132
  '#1134': https://github.com/fedify-dev/fedify/pull/1134
  '#1164': https://github.com/fedify-dev/fedify/pull/1164
  '#1165': https://github.com/fedify-dev/fedify/pull/1165
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
    actor.  Given the very key that HTTP Signature verification returned,
    they take the actor from the document it verified rather than fetching
    and verifying the document again.  The document may list the key under
    the key ID itself or under the `ap:` URI with the same canonical ID, as
    Mitra does, but not under both, nor under a compatible identifier on
    another gateway.  Previously, no gateway key of a portable actor could be
    verified.  [[#288], [#840], [#1096], [#1099], [#1123], [#1134], [#1164]]

 -  Changed HTTP Signature verification to accept a key of a portable actor
    itself whose ID is an `ap:` or `ap+ef61:` URI, e.g.,
    `ap://did:key:z6Mk.../actor?@gateway=https%3A%2F%2Fexample.com#main-key`.
    Fedify fetches the actor's document from the gateways in the key ID's
    `@gateway` location hints, or, without them, asks the document loader for
    the `ap:` URI itself, and accepts the key if the document has a valid
    Object Integrity Proof made by the actor's DID, embeds the key under
    the `ap:` URI, and has a valid gateway.  Since the signer chooses the
    hints, only the first three are followed, and all the gateways share
    a timeout of ten seconds; a lookup that runs out of time is reported as
    a `keyFetchError` without an HTTP status.  Such a key is used only for
    HTTP Signatures, and is owned by the portable actor like a gateway key.
    Keys at `ap:` URIs are never used to make Object Integrity Proofs or
    Linked Data Signatures either.  [[#288], [#1096], [#1132], [#1134], [#1165]]

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
    identifiers are cached apart for each purpose, as whether such a key is
    valid depends on what it is used for: a gateway key cached for an HTTP
    Signature is never used for an Object Integrity Proof or a Linked Data
    Signature, and a key rejected for one of them is not rejected for
    the others.  A failure to fetch such a key, e.g., a network error or
    `404 Not Found`, fails every purpose alike and is cached like that of any
    other key.  A gateway key is cached for an hour at most, and never
    beyond the expiration of the proof on the actor's document, since
    the actor can drop the gateway from its document at any time.
    `fetchKey()` and `fetchKeyDetailed()` do not resolve gateway keys of
    portable actors.
    [[#288], [#840], [#1095], [#1099], [#1119]]

     -  Only the key cache that Fedify's inbox uses caches keys at compatible
        identifiers apart for each purpose.  A custom `KeyCache` passed to
        `verifyRequest()`, `fetchKey()`, and the like caches only the
        failures to fetch them.

[FEP-ef61]: https://w3id.org/fep/ef61
