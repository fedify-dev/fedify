---
links:
  '#1147': https://github.com/fedify-dev/fedify/issues/1147
  '#1180': https://github.com/fedify-dev/fedify/pull/1180
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Added the optional `Recipient.gateways` property, the [FEP-ef61] gateways
    of a portable actor, through which Fedify delivers activities to its
    `ap:` or `ap+ef61:` inbox.  Every actor class already has it, so
    applications that build `Recipient` objects by hand, e.g., in followers
    collection dispatchers, need to set it only for portable actors.
    [[#288], [#1147], [#1180]]

[FEP-ef61]: https://w3id.org/fep/ef61
