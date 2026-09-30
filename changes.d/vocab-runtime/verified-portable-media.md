---
links:
  '#1152': https://github.com/fedify-dev/fedify/issues/1152
  '#1182': https://github.com/fedify-dev/fedify/pull/1182
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Added `fetchPortableMedia()` to retrieve [FEP-ef61] hashlink media through
    an actor's gateways or HTTP(S) media directly, and return the resource only
    after verifying its `digestMultibase`.  It rejects missing or mismatched
    digests, limits response size, and checks private network addresses by
    default.  [[#288], [#1152], [#1182]]

[FEP-ef61]: https://w3id.org/fep/ef61
