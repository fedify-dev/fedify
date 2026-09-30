---
links:
  '#1157': https://github.com/fedify-dev/fedify/issues/1157
  '#1179': https://github.com/fedify-dev/fedify/pull/1179
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Changed the actor URI mismatch rules to accept the [FEP-ef61] portable
    IDs of actors and collections, and the compatible identifiers built from
    them, so that applications can use the `getPortable*Uri()` methods of
    `Context` in actor dispatchers without disabling these rules.
    [[#288], [#1157], [#1179]]

[FEP-ef61]: https://w3id.org/fep/ef61
