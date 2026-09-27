---
links:
  '#1078': https://github.com/fedify-dev/fedify/issues/1078
  '#1079': https://github.com/fedify-dev/fedify/pull/1079
---
 -  Added the [FEP-7aa9] context to the preloaded JSON-LD contexts.  The default
    document loader now resolves <https://w3id.org/fep/7aa9> locally, so
    transient Codeberg Pages outages no longer prevent otherwise valid inbound
    documents from being parsed or verified.  [[#1078], [#1079]]

[FEP-7aa9]: https://w3id.org/fep/7aa9
