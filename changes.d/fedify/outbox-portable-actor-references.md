---
links:
  '#1159': https://github.com/fedify-dev/fedify/issues/1159
  '#1189': https://github.com/fedify-dev/fedify/pull/1189
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Fixed outbox listeners rejecting a posted activity with
    `400 Bad Request` when its `actor` referred to an [FEP-ef61] portable
    outbox owner in another form than the owner's ID, e.g., with `@gateway`
    location hints, another URI scheme or DID encoding, or as a compatible
    identifier on another gateway.  Portable actor IDs are now compared by
    their canonical forms, while other actor IDs still have to match exactly.
    [[#288], [#1159], [#1189]]

[FEP-ef61]: https://w3id.org/fep/ef61
