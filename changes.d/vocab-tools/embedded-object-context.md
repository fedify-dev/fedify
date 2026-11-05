---
links:
  '#1272': https://github.com/fedify-dev/fedify/issues/1272
  '#1356': https://github.com/fedify-dev/fedify/pull/1356
---
 -  Fixed generated accessors decoding embedded objects that have their own
    `@context` without the enclosing document's context, which could
    return objects of another class, drop property values, or pick objects
    under a term the enclosing context mapped to another property.
    [[#1272], [#1356]]
