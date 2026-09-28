---
links:
  '#1084': https://github.com/fedify-dev/fedify/pull/1084
  '#1090': https://github.com/fedify-dev/fedify/issues/1090
  '#1091': https://github.com/fedify-dev/fedify/pull/1091
  '#288': https://github.com/fedify-dev/fedify/issues/288
  '#836': https://github.com/fedify-dev/fedify/issues/836
---
 -  Property accessors now tell the `verifyPortableObject` function where
    a portable object was retrieved from and which objects led to it, so
    that it can apply the [FEP-ef61] trust policy for portable collections
    served without proofs.  Accessors of such an unsecured collection do not
    trust the objects embedded in it, even with `crossOrigin: "trust"`;
    they fetch and verify each of them on its own, and drop the ones without
    an `@id`.  [[#288], [#836], [#1084], [#1090], [#1091]]

 -  Added `crossOrigin`, `gateways`, and `verifyPortableObject` options to
    `TraverseCollectionOptions`, so that `traverseCollection()` can traverse
    [FEP-ef61] portable collections through gateways.
    [[#288], [#836], [#1084], [#1090], [#1091]]

[FEP-ef61]: https://w3id.org/fep/ef61
