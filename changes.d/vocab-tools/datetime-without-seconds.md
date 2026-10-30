---
links:
  '#1339': https://github.com/fedify-dev/fedify/issues/1339
  '#1347': https://github.com/fedify-dev/fedify/pull/1347
---
 -  Fixed generated `xsd:dateTime` decoders failing on date-times without
    seconds, such as `2024-01-01T10:00Z` or `2024-01-01T10:00.5Z`.  Regenerate
    your vocabulary code to get the fix.  Generated code now imports
    `normalizeDateTimeLiteral()` from `@fedify/vocab-runtime/temporal`.
    [[#1339], [#1347] by ChanHaeng Lee]
