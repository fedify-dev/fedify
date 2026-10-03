---
links:
  '#1211': https://github.com/fedify-dev/fedify/issues/1211
  '#1216': https://github.com/fedify-dev/fedify/pull/1216
---
 -  Added the [FEP-6757] context to the preloaded JSON-LD contexts.  The default
    document loader now resolves <https://w3id.org/fep/6757> locally, so
    transient Codeberg Pages outages no longer prevent otherwise valid inbound
    documents from being parsed or verified.  [[#1211], [#1216]]

[FEP-6757]: https://w3id.org/fep/6757
