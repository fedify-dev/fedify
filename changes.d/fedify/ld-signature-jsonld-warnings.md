---
links:
  '#1405': https://github.com/fedify-dev/fedify/issues/1405
  '#1411': https://github.com/fedify-dev/fedify/pull/1411
---
 -  Fixed Linked Data Signature verification rejecting documents with unmapped
    extension properties, such as an undefined `quoteUri`, that the sender's
    JSON-LD processor discards.  Discarded properties are not authenticated by
    the signature.  Outbound signing still rejects lossy input, and verification
    continues to reject relative IRIs and unsafe graph structures.
    [[#1405], [#1411]]
