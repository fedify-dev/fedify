---
links:
  '#1136': https://github.com/fedify-dev/fedify/pull/1136
  '#937': https://github.com/fedify-dev/fedify/issues/937
---
 -  Fixed `suppressError: true` being ignored when vocabulary accessors parsed
    embedded JSON-LD values.  Malformed values are now skipped by iterators or
    returned as `null` by singular accessors; calls without suppression continue
    to throw.  [[#937], [#1136]]
