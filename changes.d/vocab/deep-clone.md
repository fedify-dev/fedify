---
links:
  '#1243': https://github.com/fedify-dev/fedify/issues/1243
  '#1337': https://github.com/fedify-dev/fedify/pull/1337
---
 -  Added `deepClone()` to vocabulary objects to copy nested objects before
    resolving their properties, keeping the source graph unchanged.  Replacement
    values are copied too.  Use `clone()` when a shallow copy is sufficient.
    Large sparse property arrays retain their length and holes without creating
    per-slot trust bookkeeping.  Keep arrays stable while copying; newly added
    entries may not be visited.  Accessor and serialization traversal costs are
    unchanged.  [[#1243], [#1337]]
