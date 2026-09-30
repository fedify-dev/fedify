---
links:
  '#1148': https://github.com/fedify-dev/fedify/issues/1148
  '#1178': https://github.com/fedify-dev/fedify/pull/1178
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Added validation of the `gateways` of [FEP-ef61] portable actors, which
    FEP-ef61 requires to be a non-empty list of HTTP(S) URIs with an empty
    path, query, and fragment.  `verifyPortableObjectProof()` and
    `verifyPortableObject()` now reject a portable actor whose `gateways` is
    missing or empty, or has any other item, with the new `invalidGateways`
    reason, even if its proofs are valid, so such an actor is no longer looked
    up, accepted in an inbox, or served through the gateway endpoint.  If an
    actor dispatcher returns a portable actor with such `gateways`, Fedify
    logs a warning.  An incoming activity that embeds an actor with a gateway
    that has a path, query, or fragment is now rejected with
    `400 Bad Request` as malformed, instead of failing with an error.
    [[#288], [#1148], [#1178]]

[FEP-ef61]: https://w3id.org/fep/ef61
