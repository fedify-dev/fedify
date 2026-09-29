---
links:
  '#1112': https://github.com/fedify-dev/fedify/issues/1112
  '#1117': https://github.com/fedify-dev/fedify/pull/1117
---
 -  Changed `getObject()` of the mock context that `createFederation()`
    creates to follow `RequestContext.getObject()` of `@fedify/fedify`: it
    now returns `null` for a `Tombstone` that the object dispatcher returns,
    unless the tombstone is an instance of the requested class or
    `{ tombstone: "passthrough" }` is given.  [[#1112], [#1117]]
