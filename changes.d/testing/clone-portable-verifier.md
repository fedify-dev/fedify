---
links:
  '#1399': https://github.com/fedify-dev/fedify/issues/1399
  '#1442': https://github.com/fedify-dev/fedify/pull/1442
---
 -  Fixed `MockFederation.receiveActivity()` dropping the default [FEP-ef61]
    portable object verifier of the received activity when it attaches its
    document loaders to the activity passed to inbox listeners.
    [[#1399], [#1442]]

[FEP-ef61]: https://w3id.org/fep/ef61
