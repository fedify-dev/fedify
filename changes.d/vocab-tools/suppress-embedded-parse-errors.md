---
links:
  '#1136': https://github.com/fedify-dev/fedify/pull/1136
  '#937': https://github.com/fedify-dev/fedify/issues/937
---
 -  Fixed generated vocabulary accessors ignoring `suppressError: true` when
    parsing embedded JSON-LD values.  Generated iterators now skip malformed
    values, and singular accessors return `null`; calls without suppression
    continue to throw.  [[#937], [#1136]]
