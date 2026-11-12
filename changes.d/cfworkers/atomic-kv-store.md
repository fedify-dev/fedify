---
links:
  '#1361': https://github.com/fedify-dev/fedify/issues/1361
  '#1379': https://github.com/fedify-dev/fedify/issues/1379
  '#1432': https://github.com/fedify-dev/fedify/pull/1432
---
 -  Added atomic multi-key snapshots, writes, deletions and conditional
    updates to `WorkersD1KvStore`.  Applications can now reserve a record
    and update a shared budget together, with every comparison checked
    before any change commits.  Single-key and multi-key CAS share JSON
    comparison and millisecond TTL rules; oversized calls reject instead
    of splitting.  [[#1361], [#1379], [#1432]]

    Production D1 migrations must create both the entry table and its
    `<tableName>_atomic` guard table, plus the expiry index, before using
    `initialized: true`.  Pass the D1 binding for fresh primary snapshots;
    caller-owned sessions can read stale replicas.  `WorkersKvStore`
    remains without CAS or atomic multi-key support.
