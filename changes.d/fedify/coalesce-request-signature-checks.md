---
links:
  '#1313': https://github.com/fedify-dev/fedify/issues/1313
  '#1315': https://github.com/fedify-dev/fedify/pull/1315
---
 -  Fixed repeated HTTP signature verification and signing-key owner lookups
    when a request context was checked concurrently with the same document
    and context loaders.  Results of `null`, including failed lookups, are
    now reused for those loaders within the request; checks that reject can
    still be retried.  [[#1313], [#1315]]
