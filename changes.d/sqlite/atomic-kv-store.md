---
links:
  '#1361': https://github.com/fedify-dev/fedify/issues/1361
  '#1367': https://github.com/fedify-dev/fedify/issues/1367
  '#1430': https://github.com/fedify-dev/fedify/pull/1430
  '#1440': https://github.com/fedify-dev/fedify/pull/1440
---
 -  Added `AtomicKvStore` support to `SqliteKvStore` for consistent snapshots
    and all-or-nothing changes across keys.  `set(key, undefined)` now rejects
    instead of doing nothing; skip the call to preserve the former no-op, or
    use `delete()` or `deleteMany()` for unconditional removal.  A non-null TTL
    on CAS deletion also rejects; keep the CAS condition by using
    `newValue: undefined` without a TTL.  Nonempty batch and mutation calls
    require a writable connection outside caller-owned
    transactions, including CAS mismatches.
    [[#1361], [#1367], [#1430], [#1440]]
