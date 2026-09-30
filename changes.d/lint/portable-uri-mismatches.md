---
links:
  '#1157': https://github.com/fedify-dev/fedify/issues/1157
  '#1179': https://github.com/fedify-dev/fedify/pull/1179
---
 -  Fixed actor URI mismatch rules reporting portable actor and collection
    URIs, including gateway-compatible IDs built from them.  Applications can
    use the `getPortable*Uri()` helpers in actor dispatchers without disabling
    these rules.  [[#1157], [#1179]]
