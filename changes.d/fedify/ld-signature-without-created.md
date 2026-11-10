---
links:
  '#1406': https://github.com/fedify-dev/fedify/issues/1406
  '#1413': https://github.com/fedify-dev/fedify/pull/1413
---
 -  Fixed incoming Linked Data Signatures without a `created` field being
    treated as unsigned.  Valid `RsaSignature2017` signatures without that field
    now verify through the JSON-LD APIs and inbox, including queued inbox
    processing.  Malformed signature objects now produce a debug log with
    their property names.  Outgoing signatures still include `created`.
    [[#1406], [#1413]]
