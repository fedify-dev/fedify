---
links:
  '#932': https://github.com/fedify-dev/fedify/issues/932
---
 -  Added the [Controlled Identifiers v1.0] context to the preloaded JSON-LD
    contexts.  The default document loader now resolves
    <https://www.w3.org/ns/cid/v1> locally, so transient W3C outages no longer
    prevent otherwise valid inbound documents from being parsed or verified.
    [[#932]]

[Controlled Identifiers v1.0]: https://www.w3.org/TR/cid-1.0/
