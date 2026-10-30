---
links:
  '#1339': https://github.com/fedify-dev/fedify/issues/1339
  '#1347': https://github.com/fedify-dev/fedify/pull/1347
---
 -  Fixed inbox handling that treated valid date-times without seconds, such
    as `2024-01-01T10:00Z`, as permanently malformed.  Activity Streams 2.0
    allows seconds to be omitted, so activities with such date-times are no
    longer rejected or dropped.  [[#1339], [#1347] by ChanHaeng Lee]
