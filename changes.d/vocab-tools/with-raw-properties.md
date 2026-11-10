---
links:
  '#1355': https://github.com/fedify-dev/fedify/issues/1355
---
 -  Added `withRawProperty()` and `withRawProperties()` to generated
    vocabulary modules.  Applications can write expanded JSON-LD properties
    without defining typed accessors, including properties on objects from
    another generated module.  Written extensions are included when nested
    objects are serialized.  Known properties use the most-derived typed
    decoder, and writes reject duplicate destinations or unrepresentable
    values without modifying the source.  [[#1355]]
