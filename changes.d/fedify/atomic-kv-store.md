---
links:
  '#1361': https://github.com/fedify-dev/fedify/issues/1361
  '#1363': https://github.com/fedify-dev/fedify/issues/1363
  '#1395': https://github.com/fedify-dev/fedify/pull/1395
---
 -  Added `AtomicKvStore`, `isAtomicKvStore()`, and optional multi-key methods
    on `KvStore` for snapshot reads and all-or-nothing writes, deletions, and
    compare-and-swap (CAS) batches.  `MemoryKvStore` implements the atomic
    contract for development and tests.  [[#1361], [#1363], [#1395]]

    The PostgreSQL, Redis, PGlite, SQLite, MySQL/MariaDB, and Cloudflare D1
    adapters also implement `AtomicKvStore`.  `isAtomicKvStore()` checks method
    presence only; it does not verify backend requirements or durability.
    Check each adapter's supported scope and limits in the
    [atomic operations guide][atomic-kv-guide].

    `MemoryKvStore` now rejects attempts to store `undefined`; use `delete()`
    or a CAS with `newValue: undefined` to delete a value.  It also rejects a
    TTL on a CAS deletion, removes deleted entries from listings, and reports
    invalid TTLs through rejected promises.  It rejects invalid batches without
    partial writes.

[atomic-kv-guide]: https://fedify.dev/manual/kv#atomic-operations-across-keys
