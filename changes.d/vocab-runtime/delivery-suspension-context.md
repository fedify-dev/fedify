---
links:
  '#1369': https://github.com/fedify-dev/fedify/issues/1369
  '#1435': https://github.com/fedify-dev/fedify/pull/1435
---
 -  Added the [FEP-f799] context to the preloaded JSON-LD contexts.  The default
    document loader now resolves <https://w3id.org/fep/f799> locally, so
    otherwise valid inbound documents can be parsed or verified without
    depending on the remote context server.  [[#1369], [#1435]]

[FEP-f799]: https://w3id.org/fep/f799
