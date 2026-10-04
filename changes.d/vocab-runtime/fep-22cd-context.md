---
links:
  '#1214': https://github.com/fedify-dev/fedify/issues/1214
  '#1227': https://github.com/fedify-dev/fedify/pull/1227
---
 -  Added the [FEP-22cd] context to the preloaded JSON-LD contexts.  The default
    document loader now resolves <https://w3id.org/fep/22cd> locally, so
    transient Codeberg Pages outages no longer prevent otherwise valid inbound
    documents with translation metadata from being parsed or verified.
    [[#1214], [#1227]]

[FEP-22cd]: https://w3id.org/fep/22cd
