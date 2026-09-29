---
links:
  '#1107': https://github.com/fedify-dev/fedify/issues/1107
  '#1120': https://github.com/fedify-dev/fedify/pull/1120
  '#288': https://github.com/fedify-dev/fedify/issues/288
---
 -  The mock contexts that `createContext()` creates now keep the
    `verifyPortableObject` property given to them, following the new
    `Context.verifyPortableObject` property of `@fedify/fedify`, and their
    default `lookupObject()` and `traverseCollection()` methods pass it and
    a `verifyPortableObject` option given to them on.
    [[#288], [#1107], [#1120]]
