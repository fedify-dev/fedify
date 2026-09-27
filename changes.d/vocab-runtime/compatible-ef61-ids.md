---
links:
  '#1074': https://github.com/fedify-dev/fedify/pull/1074
  '#288': https://github.com/fedify-dev/fedify/issues/288
  '#833': https://github.com/fedify-dev/fedify/issues/833
---
 -  Added `toCompatibleEf61Id()` and `fromCompatibleEf61Id()` for converting
    between [FEP-ef61] portable IDs and compatible identifiers, which are
    HTTP(S) URLs under a gateway's fixed `/.well-known/apgateway/` path that
    software without portable IRI support can use.  `toCompatibleEf61Id()`
    removes location hints (`@gateway` query parameters, and the legacy
    `gateways` parameter), and `fromCompatibleEf61Id()` returns
    `null` for URLs that are not compatible identifiers and throws a
    `TypeError` for malformed ones, including those with location hints.
    Converting a compatible identifier does not authenticate it; the object's
    proof still has to be verified against its DID.  [[#288], [#833], [#1074]]

[FEP-ef61]: https://w3id.org/fep/ef61
