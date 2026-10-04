---
links:
  '#1229': https://github.com/fedify-dev/fedify/issues/1229
  '#1231': https://github.com/fedify-dev/fedify/pull/1231
---
 -  Fixed the `LanguageString` constructor throwing a `RangeError` for
    language tags with extended language subtags, such as `zh-YUE`.  It now
    stores their canonical form (`yue`) as its `locale`.  [[#1229], [#1231]]
