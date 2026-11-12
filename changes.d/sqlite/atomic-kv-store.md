---
links:
  '#1361': https://github.com/fedify-dev/fedify/issues/1361
  '#1367': https://github.com/fedify-dev/fedify/issues/1367
  '#1430': https://github.com/fedify-dev/fedify/pull/1430
---
 -  Added `AtomicKvStore` support to `SqliteKvStore` for consistent snapshots
    and all-or-nothing changes across keys.  `set(key, undefined)` and TTLs on
    CAS deletion now reject; use explicit deletion methods instead.  Nonempty
    batch and mutation calls require a writable connection outside caller-owned
    transactions, including CAS mismatches.  [[#1361], [#1367], [#1430]]
