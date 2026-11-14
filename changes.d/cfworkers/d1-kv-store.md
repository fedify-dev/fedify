---
links:
  '#1135': https://github.com/fedify-dev/fedify/issues/1135
  '#1360': https://github.com/fedify-dev/fedify/pull/1360
  '#1361': https://github.com/fedify-dev/fedify/issues/1361
  '#1379': https://github.com/fedify-dev/fedify/issues/1379
  '#1432': https://github.com/fedify-dev/fedify/pull/1432
---
 -  Added `WorkersD1KvStore`, a `KvStore` implementation backed by
    Cloudflare D1.  It is now the recommended store for Cloudflare Workers;
    consider migrating from `WorkersKvStore`.  Its consistent reads and
    single-key `cas()` enable features that Workers KV cannot support, such
    as forwarding to FEP-ef61 portable inboxes.
    [[#1135], [#1360] by Beiyan Yunyi]

    The store also implements `AtomicKvStore` for snapshot reads and
    all-or-nothing multi-key writes, deletions, and compare-and-swap (CAS)
    batches.  Single-key and multi-key CAS use the same JSON comparison and
    millisecond TTL rules.  Calls that exceed the size limits are rejected
    rather than split into smaller batches.  `WorkersKvStore` still has
    neither CAS nor atomic multi-key support.  [[#1361], [#1379], [#1432]]

    Pass the `D1Database` binding itself for fresh primary reads;
    D1 sessions created by the caller may read from stale replicas.  In
    production, create the entry table, its `<tableName>_atomic` guard table,
    and the expiry index with D1 migrations before using `initialized: true`
    to skip per-instance schema queries.  See the [D1 store guide] for the
    schema and operation limits.

[D1 store guide]: https://fedify.dev/manual/kv#workersd1kvstore-cloudflare-workers-only
