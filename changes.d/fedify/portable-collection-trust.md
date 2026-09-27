---
links:
  '#1084': https://github.com/fedify-dev/fedify/pull/1084
  '#288': https://github.com/fedify-dev/fedify/issues/288
  '#836': https://github.com/fedify-dev/fedify/issues/836
---
 -  Added `verifyPortableObject()`, which applies the [FEP-ef61] trust policy
    to portable objects fetched through gateways.  It verifies Object
    Integrity Proofs like `verifyPortableObjectProof()`, and also accepts
    a portable collection or collection page without a proof if it was
    served by a gateway listed in the `gateways` of the actor that owns it.
    The owner must be the actor whose `inbox`, `outbox`, `followers`,
    `following`, or `liked` it is, as confirmed by the owner's signed actor
    document.  Pass it as the `verifyPortableObject` option of property
    accessors and `traverseCollection()` instead of
    `verifyPortableObjectProof()` to read portable actors' collections, such
    as their outboxes.  The new `VerifyPortableObjectOptions`,
    `VerifyPortableObjectResult`, and `VerifyPortableObjectFailureReason`
    types describe it.  [[#288], [#836], [#1084]]

[FEP-ef61]: https://w3id.org/fep/ef61
