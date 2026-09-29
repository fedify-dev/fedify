---
links:
  '#1143': https://github.com/fedify-dev/fedify/issues/1143
  '#1145': https://github.com/fedify-dev/fedify/pull/1145
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  Changed `parseUri()` of the mock contexts to accept the `portable` option,
    following `Context.parseUri()` of `@fedify/fedify`.  It no longer
    recognizes an FEP-ef61 portable ID or compatible identifier whose path
    starts with `/users/` unless the option is enabled, in which case the
    result has the DID in its `authority` property.  It also returns `null`
    for `null`.  [[#288], [#1143], [#1145]]
