---
links:
  '#1361': https://github.com/fedify-dev/fedify/issues/1361
  '#1364': https://github.com/fedify-dev/fedify/issues/1364
  '#1429': https://github.com/fedify-dev/fedify/pull/1429
---
 -  Added atomic multi-key snapshots, writes, deletions, and conditional updates
    to `PostgresKvStore` through the `AtomicKvStore` interface.  Conditional
    batches and multi-key deletions require pooled or sequentially used
    READ COMMITTED transaction clients; reserved connections reject these
    scopes.  [[#1361], [#1364], [#1429]]
