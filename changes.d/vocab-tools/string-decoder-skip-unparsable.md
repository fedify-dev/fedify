---
links:
  '#1234': https://github.com/fedify-dev/fedify/issues/1234
  '#1353': https://github.com/fedify-dev/fedify/pull/1353
---
 -  Made the generated `xsd:string` decoder skip JSON-LD values whose `@value`
    is not a string instead of placing them in string accessors.  Malformed
    remote values no longer leak numbers or booleans into properties such as
    `attributionDomains`.  [[#1234], [#1353]]
