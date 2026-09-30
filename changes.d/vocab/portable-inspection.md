---
links:
  '#1156': https://github.com/fedify-dev/fedify/issues/1156
  '#1199': https://github.com/fedify-dev/fedify/pull/1199
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Changed the inspection of vocabulary objects, e.g., with `console.log()`,
    `util.inspect()`, or `Deno.inspect()`, to show [FEP-ef61] portable IDs
    in their canonical form, e.g., `ap+ef61://did:key:z6Mk.../actor`, instead
    of the percent-encoded form of the `URL` objects that represent them,
    e.g., `ap+ef61://did%3Akey%3Az6Mk.../actor`.  [[#288], [#1156], [#1199]]

[FEP-ef61]: https://w3id.org/fep/ef61
