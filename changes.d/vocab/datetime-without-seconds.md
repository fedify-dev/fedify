---
links:
  '#1339': https://github.com/fedify-dev/fedify/issues/1339
  '#1347': https://github.com/fedify-dev/fedify/pull/1347
---
 -  Fixed a `RangeError` when parsing date-times without seconds, such as
    `2024-01-01T10:00Z` or `2024-01-01T10:00+09:00`, which Activity Streams 2.0
    allows.  [[#1339], [#1347] by ChanHaeng Lee]
