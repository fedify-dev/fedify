---
links:
  '#1361': https://github.com/fedify-dev/fedify/issues/1361
  '#1363': https://github.com/fedify-dev/fedify/issues/1363
  '#1395': https://github.com/fedify-dev/fedify/pull/1395
---
 -  Added `AtomicKvStore`, `isAtomicKvStore()`, and optional multi-key methods
    on `KvStore` for snapshot reads and all-or-nothing writes, deletions, and
    compare-and-swap (CAS) batches.  `MemoryKvStore` implements the atomic
    contract for development and tests.  It now rejects storing `undefined` and
    TTLs on CAS deletions, removes deleted entries from listings, and reports
    invalid TTLs through rejected promises.  Invalid batches are rejected
    without partial writes.  Use `delete()` or a CAS with `newValue: undefined`
    to delete values.  [[#1361], [#1363], [#1395]]
