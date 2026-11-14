---
links:
  '#1361': https://github.com/fedify-dev/fedify/issues/1361
  '#1366': https://github.com/fedify-dev/fedify/issues/1366
  '#1431': https://github.com/fedify-dev/fedify/pull/1431
  '#1440': https://github.com/fedify-dev/fedify/pull/1440
---
 -  Added atomic snapshots and multi-key writes, deletions, and conditional
    updates to `PgliteKvStore` through `AtomicKvStore`.  Wrappers sharing one
    PGlite owner can commit related keys together with JSONB comparison and
    per-entry TTLs.  [[#1361], [#1366], [#1431], [#1440]]

    Malformed keys, negative or overflowing TTLs, and TTLs on CAS deletions
    now reject before mutation.  Mutation cleanup shares the transaction,
    so cleanup failures roll back writes; legacy invalid TTL rows require
    removal together or direct SQL remediation.

    Existing single-key mutations and the new batch mutations await the
    PGlite owner's filesystem synchronization policy after a successful
    transaction, including read-only CAS mismatches.  If synchronization fails,
    the operation rejects instead of returning `false`; any committed mutations
    remain applied, so retrying blindly can repeat a change.
