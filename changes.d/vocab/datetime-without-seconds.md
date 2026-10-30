---
links:
  '#1339': https://github.com/fedify-dev/fedify/issues/1339
  '#1347': https://github.com/fedify-dev/fedify/pull/1347
---
 -  Fixed parsing of date-times without seconds, such as `2024-01-01T10:00Z`,
    `2024-01-01T10:00+09:00`, or `2024-01-01T10:00.5Z`, which Activity Streams
    2.0 allows.  They raised a `RangeError`, or were ignored in
    `Question.closed` when they had a fraction.
    [[#1339], [#1347] by ChanHaeng Lee]
