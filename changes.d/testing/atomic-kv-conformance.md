---
links:
  '#1361': https://github.com/fedify-dev/fedify/issues/1361
  '#1363': https://github.com/fedify-dev/fedify/issues/1363
  '#1395': https://github.com/fedify-dev/fedify/pull/1395
  '#1440': https://github.com/fedify-dev/fedify/pull/1440
---
 -  Added `testAtomicKvStore()` to check custom atomic key–value stores with
    isolated pairs of clients.  The suite checks snapshots, conditional
    batches, expiry, and rejection without partial writes, with options for
    backend key scope, TTL durations, object member order comparison, and
    batch-limit probes.  Read-limit probes can repeat keys.  Expiry waits
    support fractional milliseconds.  Single and batch CAS results
    for reordered object members are checked for consistency even when
    `objectKeyOrder` is omitted.
    [[#1361], [#1363], [#1395], [#1440]]
