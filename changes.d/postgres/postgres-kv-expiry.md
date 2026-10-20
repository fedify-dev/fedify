---
links:
  '#1308': https://github.com/fedify-dev/fedify/issues/1308
  '#1314': https://github.com/fedify-dev/fedify/pull/1314
---
 -  `PostgresKvStore` no longer scans the entire table for expired entries
    after every write.  Cleanup now deletes up to 1,000 rows per batch,
    including across partitioned or inherited tables, with a delay between
    attempts that shortens after a full batch.  Store
    instances sharing a table do not sweep it concurrently. With a pooled
    client, writes no longer wait for cleanup, and a cleanup failure no longer
    fails the write. Caller-owned transactions and reserved connections still
    await cleanup and propagate its errors to avoid hiding a rollback.  Reads
    continue to exclude expired entries before physical deletion.
    [[#1308], [#1314]]
 -  Fixed `PostgresKvStore.set()` retaining an old creation time when
    replacing an existing key.  TTLs are now measured from the SQL statement
    clock on both insert and update, and expiration checks use that same clock
    inside caller-owned transactions. Replacing an expired value works before
    its row is physically deleted, and a replacement written with a zero TTL
    still reads as absent.  [[#1308], [#1314]]
