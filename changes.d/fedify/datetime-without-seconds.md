---
links:
  '#1339': https://github.com/fedify-dev/fedify/issues/1339
  '#1347': https://github.com/fedify-dev/fedify/pull/1347
---
 -  Fixed inbox handling that treated valid date-times without seconds, such
    as `2024-01-01T10:00Z` or `2024-01-01T10:00.5Z`, as permanently malformed.
    Activity Streams 2.0 allows seconds to be omitted, so activities with such
    date-times are no longer rejected or dropped.  Activities whose
    `Question.closed` is a date-like but impossible value, such as
    `2024-02-31T10:00.5Z`, are now treated as malformed instead of being
    accepted with `closed` discarded.
    [[#1339], [#1347] by ChanHaeng Lee]
