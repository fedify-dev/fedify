---
links:
  '#1361': https://github.com/fedify-dev/fedify/issues/1361
  '#1365': https://github.com/fedify-dev/fedify/issues/1365
  '#1434': https://github.com/fedify-dev/fedify/pull/1434
---
 -  Added atomic snapshots and multi-key writes, deletes, and compare-and-swap
    through `RedisKvStore.getMany()`, `setMany()`, `deleteMany()`, and
    `casMany()`.  Batches support standalone Redis and one Redis Cluster hash
    slot on official Redis 7.2.17, 7.4.12, and 8.10.3; other releases reject
    nonempty batches until audited and added in a Fedify update.
    These restrictions preserve the audited atomicity guarantees; select a
    supported Redis release for nonempty batches.  Existing keys are not
    relocated.  [[#1361], [#1365], [#1434]]

    Storing `undefined` or a top-level value that JSON cannot encode now
    rejects instead of writing undecodable bytes.  CAS deletions with a
    non-null TTL reject even when the comparison would mismatch.  CAS
    success results now also handle ioredis `stringNumbers` clients.  Remove
    TTLs from CAS deletions when upgrading affected calls.  Ordinary
    single-key methods retain their existing Redis version and TTL range
    support.
