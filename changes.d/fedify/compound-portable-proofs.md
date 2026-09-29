---
links:
  '#1041': https://github.com/fedify-dev/fedify/pull/1041
  '#1094': https://github.com/fedify-dev/fedify/issues/1094
  '#1102': https://github.com/fedify-dev/fedify/pull/1102
  '#1133': https://github.com/fedify-dev/fedify/issues/1133
  '#1138': https://github.com/fedify-dev/fedify/pull/1138
  '#288': https://github.com/fedify-dev/fedify/issues/288
  '#938': https://github.com/fedify-dev/fedify/issues/938
---
 -  Security: Inbox processing now independently verifies each portable actor,
    activity, and object in a compound JSON document against its own map-local
    Object Integrity Proof before dispatch.  A valid outer proof no longer
    authenticates an unsigned or invalid nested portable object.
    Portable documents with proof sets or which exceed the inbox compound
    traversal limits are rejected as unsupported.  The top-level Linked
    Data Signature of an activity is not part of any proof input, so an
    activity that carries both proofs and a Linked Data Signature is
    accepted.  An unsigned key embedded in the `publicKey` or
    `assertionMethod` of a verified portable actor needs no proof of its own
    if its ID is the actor's compatible identifier or `ap:` or `ap+ef61:` URI
    plus a non-empty fragment, as with the keys that [FEP-ae97] clients make
    for their actors, which Mitra serves under `ap:` URIs.
    [[#288], [#938], [#1041], [#1094], [#1102], [#1133], [#1138]]

[FEP-ae97]: https://w3id.org/fep/ae97
