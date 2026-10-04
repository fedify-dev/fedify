---
links:
  '#1229': https://github.com/fedify-dev/fedify/issues/1229
  '#1231': https://github.com/fedify-dev/fedify/pull/1231
---
 -  The `LanguageString` constructor now accepts language tags with extended
    language subtags, such as `zh-YUE`, and stores their canonical form
    (`yue`) as its `locale` instead of throwing a `RangeError`.
    [[#1229], [#1231]]
