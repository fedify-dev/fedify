---
links:
  '#1017': https://github.com/fedify-dev/fedify/issues/1017
---
 -  `KvKeyCache` and `KvSpecDeterminer` now write their cache entries with a
    TTL, so a `KvStore` that never sees an explicit clear no longer
    accumulates entries for actors and origins that have stopped
    federating.  [[#1017]]

     -  `KvKeyCache` gained a `KvKeyCacheOptions.keyTtl` option for cached
        keys, `30` days by default.
     -  `KvSpecDeterminer`'s constructor gained an optional 4th
        `KvSpecDeterminerOptions` argument with a `specTtl` option for
        remembered specs, `90` days by default.  Its existing 3-argument
        constructor shape is unchanged.
     -  Entries written by earlier Fedify versions have no TTL and are left
        as is; see the new *Clearing legacy cache entries* section of the
        [key–value store guide] if you want to expire them proactively
        instead of waiting for them to be overwritten.

[key–value store guide]: https://fedify.dev/manual/kv
