---
links:
  '#1093': https://github.com/fedify-dev/fedify/issues/1093
  '#1105': https://github.com/fedify-dev/fedify/pull/1105
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Property accessors and `lookupObject()` with the `verifyPortableObject`
    option now accept a portable object whose `@id` is an [FEP-ef61]
    compatible identifier of the requested portable object, e.g., one on the
    gateway that served it, and pass it to `verifyPortableObject`, keeping its
    own `@id`.  Previously, such documents, which some implementations such
    as tootik publish, were rejected as objects with a mismatching ID.
    [[#288], [#1093], [#1105]]

[FEP-ef61]: https://w3id.org/fep/ef61
