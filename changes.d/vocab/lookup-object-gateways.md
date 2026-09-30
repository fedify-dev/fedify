---
links:
  '#1158': https://github.com/fedify-dev/fedify/issues/1158
  '#1194': https://github.com/fedify-dev/fedify/pull/1194
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Added a `gateways` option to `lookupObject()` and
    `Context.lookupObject()`, so applications can look up a bare
    [FEP-ef61] portable object ID without constructing location hints or
    providing a custom document loader.  The listed gateways are tried in
    order in place of any `@gateway` hints.  [[#288], [#1158], [#1194]]

[FEP-ef61]: https://w3id.org/fep/ef61
