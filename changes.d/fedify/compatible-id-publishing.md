---
links:
  '#1106': https://github.com/fedify-dev/fedify/issues/1106
  '#1109': https://github.com/fedify-dev/fedify/pull/1109
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Added support for publishing [FEP-ef61] portable actors and objects whose
    IDs are compatible identifiers, such as
    `https://example.com/.well-known/apgateway/did:key:z6Mk.../actor`, for
    interoperability with software that cannot handle `ap:` URIs.  Fedify now
    treats such an actor or object as portable wherever it publishes one, as
    it already did for those with `ap:` or `ap+ef61:` IDs.  Build compatible
    identifiers with `toCompatibleEf61Id()` and the first gateway of the
    actor before signing the documents; portable IDs remain the recommended
    form.  [[#288], [#1106], [#1109]]

     -  `Context.sendActivity()` now requires an activity of an actor whose
        ID is a compatible identifier to have an `ap:` or `ap+ef61:` ID or
        a compatible identifier of the actor's DID, and signs an unsigned one
        only with the key whose ID is a DID URL for that DID, instead of
        sending activities that FEP-ef61 receivers reject.  A malformed
        compatible actor or activity ID, e.g., one with `@gateway` location
        hints, is rejected with a `TypeError`.

     -  The FEP-ef61 gateway endpoint now serves an object whose ID is
        a compatible identifier of the requested portable object, on any
        gateway, instead of responding with `404 Not Found`.

     -  Portable inboxes now accept deliveries on behalf of actors whose IDs
        or inboxes are compatible identifiers, and forward each activity to
        the other gateways at most once whether its ID is an `ap:` URI or
        a compatible identifier.

     -  WebFinger now takes the domain of such an actor's address from its
        first gateway, and uses its ID as the `self` link.

     -  Actor dispatchers no longer warn that such an actor's ID or collection
        URIs do not match the URIs that `Context` builds, but warn if its ID
        is a malformed compatible identifier or is not on its first gateway,
        as FEP-ef61 requires.

[FEP-ef61]: https://w3id.org/fep/ef61
