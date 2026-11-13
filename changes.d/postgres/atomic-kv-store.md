---
links:
  '#1361': https://github.com/fedify-dev/fedify/issues/1361
  '#1364': https://github.com/fedify-dev/fedify/issues/1364
  '#1429': https://github.com/fedify-dev/fedify/pull/1429
---
 -  Added atomic multi-key snapshots, writes, deletions, and conditional updates
    to `PostgresKvStore` through the `AtomicKvStore` interface.  Conditional
    batches and multi-key deletions require pooled or sequentially used
    `READ COMMITTED` transaction clients; reserved clients reject these
    scopes.  Nonempty batches reject active row-level security to prevent
    policies from filtering individual mutations.  Mutating single-key `cas()`
    calls also serialize table writes and roll back trigger-skipped matching
    mutations instead of returning `false`.  `PostgresKvStore.cas()` now
    rejects a `ttl` option when deleting (`newValue` is `undefined`), where it
    previously ignored the TTL.  Omit `ttl` when deleting.
    [[#1361], [#1364], [#1429]]
