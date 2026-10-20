---
links:
  '#1313': https://github.com/fedify-dev/fedify/issues/1313
  '#1315': https://github.com/fedify-dev/fedify/pull/1315
---
 -  Fixed repeated HTTP signature verification and signing-key owner lookups
    when a request context was checked concurrently with the same document
    and context loaders.  `null` key-verification and owner-lookup results
    are now reused for those loaders within the request; checks that reject
    can still be retried.  An owner result of `null` caused by an unverified
    key is not retained, allowing an owner lookup after another loader verifies
    the key.  [[#1313], [#1315]]
