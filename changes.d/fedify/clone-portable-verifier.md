---
links:
  '#1399': https://github.com/fedify-dev/fedify/issues/1399
  '#1442': https://github.com/fedify-dev/fedify/pull/1442
---
 -  Fixed `signObject()` and the default activity transformers,
    `autoIdAssigner()` and `actorDehydrator()`, dropping the default [FEP-ef61]
    portable object verifier of the object they returned a copy of.  Their
    results now keep the verifier, so their accessors verify portable objects
    as the original object's accessors do, and they no longer log
    the warning that `clone()` logs when it drops the verifier.
    [[#1399], [#1442]]

[FEP-ef61]: https://w3id.org/fep/ef61
