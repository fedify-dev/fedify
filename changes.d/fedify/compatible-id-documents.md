---
links:
  '#1093': https://github.com/fedify-dev/fedify/issues/1093
  '#1105': https://github.com/fedify-dev/fedify/pull/1105
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Changed Fedify to treat documents whose IDs are [FEP-ef61] compatible
    identifiers, such as
    `https://gw.example/.well-known/apgateway/did:key:z6Mk.../actor`, as the
    portable objects they stand for, as FEP-ef61 requires.  Some
    implementations, e.g., tootik, identify their portable actors this way.
    Previously, Fedify trusted such documents by the web origin that served
    them, so any server could act as
    `https://evil.example/.well-known/apgateway/did:key:z6MkAlice/actor`
    without a proof by Alice's DID.  [[#288], [#1093], [#1105]]

     -  `verifyPortableObjectProof()` now verifies a document whose `@id` is
        a compatible identifier against the DID in it, instead of reporting
        it as `notPortableObject`.  The proof is verified over the document
        as is.

     -  Inboxes now reject an activity of an actor whose ID is a compatible
        identifier with `401 Unauthorized` unless it has a valid Object
        Integrity Proof made by the actor's DID, as they already did for
        actors with `ap:` IDs.  Likewise, an activity whose own ID is an
        `ap:` URI or a compatible identifier is rejected unless its proof is
        made by the DID of that ID, and embedded maps with compatible
        identifiers need their own proofs as embedded portable objects do.
        The exception is a key embedded in the `publicKey` or
        `assertionMethod` of a verified portable actor, such as a gateway
        key, whose ID is the actor's compatible identifier plus a fragment;
        the actor's proof covers it.
        Activities of actors that publish compatible identifiers without
        signing them, or whose DIDs use key types Fedify does not support,
        are no longer accepted.

     -  `verifyObject()` now accepts an Object Integrity Proof made by a DID
        as authenticating an attribution or actor whose compatible identifier
        has that DID, and never authenticates such an attribution by a key at
        an ordinary URL.

     -  HTTP Signature verification now resolves a gateway key whose actor
        document has a compatible identifier as its ID the same way as for
        actors with `ap:` IDs, and rejects the key if the document does not
        have a valid proof by the actor's DID, instead of trusting the
        gateway's web origin.  A key at an ordinary URL that claims
        a portable actor as its owner or controller is no longer that actor's
        key, and `getKeyOwner()` and `doesActorOwnKey()` no longer resolve
        portable actors by web origin.

     -  `Context.sendActivity()` now applies the compound-proof key selection
        to activities that embed objects with compatible identifiers, as it
        does for embedded objects with `ap:` IDs, so that Fedify inboxes
        accept what it sends.

 -  Changed HTTP Signature verification to accept a gateway key of a portable
    actor that the actor's signed document embeds only in its `publicKey`,
    with the actor as its `owner`, when no `assertionMethod` entry has the
    key ID.  Some publishers, e.g., tootik, list their RSA keys only there.
    A document that has more than one entry with the key ID in either
    property is rejected.  [[#288], [#1093], [#1105]]

 -  Changed the gateway trust policy for unsecured portable collections in
    `verifyPortableObject()` to accept collections and owners identified by
    compatible identifiers.  An owner with a compatible identifier is fetched
    through the gateway that the identifier names first, unless the
    `gateways` option is given.  [[#288], [#1093], [#1105]]

[FEP-ef61]: https://w3id.org/fep/ef61
