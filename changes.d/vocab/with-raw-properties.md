---
links:
  '#1355': https://github.com/fedify-dev/fedify/issues/1355
  '#1420': https://github.com/fedify-dev/fedify/pull/1420
---
 -  Added `withRawProperty()` and `withRawProperties()` to write properties
    by their full IRI using expanded JSON-LD values.  They return a copy of
    the same class, decode supported properties into their typed fields,
    and support removing values.  Explicitly written extensions survive
    cloning and serialization inside parent objects; unrelated received
    extensions are not newly forwarded.  Copies discard cached and retained
    signed representations, so sign changed objects again when needed.
    Compact JSON-LD output also preserves graph members and proof
    references in ordinary vocabulary objects.
    [[#1355], [#1420]]
