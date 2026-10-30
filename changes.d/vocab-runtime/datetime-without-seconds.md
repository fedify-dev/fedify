---
links:
  '#1339': https://github.com/fedify-dev/fedify/issues/1339
  '#1347': https://github.com/fedify-dev/fedify/pull/1347
---
 -  Added `normalizeDateTimeLiteral()` to `@fedify/vocab-runtime/temporal` so
    that generated vocabulary code and `@fedify/fedify` interpret `xsd:dateTime`
    literals the same way.  It treats a literal without a UTC offset as UTC and
    handles literals without seconds.  [[#1339], [#1347] by ChanHaeng Lee]
