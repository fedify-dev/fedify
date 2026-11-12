---
links:
  '#1355': https://github.com/fedify-dev/fedify/issues/1355
  '#1420': https://github.com/fedify-dev/fedify/pull/1420
---
 -  Added `withRawProperty()` and `withRawProperties()` to generated
    vocabulary modules.  Applications can write expanded JSON-LD properties
    without defining typed accessors, including properties on objects from
    another generated module.  Written extensions are included when nested
    objects are serialized.  Known properties use the most-derived typed
    decoder, and writes reject duplicate destinations, invalid scalar ranges,
    multiple values for functional properties, or unrepresentable values
    without modifying the source.  Validation also covers child objects decoded
    by preprocessors.  Compact JSON-LD output also preserves graph
    members and proof references in ordinary vocabulary objects.
    [[#1355], [#1420]]
